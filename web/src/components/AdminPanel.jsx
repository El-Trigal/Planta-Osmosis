import { useState, useEffect, useCallback } from 'react';
import { Building2, MapPin, Users, Plus } from 'lucide-react';
import { supabase, invocarGestionUsuario } from '../lib/supabase';

const inputStyle = { border: '1.5px solid #cbd5e1', outline: 'none' };

function Tab({ activa, onClick, Icon, children }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition"
      style={{ background: activa ? '#0369a1' : '#f1f5f9', color: activa ? '#fff' : '#475569' }}
    >
      <Icon size={15} /> {children}
    </button>
  );
}

export default function AdminPanel({ usuario }) {
  const esSuper = usuario.rol === 'super';
  const [tab, setTab] = useState(esSuper ? 'empresas' : 'sedes');
  const [empresas, setEmpresas] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [error, setError] = useState('');

  const cargarEmpresas = useCallback(() => {
    if (!esSuper) return;
    supabase
      .from('empresas')
      .select('*')
      .order('nombre')
      .then(({ data, error: err }) => (err ? setError(err.message) : setEmpresas(data || [])));
  }, [esSuper]);

  const cargarSedes = useCallback(() => {
    supabase
      .from('sedes')
      .select('*, empresas(nombre)')
      .order('nombre')
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
          return;
        }
        setSedes((data || []).map((s) => ({ ...s, empresa_nombre: s.empresas?.nombre })));
      });
  }, []);

  const cargarUsuarios = useCallback(() => {
    supabase
      .from('usuarios')
      .select('*, usuario_sedes(sede_id)')
      .order('nombre')
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
          return;
        }
        setUsuarios((data || []).map((u) => ({ ...u, sedes: (u.usuario_sedes || []).map((x) => x.sede_id) })));
      });
  }, []);

  useEffect(() => {
    cargarEmpresas();
    cargarSedes();
    cargarUsuarios();
  }, [cargarEmpresas, cargarSedes, cargarUsuarios]);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <h1 className="text-lg font-bold mb-4">Panel de administración</h1>

      <div className="flex flex-wrap gap-2 mb-5">
        {esSuper && <Tab activa={tab === 'empresas'} onClick={() => setTab('empresas')} Icon={Building2}>Empresas</Tab>}
        <Tab activa={tab === 'sedes'} onClick={() => setTab('sedes')} Icon={MapPin}>Sedes</Tab>
        <Tab activa={tab === 'usuarios'} onClick={() => setTab('usuarios')} Icon={Users}>Usuarios</Tab>
      </div>

      {error && (
        <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: '#fef2f2', color: '#991b1b' }}>
          {error}
        </div>
      )}

      {tab === 'empresas' && esSuper && (
        <EmpresasTab empresas={empresas} onChange={cargarEmpresas} onError={setError} />
      )}
      {tab === 'sedes' && (
        <SedesTab
          sedes={sedes}
          empresas={empresas}
          usuario={usuario}
          onChange={cargarSedes}
          onError={setError}
        />
      )}
      {tab === 'usuarios' && (
        <UsuariosTab
          usuarios={usuarios}
          sedes={sedes}
          empresas={empresas}
          usuario={usuario}
          onChange={cargarUsuarios}
          onError={setError}
        />
      )}
    </div>
  );
}

function EmpresasTab({ empresas, onChange, onError }) {
  const [nombre, setNombre] = useState('');

  async function crear() {
    if (!nombre.trim()) return;
    const { error } = await supabase.from('empresas').insert({ nombre: nombre.trim() });
    if (error) onError(error.message);
    else {
      setNombre('');
      onChange();
    }
  }

  return (
    <div className="rounded-xl shadow-sm bg-white p-5" style={{ border: '1px solid #e2e8f0' }}>
      <div className="flex gap-2 mb-4">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre de la empresa"
          className="flex-1 rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        />
        <button onClick={crear} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white" style={{ background: '#16a34a' }}>
          <Plus size={16} /> Crear
        </button>
      </div>
      <ul className="divide-y" style={{ borderColor: '#f1f5f9' }}>
        {empresas.map((e) => (
          <li key={e.id} className="py-2 text-sm font-medium">{e.nombre}</li>
        ))}
      </ul>
    </div>
  );
}

