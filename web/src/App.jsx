import { useState, useEffect, useCallback } from 'react';
import { Droplets, LogOut, Settings } from 'lucide-react';
import { supabase } from './lib/supabase';
import Login from './components/Login';
import AdminPanel from './components/AdminPanel';
import SedePeriodoSelector from './components/SedePeriodoSelector';
import MonitoreoOsmosisInversa from './MonitoreoOsmosisInversa';

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [session, setSession] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [vista, setVista] = useState('monitoreo'); // 'monitoreo' | 'admin'
  const [sede, setSede] = useState(null);
  const [periodo, setPeriodo] = useState(null);

  const cargarPerfil = useCallback(async (uid) => {
    const { data, error } = await supabase.from('usuarios').select('*').eq('id', uid).single();
    setPerfil(error ? null : data);
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        cargarPerfil(newSession.user.id).finally(() => setCargando(false));
      } else {
        setPerfil(null);
        setSede(null);
        setPeriodo(null);
        setVista('monitoreo');
        setCargando(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [cargarPerfil]);

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: '#94a3b8' }}>
        Cargando…
      </div>
    );
  }

  if (!session || !perfil) return <Login />;

  if (!perfil.activo) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-sm text-center">
          <p className="text-sm font-semibold mb-2">Tu cuenta está desactivada</p>
          <p className="text-xs mb-4" style={{ color: '#64748b' }}>Contacta a un administrador si crees que es un error.</p>
          <button
            onClick={handleLogout}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: '#0369a1' }}
          >
            Salir
          </button>
        </div>
      </div>
    );
  }

  const esAdminOSuper = perfil.rol === 'super' || perfil.rol === 'admin';

  return (
    <div className="min-h-screen w-full" style={{ background: '#f8fafc', color: '#0f172a' }}>
      <header
        className="p-4 sm:px-6 flex items-center justify-between gap-4 text-white"
        style={{ background: 'linear-gradient(135deg,#0369a1,#0ea5e9)' }}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-xl p-2" style={{ background: 'rgba(255,255,255,0.18)' }}>
            <Droplets size={22} />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">Monitoreo Ósmosis Inversa</p>
            <p className="text-xs opacity-90">{perfil.nombre} · {perfil.rol}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {esAdminOSuper && (
            <button
              onClick={() => setVista(vista === 'admin' ? 'monitoreo' : 'admin')}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
              style={{ background: 'rgba(255,255,255,0.18)' }}
            >
              <Settings size={15} /> {vista === 'admin' ? 'Volver' : 'Administrar'}
            </button>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ background: 'rgba(255,255,255,0.18)' }}
          >
            <LogOut size={15} /> Salir
          </button>
        </div>
      </header>

      {vista === 'admin' && esAdminOSuper ? (
        <AdminPanel usuario={perfil} />
      ) : !periodo ? (
        <SedePeriodoSelector
          onSeleccion={(s, p) => {
            setSede(s);
            setPeriodo(p);
          }}
        />
      ) : (
        <MonitoreoOsmosisInversa
          usuario={perfil}
          sede={sede}
          periodo={periodo}
          onCambiarPeriodo={() => setPeriodo(null)}
        />
      )}
    </div>
  );
}
