import { useState } from 'react';
import { Droplets } from 'lucide-react';
import { api } from '../lib/api';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const data = await api.post('/login.php', { email, password });
      onLogin(data);
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión');
    } finally {
      setCargando(false);
    }
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
          className="w-full rounded-lg px-4 py-2.5 text-sm font-bold text-white"
          style={{ background: '#0369a1', opacity: cargando ? 0.7 : 1 }}
        >
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