function SedesTab({ sedes, empresas, usuario, onChange, onError }) {
  const esSuper = usuario.rol === 'super';
  const [nombre, setNombre] = useState('');
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id ?? '');

  async function crear() {
    if (!nombre.trim()) return;
    const payload = { nombre: nombre.trim(), empresa_id: esSuper ? Number(empresaId) : usuario.empresa_id };
    const { error } = await supabase.from('sedes').insert(payload);
    if (error) onError(error.message);
    else {
      setNombre('');
      onChange();
    }
  }

  if (esSuper && empresas.length === 0) {
    return (
      <div className="rounded-xl shadow-sm bg-white p-5 text-sm" style={{ border: '1px solid #e2e8f0', color: '#64748b' }}>
        Primero crea una empresa en la pestaña <strong>Empresas</strong> — una sede siempre pertenece a una.
      </div>
    );
  }

  return (
    <div className="rounded-xl shadow-sm bg-white p-5" style={{ border: '1px solid #e2e8f0' }}>
      <div className="flex flex-wrap gap-2 mb-4">
        {esSuper && (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={inputStyle}>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        )}
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre de la sede"
          className="flex-1 rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        />
        <button onClick={crear} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white" style={{ background: '#16a34a' }}>
          <Plus size={16} /> Crear
        </button>
      </div>
      <ul className="divide-y" style={{ borderColor: '#f1f5f9' }}>
        {sedes.map((s) => (
          <li key={s.id} className="py-2 text-sm font-medium flex justify-between">
            <span>{s.nombre}</span>
            <span className="text-xs" style={{ color: '#94a3b8' }}>{s.empresa_nombre}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UsuariosTab({ usuarios, sedes, empresas, usuario, onChange, onError }) {
  const esSuper = usuario.rol === 'super';
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('operario');
  const [empresaId, setEmpresaId] = useState(esSuper ? (empresas[0]?.id ?? '') : usuario.empresa_id);
  const [sedesSel, setSedesSel] = useState([]);

  const sedesDeEmpresa = sedes.filter((s) => s.empresa_id === Number(empresaId));

  function toggleSede(id) {
    setSedesSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function crear() {
    if (!nombre.trim() || !email.trim() || password.length < 8) {
      onError('Completa nombre, email y una contraseña de al menos 8 caracteres');
      return;
    }
    try {
      await invocarGestionUsuario({
        accion: 'crear',
        nombre: nombre.trim(),
        email: email.trim(),
        password,
        rol,
        empresa_id: Number(empresaId),
        sedes: sedesSel,
      });
      setNombre('');
      setEmail('');
      setPassword('');
      setSedesSel([]);
      onChange();
    } catch (e) {
      onError(e.message);
    }
  }

  async function toggleActivo(u) {
    try {
      await invocarGestionUsuario({ accion: 'actualizar', id: u.id, activo: !u.activo });
      onChange();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <div className="rounded-xl shadow-sm bg-white p-5" style={{ border: '1px solid #e2e8f0' }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña (mín. 8)" type="password" className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
        <select value={rol} onChange={(e) => setRol(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={inputStyle}>
          <option value="operario">Operario</option>
          <option value="admin">Admin</option>
        </select>
        {esSuper && (
          <select value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setSedesSel([]); }} className="rounded-lg px-3 py-2 text-sm" style={inputStyle}>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        )}
      </div>

      {sedesDeEmpresa.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold mb-1.5" style={{ color: '#475569' }}>Sedes asignadas</p>
          <div className="flex flex-wrap gap-2">
            {sedesDeEmpresa.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5" style={{ background: '#f1f5f9' }}>
                <input type="checkbox" checked={sedesSel.includes(s.id)} onChange={() => toggleSede(s.id)} />
                {s.nombre}
              </label>
            ))}
          </div>
        </div>
      )}

      <button onClick={crear} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white mb-4" style={{ background: '#16a34a' }}>
        <Plus size={16} /> Crear usuario
      </button>

      <ul className="divide-y" style={{ borderColor: '#f1f5f9' }}>
        {usuarios.map((u) => {
          const esUnoMismo = u.id === usuario.id;
          return (
            <li key={u.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <div>
                <p className="font-medium">{u.nombre} <span className="text-xs font-normal" style={{ color: '#94a3b8' }}>({u.rol})</span></p>
                <p className="text-xs" style={{ color: '#64748b' }}>{u.email}</p>
              </div>
              <button
                onClick={() => toggleActivo(u)}
                disabled={esUnoMismo}
                title={esUnoMismo ? 'No puedes desactivar tu propia cuenta' : undefined}
                className="text-xs font-semibold rounded-lg px-2.5 py-1.5"
                style={{
                  background: u.activo ? '#f0fdf4' : '#fef2f2',
                  color: u.activo ? '#166534' : '#991b1b',
                  opacity: esUnoMismo ? 0.5 : 1,
                  cursor: esUnoMismo ? 'not-allowed' : 'pointer',
                }}
              >
                {u.activo ? 'Activo' : 'Inactivo'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
