import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Pantalla del segundo tramo del "olvidé mi contraseña": Supabase ya
// validó el enlace del correo y dejó una sesión abierta, así que aquí
// alcanza con updateUser({ password }) — no hace falta el token a mano ni
// pasar por la Edge Function, porque el usuario está cambiando su propia
// clave, no la de otro.
export default function NuevaPassword({ onListo }) {
  const [password, setPassword] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (password !== repetir) {
      setError('Las dos contraseñas no coinciden');
      return;
    }
    setGuardando(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setGuardando(false);
    if (err) {
      setError(err.message);
      return;
    }
    onListo();
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ background: '#f8fafc' }}>
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl shadow-sm bg-white p-6" style={{ border: '1px solid #e2e8f0' }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-xl p-2.5 text-white" style={{ background: '#0369a1' }}>
            <KeyRound size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold">Nueva contraseña</h1>
            <p className="text-xs" style={{ color: '#64748b' }}>Elige la clave con la que vas a entrar de ahora en más</p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
            {error}
          </div>
        )}

        <label className="block text-xs font-semibold mb-1.5" style={{ color: '#475569' }}>Nueva contraseña</label>
        <input
          type="password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg px-3 py-2.5 text-sm mb-4"
          style={{ border: '1.5px solid #cbd5e1', outline: 'none' }}
        />

        <label className="block text-xs font-semibold mb-1.5" style={{ color: '#475569' }}>Repetir contraseña</label>
        <input
          type="password"
          required
          value={repetir}
          onChange={(e) => setRepetir(e.target.value)}
          className="w-full rounded-lg px-3 py-2.5 text-sm mb-6"
          style={{ border: '1.5px solid #cbd5e1', outline: 'none' }}
        />

        <button
          type="submit"
          disabled={guardando}
          className="w-full rounded-lg px-4 py-2.5 text-sm font-bold text-white"
          style={{ background: '#0369a1', opacity: guardando ? 0.7 : 1 }}
        >
          {guardando ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </div>
  );
}
