import { useState, useEffect, useCallback } from 'react';
import { Droplets, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function diasEnMes(mesIdx, anio) {
  return new Date(anio, mesIdx + 1, 0).getDate();
}

export default function SedePeriodoSelector({ onSeleccion }) {
  const [sedes, setSedes] = useState([]);
  const [cargandoSedes, setCargandoSedes] = useState(true);
  const [sedeId, setSedeId] = useState(null);
  const [periodos, setPeriodos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
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
          <div className="flex flex-wrap gap-2 mb-6">
            {periodos.map((p) => (
              <button
                key={p.id}
                onClick={() => onSeleccion(sedes.find((s) => s.id === sedeId), p)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold"
                style={{ background: '#f1f5f9', color: '#334155' }}
              >
                {MESES[p.mes - 1]} {p.anio} <ChevronRight size={14} />
              </button>
            ))}
          </div>
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
