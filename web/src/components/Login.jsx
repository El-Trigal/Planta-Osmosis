import { useState } from 'react';
import { Droplets } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [modo, setModo] = useState('login'); // 'login' | 'recuperar'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message === 'Invalid login credentials' ? 'Credenciales incorrectas' : authError.message);
    }
    // Si no hubo error, App.jsx reacciona solo via onAuthStateChange.
    setCargando(false);
  }

  async function handleRecuperar(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    // BASE_URL ya trae el subpath con el que Pages sirve el sitio
    // (/Planta-Osmosis/ en producción, / en dev), así que el enlace del
    // correo vuelve a esta misma app en los dos entornos. Ese destino
    // además tiene que estar en Authentication → URL Configuration →
    // Redirect URLs del proyecto Supabase, o Supabase lo ignora.
    const destino = window.location.origin + import.meta.env.BASE_URL;
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: destino });
    setCargando(false);
    if (err) {
      setError(err.message);
      return;
    }
    // Se responde igual exista o no la cuenta: confirmar cuáles emails
    // están registrados le regalaría esa lista a cualquiera.
    setAviso('Si ese email tiene una cuenta, le llegará un enlace para crear una contraseña nueva.');
    setModo('login');
  }

  if (modo === 'recuperar') {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ background: '#f8fafc' }}>
        <form onSubmit={handleRecuperar} className="w-full max-w-sm rounded-xl shadow-sm bg-white p-6" style={{ border: '1px solid #e2e8f0' }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="rounded-xl p-2.5 text-white" style={{ background: '#0369a1' }}>
              <Droplets size={24} />
            </div>
            <div>
              <h1 className="text-lg font-bold">Recuperar contraseña</h1>
              <p className="text-xs" style={{ color: '#64748b' }}>Te enviamos un enlace por correo</p>
            </div>
          </div>

          {error && (
            <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          <label className="block text-xs font-semibold mb-1.5" style={{ color: '#475569' }}>Email</label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 text-sm mb-6"
            style={{ border: '1.5px solid #cbd5e1', outline: 'none' }}
          />

          <button
            type="submit"
            disabled={cargando}
            className="w-full rounded-lg px-4 py-2.5 text-sm font-bold text-white mb-3"
            style={{ background: '#0369a1', opacity: cargando ? 0.7 : 1 }}
          >
            {cargando ? 'Enviando…' : 'Enviar enlace'}
          </button>
          <button
            type="button"
            onClick={() => { setModo('login'); setError(''); }}
            className="w-full text-xs font-semibold"
            style={{ color: '#0369a1' }}
          >
            Volver a iniciar sesión
          </button>

          <p className="text-xs mt-4" style={{ color: '#94a3b8' }}>
            ¿No te llega el correo? Un administrador puede restablecerte la contraseña directamente desde el panel.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ background: '#f8fafc' }}>
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl shadow-sm bg-white p-6" style={{ border: '1px solid #e2e8f0' }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-xl p-2.5 text-white" style={{ background: '#0369a1' }}>
            <Droplets size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold">Monitoreo Ósmosis Inversa</h1>
            <p className="text-xs" style={{ color: '#64748b' }}>Inicia sesión para continuar</p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
            {error}
          </div>
        )}
        {aviso && (
          <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
            {aviso}
          </div>
        )}

        <label className="block text-xs font-semibold mb-1.5" style={{ color: '#475569' }}>Email</label>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg px-3 py-2.5 text-sm mb-4"
          style={{ border: '1.5px solid #cbd5e1', outline: 'none' }}
        />

        <label className="block text-xs font-semibold mb-1.5" style={{ color: '#475569' }}>Contraseña</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg px-3 py-2.5 text-sm mb-6"
          style={{ border: '1.5px solid #cbd5e1', outline: 'none' }}
        />

        <button
          type="submit"
          disabled={cargando}
          className="w-full rounded-lg px-4 py-2.5 text-sm font-bold text-white mb-3"
          style={{ background: '#0369a1', opacity: cargando ? 0.7 : 1 }}
        >
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>
        <button
          type="button"
          onClick={() => { setModo('recuperar'); setError(''); setAviso(''); }}
          className="w-full text-xs font-semibold"
          style={{ color: '#0369a1' }}
        >
          ¿Olvidaste tu contraseña?
        </button>
      </form>
    </div>
  );
}
