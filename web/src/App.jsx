import { useState, useEffect, useCallback } from 'react';
import { Droplets, LogOut, Settings } from 'lucide-react';
import { api, setCsrfToken } from './lib/api';
import Login from './components/Login';
import AdminPanel from './components/AdminPanel';
import SedePeriodoSelector from './components/SedePeriodoSelector';
import MonitoreoOsmosisInversa from './MonitoreoOsmosisInversa';

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [sedes, setSedes] = useState([]);
  const [vista, setVista] = useState('monitoreo'); // 'monitoreo' | 'admin'
  const [sede, setSede] = useState(null);
  const [periodo, setPeriodo] = useState(null);

  const aplicarSesion = useCallback((data) => {
    setUsuario(data.usuario);
    setCsrfToken(data.csrf_token);
    setSedes(data.sedes || []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get('/me.php');
        aplicarSesion(data);
      } catch {
        setUsuario(null);
      } finally {
        setCargando(false);
      }
    })();
  }, [aplicarSesion]);

  async function handleLogout() {
    try {
      await api.post('/logout.php', {});
    } catch {
      /* la sesión ya pudo haber expirado */
    }
    setUsuario(null);
    setSedes([]);
    setSede(null);
    setPeriodo(null);
    setVista('monitoreo');
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: '#94a3b8' }}>
        Cargando…
      </div>
    );
  }

  if (!usuario) return <Login onLogin={aplicarSesion} />;

  const esAdminOSuper = usuario.rol === 'super' || usuario.rol === 'admin';

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
            <p className="text-xs opacity-90">{usuario.nombre} · {usuario.rol}</p>
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
        <AdminPanel usuario={usuario} />
      ) : !periodo ? (
        <SedePeriodoSelector
          sedes={sedes}
          onSeleccion={(s, p) => {
            setSede(s);
            setPeriodo(p);
          }}
        />
      ) : (
        <MonitoreoOsmosisInversa
          usuario={usuario}
          sede={sede}
          periodo={periodo}
          onCambiarPeriodo={() => setPeriodo(null)}
        />
      )}
    </div>
  );
}
