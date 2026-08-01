import { useState, useEffect, useCallback } from 'react';
import { Droplets, LogOut, Settings } from 'lucide-react';
import { supabase } from './lib/supabase';
import Login from './components/Login';
import AdminPanel from './components/AdminPanel';
import SedePeriodoSelector from './components/SedePeriodoSelector';
import NuevaPassword from './components/NuevaPassword';
import MonitoreoOsmosisInversa from './MonitoreoOsmosisInversa';

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [session, setSession] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [vista, setVista] = useState('monitoreo'); // 'monitoreo' | 'admin'
  const [sede, setSede] = useState(null);
  const [periodo, setPeriodo] = useState(null);
  const [recuperando, setRecuperando] = useState(false);
  // null | 'conexion' | 'sin_perfil' — por qué no hay perfil, que no es lo
  // mismo que no haber iniciado sesión.
  const [fallaPerfil, setFallaPerfil] = useState(null);
  const [reintentando, setReintentando] = useState(false);

  // maybeSingle() en vez de single() para poder separar los dos casos: si
  // la consulta falla es un problema de conexión (el proyecto Supabase se
  // auto-pausa por inactividad en el plan gratuito, y ahí toda llamada
  // falla con la sesión perfectamente válida) y se puede reintentar; si
  // devuelve cero filas, la cuenta existe en Auth pero nadie le creó su
  // fila en 'usuarios', y reintentar no va a arreglarlo nunca.
  const cargarPerfil = useCallback(async (uid) => {
    const { data, error } = await supabase.from('usuarios').select('*').eq('id', uid).maybeSingle();
    if (error) {
      setPerfil(null);
      setFallaPerfil('conexion');
      return;
    }
    if (!data) {
      setPerfil(null);
      setFallaPerfil('sin_perfil');
      return;
    }
    setPerfil(data);
    setFallaPerfil(null);
  }, []);

  async function reintentarPerfil() {
    if (!session) return;
    setReintentando(true);
    await cargarPerfil(session.user.id);
    setReintentando(false);
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((evento, newSession) => {
      setSession(newSession);
      // Al abrir el enlace de "olvidé mi contraseña", Supabase canjea el
      // token y deja una sesión válida. Sin este corte la app entraría
      // derecho al monitoreo y el usuario nunca llegaría a fijar su nueva
      // clave, quedando con la vieja (que no recuerda) para el próximo
      // ingreso.
      if (evento === 'PASSWORD_RECOVERY') setRecuperando(true);
      if (newSession) {
        cargarPerfil(newSession.user.id).finally(() => setCargando(false));
      } else {
        setPerfil(null);
        setSede(null);
        setPeriodo(null);
        setVista('monitoreo');
        setRecuperando(false);
        setFallaPerfil(null);
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

  // Va antes del gate de perfil a propósito: quien llega por el enlace de
  // recuperación tiene que poder fijar su contraseña aunque su perfil no
  // cargue o su cuenta esté desactivada.
  if (session && recuperando) return <NuevaPassword onListo={() => setRecuperando(false)} />;

  if (!session) return <Login />;

  // Con sesión válida pero sin perfil, mandar al Login era el peor mensaje
  // posible: invitaba a reescribir una y otra vez unas credenciales que
  // estaban bien.
  if (fallaPerfil === 'conexion') {
    return (
      <Aviso
        titulo="No pudimos cargar tu perfil"
        detalle="Tu sesión sigue activa; el problema es la conexión con el servidor. Puede ser tu red o que el proyecto esté despertando."
        onSalir={handleLogout}
      >
        <button
          onClick={reintentarPerfil}
          disabled={reintentando}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ background: '#0369a1', opacity: reintentando ? 0.7 : 1 }}
        >
          {reintentando ? 'Reintentando…' : 'Reintentar'}
        </button>
      </Aviso>
    );
  }

  if (fallaPerfil === 'sin_perfil') {
    return (
      <Aviso
        titulo="Tu cuenta no tiene perfil"
        detalle="El usuario existe pero todavía no fue dado de alta en el sistema. Un administrador tiene que completarlo."
        onSalir={handleLogout}
      />
    );
  }

  if (!perfil) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: '#94a3b8' }}>
        Cargando…
      </div>
    );
  }

  if (!perfil.activo) {
    return (
      <Aviso
        titulo="Tu cuenta está desactivada"
        detalle="Contacta a un administrador si crees que es un error."
        onSalir={handleLogout}
      />
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
          usuario={perfil}
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

// Pantalla completa para los estados en los que hay sesión pero no se
// puede entrar: cuenta desactivada, perfil que no carga, perfil que no
// existe. Siempre deja salir, porque cerrar sesión es lo único que la
// persona puede hacer por su cuenta en cualquiera de los tres casos.
function Aviso({ titulo, detalle, onSalir, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm text-center">
        <p className="text-sm font-semibold mb-2">{titulo}</p>
        <p className="text-xs mb-4" style={{ color: '#64748b' }}>{detalle}</p>
        <div className="flex items-center justify-center gap-2">
          {children}
          <button
            onClick={onSalir}
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            style={children ? { background: '#f1f5f9', color: '#475569' } : { background: '#0369a1', color: '#fff' }}
          >
            Salir
          </button>
        </div>
      </div>
    </div>
  );
}
