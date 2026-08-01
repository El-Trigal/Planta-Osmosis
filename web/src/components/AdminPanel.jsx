import { useState, useEffect, useCallback } from 'react';
import { Building2, MapPin, Users, Plus, Pencil, Trash2, Check, X, KeyRound, SlidersHorizontal } from 'lucide-react';
import { supabase, invocarGestionUsuario } from '../lib/supabase';
import ParametrosPanel from './ParametrosPanel';

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

// Botón de icono para las acciones por fila (editar / borrar / confirmar).
function IconBtn({ onClick, title, Icon, color = '#64748b', disabled }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="rounded-lg p-1.5 transition"
      style={{ color: disabled ? '#cbd5e1' : color, background: '#f8fafc', cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <Icon size={15} />
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
  const [aviso, setAviso] = useState('');

  // Un mensaje a la vez: mostrar un éxito viejo junto a un error nuevo
  // (o al revés) confunde más de lo que informa.
  const reportarError = useCallback((msg) => {
    setAviso('');
    setError(msg);
  }, []);
  const reportarAviso = useCallback((msg) => {
    setError('');
    setAviso(msg);
  }, []);

  const cargarEmpresas = useCallback(() => {
    if (!esSuper) return;
    supabase
      .from('empresas')
      .select('*')
      .order('nombre')
      .then(({ data, error: err }) => (err ? reportarError(err.message) : setEmpresas(data || [])));
  }, [esSuper, reportarError]);

  const cargarSedes = useCallback(() => {
    supabase
      .from('sedes')
      .select('*, empresas(nombre)')
      .order('nombre')
      .then(({ data, error: err }) => {
        if (err) {
          reportarError(err.message);
          return;
        }
        setSedes((data || []).map((s) => ({ ...s, empresa_nombre: s.empresas?.nombre })));
      });
  }, [reportarError]);

  const cargarUsuarios = useCallback(() => {
    supabase
      .from('usuarios')
      .select('*, usuario_sedes(sede_id)')
      .order('nombre')
      .then(({ data, error: err }) => {
        if (err) {
          reportarError(err.message);
          return;
        }
        setUsuarios((data || []).map((u) => ({ ...u, sedes: (u.usuario_sedes || []).map((x) => x.sede_id) })));
      });
  }, [reportarError]);

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
        <Tab activa={tab === 'parametros'} onClick={() => setTab('parametros')} Icon={SlidersHorizontal}>Parámetros</Tab>
        <Tab activa={tab === 'usuarios'} onClick={() => setTab('usuarios')} Icon={Users}>Usuarios</Tab>
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

      {tab === 'empresas' && esSuper && (
        <EmpresasTab empresas={empresas} onChange={cargarEmpresas} onError={reportarError} onAviso={reportarAviso} />
      )}
      {tab === 'sedes' && (
        <SedesTab
          sedes={sedes}
          empresas={empresas}
          usuario={usuario}
          onChange={cargarSedes}
          onError={reportarError}
          onAviso={reportarAviso}
        />
      )}
      {tab === 'parametros' && (
        <ParametrosPanel sedes={sedes} onError={reportarError} onAviso={reportarAviso} />
      )}
      {tab === 'usuarios' && (
        <UsuariosTab
          usuarios={usuarios}
          sedes={sedes}
          empresas={empresas}
          usuario={usuario}
          onChange={cargarUsuarios}
          onError={reportarError}
          onAviso={reportarAviso}
        />
      )}
    </div>
  );
}

/* ───────────────────────────── EMPRESAS ───────────────────────────── */

function EmpresasTab({ empresas, onChange, onError, onAviso }) {
  const [nombre, setNombre] = useState('');
  const [editandoId, setEditandoId] = useState(null);
  const [nombreEdit, setNombreEdit] = useState('');

  async function crear() {
    if (!nombre.trim()) return;
    const { error } = await supabase.from('empresas').insert({ nombre: nombre.trim() });
    if (error) onError(error.message);
    else {
      setNombre('');
      onChange();
    }
  }

  async function guardarNombre(id) {
    if (!nombreEdit.trim()) return;
    const { error } = await supabase.from('empresas').update({ nombre: nombreEdit.trim() }).eq('id', id);
    if (error) onError(error.message);
    else {
      setEditandoId(null);
      onAviso('Empresa renombrada');
      onChange();
    }
  }

  // La base rechaza el borrado si la empresa todavía tiene sedes o
  // usuarios, y devuelve el motivo exacto; aquí solo se muestra.
  async function borrar(e) {
    if (!window.confirm(`¿Borrar la empresa "${e.nombre}"?`)) return;
    const { error } = await supabase.from('empresas').delete().eq('id', e.id);
    if (error) onError(error.message);
    else {
      onAviso('Empresa borrada');
      onChange();
    }
  }

  return (
    <div className="rounded-xl shadow-sm bg-white p-5" style={{ border: '1px solid #e2e8f0' }}>
      <div className="flex gap-2 mb-4">
        <input
          value={nombre}
          onChange={(ev) => setNombre(ev.target.value)}
          onKeyDown={(ev) => ev.key === 'Enter' && crear()}
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
          <li key={e.id} className="py-2 flex items-center justify-between gap-2 text-sm">
            {editandoId === e.id ? (
              <>
                <input
                  autoFocus
                  value={nombreEdit}
                  onChange={(ev) => setNombreEdit(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') guardarNombre(e.id);
                    if (ev.key === 'Escape') setEditandoId(null);
                  }}
                  className="flex-1 rounded-lg px-3 py-1.5 text-sm"
                  style={inputStyle}
                />
                <div className="flex gap-1">
                  <IconBtn onClick={() => guardarNombre(e.id)} title="Guardar" Icon={Check} color="#16a34a" />
                  <IconBtn onClick={() => setEditandoId(null)} title="Cancelar" Icon={X} />
                </div>
              </>
            ) : (
              <>
                <span className="font-medium">{e.nombre}</span>
                <div className="flex gap-1">
                  <IconBtn onClick={() => { setEditandoId(e.id); setNombreEdit(e.nombre); }} title="Renombrar" Icon={Pencil} />
                  <IconBtn onClick={() => borrar(e)} title="Borrar" Icon={Trash2} color="#dc2626" />
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────────── SEDES ───────────────────────────── */

function SedesTab({ sedes, empresas, usuario, onChange, onError, onAviso }) {
  const esSuper = usuario.rol === 'super';
  const [nombre, setNombre] = useState('');
  const [empresaId, setEmpresaId] = useState('');
  const [editandoId, setEditandoId] = useState(null);
  const [nombreEdit, setNombreEdit] = useState('');

  // empresas llega vacío en el primer render (se carga en paralelo), así
  // que el valor inicial del select tiene que fijarse cuando llega.
  useEffect(() => {
    if (esSuper && !empresaId && empresas.length > 0) setEmpresaId(String(empresas[0].id));
  }, [esSuper, empresaId, empresas]);

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

  async function guardarNombre(id) {
    if (!nombreEdit.trim()) return;
    const { error } = await supabase.from('sedes').update({ nombre: nombreEdit.trim() }).eq('id', id);
    if (error) onError(error.message);
    else {
      setEditandoId(null);
      onAviso('Sede renombrada');
      onChange();
    }
  }

  async function borrar(s) {
    if (!window.confirm(`¿Borrar la sede "${s.nombre}"?`)) return;
    const { error } = await supabase.from('sedes').delete().eq('id', s.id);
    if (error) onError(error.message);
    else {
      onAviso('Sede borrada');
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
          onKeyDown={(e) => e.key === 'Enter' && crear()}
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
          <li key={s.id} className="py-2 flex items-center justify-between gap-2 text-sm">
            {editandoId === s.id ? (
              <>
                <input
                  autoFocus
                  value={nombreEdit}
                  onChange={(e) => setNombreEdit(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') guardarNombre(s.id);
                    if (e.key === 'Escape') setEditandoId(null);
                  }}
                  className="flex-1 rounded-lg px-3 py-1.5 text-sm"
                  style={inputStyle}
                />
                <div className="flex gap-1">
                  <IconBtn onClick={() => guardarNombre(s.id)} title="Guardar" Icon={Check} color="#16a34a" />
                  <IconBtn onClick={() => setEditandoId(null)} title="Cancelar" Icon={X} />
                </div>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="font-medium truncate">{s.nombre}</p>
                  <p className="text-xs" style={{ color: '#94a3b8' }}>{s.empresa_nombre}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <IconBtn onClick={() => { setEditandoId(s.id); setNombreEdit(s.nombre); }} title="Renombrar" Icon={Pencil} />
                  <IconBtn onClick={() => borrar(s)} title="Borrar" Icon={Trash2} color="#dc2626" />
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────────── USUARIOS ───────────────────────────── */

function UsuariosTab({ usuarios, sedes, empresas, usuario, onChange, onError, onAviso }) {
  const esSuper = usuario.rol === 'super';
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('operario');
  const [empresaId, setEmpresaId] = useState(esSuper ? '' : String(usuario.empresa_id));
  const [sedesSel, setSedesSel] = useState([]);
  const [editandoId, setEditandoId] = useState(null);

  useEffect(() => {
    if (esSuper && !empresaId && empresas.length > 0) setEmpresaId(String(empresas[0].id));
  }, [esSuper, empresaId, empresas]);

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
      onAviso('Usuario creado');
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
      <h2 className="text-sm font-bold mb-3">Nuevo usuario</h2>
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

      <button onClick={crear} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white mb-5" style={{ background: '#16a34a' }}>
        <Plus size={16} /> Crear usuario
      </button>

      <h2 className="text-sm font-bold mb-1">Usuarios existentes</h2>
      <ul className="divide-y" style={{ borderColor: '#f1f5f9' }}>
        {usuarios.map((u) => (
          <FilaUsuario
            key={u.id}
            u={u}
            sedes={sedes}
            yo={usuario}
            editando={editandoId === u.id}
            onEditar={() => setEditandoId(editandoId === u.id ? null : u.id)}
            onCerrar={() => setEditandoId(null)}
            onToggleActivo={() => toggleActivo(u)}
            onChange={onChange}
            onError={onError}
            onAviso={onAviso}
          />
        ))}
      </ul>
    </div>
  );
}

// Una fila de usuario, con su panel de edición desplegable. La Edge
// Function ya aceptaba nombre / sedes / password en 'actualizar'; esto es
// la pantalla que faltaba para llegar a esas tres cosas.
function FilaUsuario({ u, sedes, yo, editando, onEditar, onCerrar, onToggleActivo, onChange, onError, onAviso }) {
  const esUnoMismo = u.id === yo.id;
  const [nombreEdit, setNombreEdit] = useState(u.nombre);
  const [sedesEdit, setSedesEdit] = useState(u.sedes);
  const [passNueva, setPassNueva] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Al abrir el panel se parte siempre del estado actual del servidor, no
  // de lo que haya quedado de una edición anterior que se canceló.
  useEffect(() => {
    if (editando) {
      setNombreEdit(u.nombre);
      setSedesEdit(u.sedes);
      setPassNueva('');
    }
  }, [editando, u.nombre, u.sedes]);

  const sedesDeSuEmpresa = sedes.filter((s) => s.empresa_id === u.empresa_id);
  const nombresAsignados = sedes.filter((s) => u.sedes.includes(s.id)).map((s) => s.nombre);

  async function guardar() {
    if (!nombreEdit.trim()) {
      onError('El nombre no puede estar vacío');
      return;
    }
    if (passNueva && passNueva.length < 8) {
      onError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    setGuardando(true);
    try {
      const payload = { accion: 'actualizar', id: u.id, nombre: nombreEdit.trim(), sedes: sedesEdit };
      if (passNueva) payload.password = passNueva;
      await invocarGestionUsuario(payload);
      onAviso(passNueva ? 'Usuario actualizado y contraseña restablecida' : 'Usuario actualizado');
      onCerrar();
      onChange();
    } catch (e) {
      onError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <li className="py-2.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium truncate">
            {u.nombre} <span className="text-xs font-normal" style={{ color: '#94a3b8' }}>({u.rol})</span>
          </p>
          <p className="text-xs truncate" style={{ color: '#64748b' }}>{u.email}</p>
          {u.rol !== 'super' && (
            <p className="text-xs truncate" style={{ color: '#94a3b8' }}>
              {nombresAsignados.length > 0 ? `Sedes: ${nombresAsignados.join(', ')}` : 'Sin sedes asignadas'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconBtn onClick={onEditar} title="Editar" Icon={editando ? X : Pencil} />
          <button
            onClick={onToggleActivo}
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
        </div>
      </div>

      {editando && (
        <div className="mt-3 rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: '#475569' }}>Nombre</label>
          <input
            value={nombreEdit}
            onChange={(e) => setNombreEdit(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm mb-3"
            style={inputStyle}
          />

          {u.rol !== 'super' && (
            <>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: '#475569' }}>Sedes asignadas</label>
              {sedesDeSuEmpresa.length === 0 ? (
                <p className="text-xs mb-3" style={{ color: '#94a3b8' }}>Su empresa todavía no tiene sedes.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mb-3">
                  {sedesDeSuEmpresa.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 bg-white" style={{ border: '1px solid #e2e8f0' }}>
                      <input
                        type="checkbox"
                        checked={sedesEdit.includes(s.id)}
                        onChange={() =>
                          setSedesEdit((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                        }
                      />
                      {s.nombre}
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          <label className="flex items-center gap-1.5 text-xs font-semibold mb-1.5" style={{ color: '#475569' }}>
            <KeyRound size={13} /> Nueva contraseña
          </label>
          <input
            type="password"
            value={passNueva}
            onChange={(e) => setPassNueva(e.target.value)}
            placeholder="Dejar vacío para no cambiarla"
            className="w-full rounded-lg px-3 py-2 text-sm mb-3"
            style={inputStyle}
          />

          <div className="flex gap-2">
            <button
              onClick={guardar}
              disabled={guardando}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white"
              style={{ background: '#16a34a', opacity: guardando ? 0.7 : 1 }}
            >
              <Check size={16} /> {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button onClick={onCerrar} className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: '#f1f5f9', color: '#475569' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
