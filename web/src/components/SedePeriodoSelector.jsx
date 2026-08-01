import { useState, useEffect, useCallback } from 'react';
import { Droplets, ChevronRight, Pencil, Trash2, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function diasEnMes(mesIdx, anio) {
  return new Date(anio, mesIdx + 1, 0).getDate();
}

export default function SedePeriodoSelector({ usuario, onSeleccion }) {
  const puedeAdministrar = usuario.rol === 'super' || usuario.rol === 'admin';
  const [sedes, setSedes] = useState([]);
  const [cargandoSedes, setCargandoSedes] = useState(true);
  const [sedeId, setSedeId] = useState(null);
  const [periodos, setPeriodos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [editandoId, setEditandoId] = useState(null);
  const [toleranciaEdit, setToleranciaEdit] = useState(10);
  const [diasEdit, setDiasEdit] = useState(31);
  const hoy = new Date();
  const [mesIdx, setMesIdx] = useState(hoy.getMonth());
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [tolerancia, setTolerancia] = useState(10);

  useEffect(() => {
    supabase
      .from('sedes')
      .select('id, nombre, empresa_id, empresas(nombre)')
      .order('nombre')
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
          setCargandoSedes(false);
          return;
        }
        const lista = (data || []).map((s) => ({
          id: s.id,
          nombre: s.nombre,
          empresa_id: s.empresa_id,
          empresa_nombre: s.empresas?.nombre,
        }));
        setSedes(lista);
        setSedeId(lista[0]?.id ?? null);
        setCargandoSedes(false);
      });
  }, []);

  const cargarPeriodos = useCallback(() => {
    if (!sedeId) return;
    setCargando(true);
    setError('');
    supabase
      .from('periodos')
      .select('*')
      .eq('sede_id', sedeId)
      .order('anio', { ascending: false })
      .order('mes', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setPeriodos(data || []);
        setCargando(false);
      });
  }, [sedeId]);

  useEffect(() => {
    cargarPeriodos();
  }, [cargarPeriodos]);

  async function crearPeriodo() {
    setError('');
    const dias = diasEnMes(mesIdx, anio);
    const { data, error: err } = await supabase
      .from('periodos')
      .insert({ sede_id: sedeId, mes: mesIdx + 1, anio, dias, tolerancia })
      .select()
      .single();
    if (err) {
      setError(err.code === '23505' ? 'Ya existe un período para esa sede/mes/año' : err.message);
      return;
    }
    onSeleccion(sedes.find((s) => s.id === sedeId), data);
  }

  // Solo 'dias' y 'tolerancia' son editables: la migración 0001 bloquea
  // con un trigger cualquier intento de cambiarle el mes, el año o la
  // sede a un período ya creado.
  async function guardarPeriodo(id) {
    setError('');
    const { error: err } = await supabase
      .from('periodos')
      .update({ tolerancia: toleranciaEdit, dias: diasEdit })
      .eq('id', id);
    if (err) {
      setError(err.message);
      return;
    }
    setEditandoId(null);
    cargarPeriodos();
  }

  // La base rechaza el borrado si el período ya tiene mediciones, con un
  // mensaje que dice cuántas; se muestra tal cual.
  async function borrarPeriodo(p) {
    if (!window.confirm(`¿Borrar el período ${MESES[p.mes - 1]} ${p.anio}?`)) return;
    setError('');
    const { error: err } = await supabase.from('periodos').delete().eq('id', p.id);
    if (err) {
      setError(err.message);
      return;
    }
    cargarPeriodos();
  }

  if (cargandoSedes) {
    return <p className="text-sm p-6" style={{ color: '#94a3b8' }}>Cargando…</p>;
  }

  if (sedes.length === 0) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center text-sm p-4" style={{ color: '#64748b' }}>
        No tienes sedes asignadas. Contacta a un administrador.
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <div className="rounded-xl shadow-sm bg-white p-6" style={{ border: '1px solid #e2e8f0' }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-xl p-2.5 text-white" style={{ background: '#0369a1' }}>
            <Droplets size={22} />
          </div>
          <h1 className="text-lg font-bold">Elegir sede y período</h1>
        </div>

        <label className="block text-xs font-semibold mb-1.5" style={{ color: '#475569' }}>Sede</label>
        <select
          value={sedeId ?? ''}
          onChange={(e) => setSedeId(Number(e.target.value))}
          className="w-full rounded-lg px-3 py-2.5 text-sm mb-5"
          style={{ border: '1.5px solid #cbd5e1' }}
        >
          {sedes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.empresa_nombre} · {s.nombre}
            </option>
          ))}
        </select>

        {error && (
          <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: '#fef2f2', color: '#991b1b' }}>
            {error}
          </div>
        )}

        <h2 className="text-sm font-bold mb-2">Períodos existentes</h2>
        {cargando ? (
          <p className="text-sm mb-4" style={{ color: '#94a3b8' }}>Cargando…</p>
        ) : periodos.length === 0 ? (
          <p className="text-sm mb-4" style={{ color: '#94a3b8' }}>Aún no hay períodos para esta sede.</p>
        ) : (
          <ul className="divide-y mb-6" style={{ borderColor: '#f1f5f9' }}>
            {periodos.map((p) => (
              <li key={p.id} className="py-2">
                {editandoId === p.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{MESES[p.mes - 1]} {p.anio}</span>
                    <label className="text-xs" style={{ color: '#64748b' }}>
                      Días
                      <input
                        type="number"
                        min={28}
                        max={31}
                        value={diasEdit}
                        onChange={(e) => setDiasEdit(Number(e.target.value))}
                        className="ml-1.5 w-16 rounded-lg px-2 py-1 text-sm"
                        style={{ border: '1.5px solid #cbd5e1' }}
                      />
                    </label>
                    <label className="text-xs" style={{ color: '#64748b' }}>
                      Tolerancia %
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={toleranciaEdit}
                        onChange={(e) => setToleranciaEdit(Number(e.target.value))}
                        className="ml-1.5 w-16 rounded-lg px-2 py-1 text-sm"
                        style={{ border: '1.5px solid #cbd5e1' }}
                      />
                    </label>
                    <button onClick={() => guardarPeriodo(p.id)} title="Guardar" className="rounded-lg p-1.5" style={{ background: '#f0fdf4', color: '#16a34a' }}>
                      <Check size={15} />
                    </button>
                    <button onClick={() => setEditandoId(null)} title="Cancelar" className="rounded-lg p-1.5" style={{ background: '#f8fafc', color: '#64748b' }}>
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => onSeleccion(sedes.find((s) => s.id === sedeId), p)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold"
                      style={{ background: '#f1f5f9', color: '#334155' }}
                    >
                      {MESES[p.mes - 1]} {p.anio} <ChevronRight size={14} />
                    </button>
                    <div className="flex items-center gap-1">
                      <span className="text-xs mr-1" style={{ color: '#94a3b8' }}>{p.dias} días · ±{p.tolerancia}%</span>
                      {puedeAdministrar && (
                        <>
                          <button
                            onClick={() => { setEditandoId(p.id); setToleranciaEdit(p.tolerancia); setDiasEdit(p.dias); }}
                            title="Editar días y tolerancia"
                            className="rounded-lg p-1.5"
                            style={{ background: '#f8fafc', color: '#64748b' }}
                          >
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => borrarPeriodo(p)} title="Borrar período" className="rounded-lg p-1.5" style={{ background: '#f8fafc', color: '#dc2626' }}>
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <h2 className="text-sm font-bold mb-2">Crear nuevo período</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select
            value={mesIdx}
            onChange={(e) => setMesIdx(Number(e.target.value))}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ border: '1.5px solid #cbd5e1' }}
          >
            {MESES.map((m, i) => (
              <option key={m} value={i}>{m}</option>
            ))}
          </select>
          <input
            type="number"
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ border: '1.5px solid #cbd5e1' }}
          />
          <input
            type="number"
            min={0}
            max={100}
            value={tolerancia}
            onChange={(e) => setTolerancia(Number(e.target.value))}
            title="Tolerancia (%)"
            className="rounded-lg px-3 py-2 text-sm"
            style={{ border: '1.5px solid #cbd5e1' }}
          />
          <button
            onClick={crearPeriodo}
            className="rounded-lg px-3 py-2 text-sm font-bold text-white"
            style={{ background: '#16a34a' }}
          >
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}
