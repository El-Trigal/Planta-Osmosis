import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Pencil, Trash2, Check, X, Layers } from 'lucide-react';
import { supabase } from '../lib/supabase';

const inputStyle = { border: '1.5px solid #cbd5e1', outline: 'none' };

const ICONOS = ['Beaker', 'Wind', 'Filter', 'FlaskConical', 'Activity'];

const TIPOS_REF = [
  { value: 'target', label: 'Objetivo (± tolerancia del período)' },
  { value: 'range', label: 'Rango entre mínimo y máximo' },
  { value: 'min', label: 'Mínimo (no bajar de)' },
  { value: 'max', label: 'Máximo (no pasar de)' },
];

// Los dos ámbitos tienen exactamente la misma forma; solo cambian los
// nombres de las tablas y la clave foránea. Ver db/migrations/0002: la
// plantilla de la sede es lo que se copia al crear un período, y el
// período conserva su copia congelada.
function config(ambito, sedeId, periodoId) {
  if (ambito === 'plantilla') {
    return {
      tablaEtapas: 'sede_etapas',
      tablaParams: 'sede_parametros',
      fk: 'sede_etapa_id',
      filtro: 'sede_id',
      valor: sedeId,
    };
  }
  return {
    tablaEtapas: 'periodo_etapas',
    tablaParams: 'periodo_parametros',
    fk: 'periodo_etapa_id',
    filtro: 'periodo_id',
    valor: periodoId,
  };
}

// La clave no se le muestra al usuario: solo sirve para emparejar la
// plantilla con su copia en el período. Se deriva del nombre y se le
// agrega un sufijo si ya está tomada.
function clavear(texto, tomadas) {
  const base =
    texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // marcas de acento sueltas tras el NFD
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'item';
  if (!tomadas.includes(base)) return base;
  let n = 2;
  while (tomadas.includes(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

function textoRef(p) {
  if (p.ref_tipo === 'range') return `${p.ref_min}–${p.ref_max}`;
  if (p.ref_tipo === 'min') return `≥ ${p.ref_valor}`;
  if (p.ref_tipo === 'max') return `≤ ${p.ref_valor}`;
  return `objetivo ${p.ref_valor}`;
}

export default function ParametrosPanel({ sedes, onError, onAviso }) {
  const [sedeId, setSedeId] = useState('');
  const [ambito, setAmbito] = useState('plantilla'); // 'plantilla' | 'periodo'
  const [periodoId, setPeriodoId] = useState('');
  const [periodos, setPeriodos] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!sedeId && sedes.length > 0) setSedeId(String(sedes[0].id));
  }, [sedeId, sedes]);

  const cfg = useMemo(() => config(ambito, Number(sedeId), Number(periodoId)), [ambito, sedeId, periodoId]);

  useEffect(() => {
    if (!sedeId) return;
    supabase
      .from('periodos')
      .select('id, mes, anio')
      .eq('sede_id', Number(sedeId))
      .order('anio', { ascending: false })
      .order('mes', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          onError(error.message);
          return;
        }
        setPeriodos(data || []);
      });
  }, [sedeId, onError]);

  const cargar = useCallback(async () => {
    if (!cfg.valor) {
      setEtapas([]);
      return;
    }
    setCargando(true);
    const { data, error } = await supabase
      .from(cfg.tablaEtapas)
      .select(`id, clave, nombre, icono, color, orden, ${cfg.tablaParams}(id, clave, label, unidad, medicion, ref_tipo, ref_valor, ref_min, ref_max, orden)`)
      .eq(cfg.filtro, cfg.valor)
      .order('orden');
    setCargando(false);
    if (error) {
      onError(error.message);
      return;
    }
    setEtapas(
      (data || []).map((e) => ({
        ...e,
        params: [...(e[cfg.tablaParams] || [])].sort((a, b) => a.orden - b.orden || a.id - b.id),
      }))
    );
  }, [cfg, onError]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Al cambiar de sede el período seleccionado ya no le pertenece.
  useEffect(() => {
    setPeriodoId('');
    setAmbito('plantilla');
  }, [sedeId]);

  async function crearEtapa() {
    const nombre = window.prompt('Nombre de la etapa');
    if (!nombre || !nombre.trim()) return;
    const clave = clavear(nombre, etapas.map((e) => e.clave));
    const orden = etapas.length > 0 ? Math.max(...etapas.map((e) => e.orden)) + 1 : 1;
    const { error } = await supabase
      .from(cfg.tablaEtapas)
      .insert({ [cfg.filtro]: cfg.valor, clave, nombre: nombre.trim(), orden });
    if (error) onError(error.message);
    else cargar();
  }

  const medicionesUsadas = useMemo(
    () => [...new Set(etapas.flatMap((e) => e.params.map((p) => p.medicion)))],
    [etapas]
  );

  if (sedes.length === 0) {
    return (
      <div className="rounded-xl shadow-sm bg-white p-5 text-sm" style={{ border: '1px solid #e2e8f0', color: '#64748b' }}>
        Primero crea una sede — los parámetros se definen por sede.
      </div>
    );
  }

  return (
    <div className="rounded-xl shadow-sm bg-white p-5" style={{ border: '1px solid #e2e8f0' }}>
      <div className="flex flex-wrap gap-2 mb-3">
        <select value={sedeId} onChange={(e) => setSedeId(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={inputStyle}>
          {sedes.map((s) => (
            <option key={s.id} value={s.id}>{s.empresa_nombre} · {s.nombre}</option>
          ))}
        </select>
        <select
          value={ambito === 'plantilla' ? 'plantilla' : periodoId}
          onChange={(e) => {
            if (e.target.value === 'plantilla') {
              setAmbito('plantilla');
              setPeriodoId('');
            } else {
              setAmbito('periodo');
              setPeriodoId(e.target.value);
            }
          }}
          className="rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        >
          <option value="plantilla">Plantilla de la sede</option>
          {periodos.map((p) => (
            <option key={p.id} value={p.id}>Período {p.mes}/{p.anio}</option>
          ))}
        </select>
      </div>

      <div
        className="rounded-lg p-3 mb-4 text-xs"
        style={
          ambito === 'plantilla'
            ? { background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }
            : { background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }
        }
      >
        {ambito === 'plantilla' ? (
          <>
            Estás editando la <strong>plantilla</strong> de la sede: es lo que se copia al crear un período
            nuevo. Los períodos que ya existen conservan los rangos con los que se crearon y no cambian.
          </>
        ) : (
          <>
            Estás editando los rangos <strong>vigentes en este período</strong>. Cambiarlos altera cómo se
            evalúan las mediciones ya cargadas de ese mes. Para cambiar de acá en adelante sin tocar el
            historial, edita la plantilla de la sede.
          </>
        )}
      </div>

      {cargando ? (
        <p className="text-sm" style={{ color: '#94a3b8' }}>Cargando…</p>
      ) : etapas.length === 0 ? (
        <p className="text-sm mb-4" style={{ color: '#94a3b8' }}>Todavía no hay etapas configuradas.</p>
      ) : (
        <div className="space-y-4 mb-4">
          {etapas.map((e) => (
            <Etapa
              key={e.id}
              etapa={e}
              cfg={cfg}
              medicionesUsadas={medicionesUsadas}
              onChange={cargar}
              onError={onError}
              onAviso={onAviso}
            />
          ))}
        </div>
      )}

      <button onClick={crearEtapa} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-white" style={{ background: '#16a34a' }}>
        <Plus size={16} /> Agregar etapa
      </button>
    </div>
  );
}

/* ───────────────────────────── ETAPA ───────────────────────────── */

function Etapa({ etapa, cfg, medicionesUsadas, onChange, onError, onAviso }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(etapa.nombre);
  const [color, setColor] = useState(etapa.color);
  const [icono, setIcono] = useState(etapa.icono);
  const [nuevoParam, setNuevoParam] = useState(false);

  async function guardar() {
    if (!nombre.trim()) return;
    const { error } = await supabase
      .from(cfg.tablaEtapas)
      .update({ nombre: nombre.trim(), color, icono })
      .eq('id', etapa.id);
    if (error) onError(error.message);
    else {
      setEditando(false);
      onChange();
    }
  }

  async function borrar() {
    if (!window.confirm(`¿Borrar la etapa "${etapa.nombre}" y sus ${etapa.params.length} parámetro(s)?`)) return;
    const { error } = await supabase.from(cfg.tablaEtapas).delete().eq('id', etapa.id);
    if (error) onError(error.message);
    else {
      onAviso('Etapa borrada');
      onChange();
    }
  }

  return (
    <div className="rounded-lg" style={{ border: `1px solid ${etapa.color}44` }}>
      <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ background: etapa.color + '11' }}>
        {editando ? (
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="rounded-lg px-2 py-1 text-sm" style={inputStyle} />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Color" className="h-8 w-10 rounded" />
            <select value={icono} onChange={(e) => setIcono(e.target.value)} className="rounded-lg px-2 py-1 text-sm" style={inputStyle}>
              {ICONOS.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
            <button onClick={guardar} title="Guardar" className="rounded-lg p-1.5" style={{ background: '#f0fdf4', color: '#16a34a' }}>
              <Check size={15} />
            </button>
            <button onClick={() => setEditando(false)} title="Cancelar" className="rounded-lg p-1.5" style={{ background: '#fff', color: '#64748b' }}>
              <X size={15} />
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-bold flex items-center gap-2" style={{ color: etapa.color }}>
              <Layers size={15} /> {etapa.nombre}
            </p>
            <div className="flex gap-1">
              <button onClick={() => setEditando(true)} title="Editar etapa" className="rounded-lg p-1.5" style={{ background: '#fff', color: '#64748b' }}>
                <Pencil size={15} />
              </button>
              <button onClick={borrar} title="Borrar etapa" className="rounded-lg p-1.5" style={{ background: '#fff', color: '#dc2626' }}>
                <Trash2 size={15} />
              </button>
            </div>
          </>
        )}
      </div>

      <ul className="divide-y" style={{ borderColor: '#f1f5f9' }}>
        {etapa.params.map((p) => (
          <Parametro
            key={p.id}
            param={p}
            etapa={etapa}
            cfg={cfg}
            medicionesUsadas={medicionesUsadas}
            onChange={onChange}
            onError={onError}
            onAviso={onAviso}
          />
        ))}
      </ul>

      <div className="px-3 py-2">
        {nuevoParam ? (
          <FormParametro
            etapa={etapa}
            cfg={cfg}
            medicionesUsadas={medicionesUsadas}
            onListo={() => {
              setNuevoParam(false);
              onChange();
            }}
            onCancelar={() => setNuevoParam(false)}
            onError={onError}
          />
        ) : (
          <button onClick={() => setNuevoParam(true)} className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#0369a1' }}>
            <Plus size={14} /> Agregar parámetro
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── PARÁMETRO ───────────────────────────── */

function Parametro({ param, etapa, cfg, medicionesUsadas, onChange, onError, onAviso }) {
  const [editando, setEditando] = useState(false);

  async function borrar() {
    if (!window.confirm(`¿Borrar el parámetro "${param.label}"?`)) return;
    const { error } = await supabase.from(cfg.tablaParams).delete().eq('id', param.id);
    if (error) onError(error.message);
    else {
      onAviso('Parámetro borrado');
      onChange();
    }
  }

  if (editando) {
    return (
      <li className="px-3 py-2">
        <FormParametro
          etapa={etapa}
          cfg={cfg}
          param={param}
          medicionesUsadas={medicionesUsadas}
          onListo={() => {
            setEditando(false);
            onChange();
          }}
          onCancelar={() => setEditando(false)}
          onError={onError}
        />
      </li>
    );
  }

  return (
    <li className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium truncate">
          {param.label}
          {param.unidad && <span className="font-normal" style={{ color: '#94a3b8' }}> ({param.unidad})</span>}
        </p>
        <p className="text-xs" style={{ color: '#64748b' }}>
          {textoRef(param)} · agrupa como <span style={{ color: '#94a3b8' }}>{param.medicion}</span>
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        <button onClick={() => setEditando(true)} title="Editar" className="rounded-lg p-1.5" style={{ background: '#f8fafc', color: '#64748b' }}>
          <Pencil size={15} />
        </button>
        <button onClick={borrar} title="Borrar" className="rounded-lg p-1.5" style={{ background: '#f8fafc', color: '#dc2626' }}>
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}

function FormParametro({ etapa, cfg, param, medicionesUsadas, onListo, onCancelar, onError }) {
  const [label, setLabel] = useState(param?.label ?? '');
  const [unidad, setUnidad] = useState(param?.unidad ?? '');
  const [medicion, setMedicion] = useState(param?.medicion ?? '');
  const [refTipo, setRefTipo] = useState(param?.ref_tipo ?? 'target');
  const [refValor, setRefValor] = useState(param?.ref_valor ?? '');
  const [refMin, setRefMin] = useState(param?.ref_min ?? '');
  const [refMax, setRefMax] = useState(param?.ref_max ?? '');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!label.trim()) {
      onError('El nombre del parámetro es obligatorio');
      return;
    }
    // 'medicion' es lo que superpone el mismo ensayo entre etapas en la
    // gráfica de tendencia; si se deja vacío, el parámetro queda solo en
    // su propia serie.
    const medFinal = (medicion.trim() || label.trim()).toLowerCase();

    const esRango = refTipo === 'range';
    if (esRango) {
      if (refMin === '' || refMax === '' || Number(refMin) >= Number(refMax)) {
        onError('En un rango, el mínimo tiene que ser menor que el máximo');
        return;
      }
    } else if (refValor === '') {
      onError('Indica el valor de referencia');
      return;
    }

    const fila = {
      label: label.trim(),
      unidad: unidad.trim(),
      medicion: medFinal,
      ref_tipo: refTipo,
      ref_valor: esRango ? null : Number(refValor),
      ref_min: esRango ? Number(refMin) : null,
      ref_max: esRango ? Number(refMax) : null,
    };

    setGuardando(true);
    let error;
    if (param) {
      ({ error } = await supabase.from(cfg.tablaParams).update(fila).eq('id', param.id));
    } else {
      const orden = etapa.params.length > 0 ? Math.max(...etapa.params.map((p) => p.orden)) + 1 : 1;
      ({ error } = await supabase.from(cfg.tablaParams).insert({
        ...fila,
        [cfg.fk]: etapa.id,
        clave: clavear(label, etapa.params.map((p) => p.clave)),
        orden,
      }));
    }
    setGuardando(false);
    if (error) onError(error.message);
    else onListo();
  }

  return (
    <div className="rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nombre (ej. pH)" className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle} />
        <input value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="Unidad (ej. ppm)" className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle} />
        <input
          value={medicion}
          onChange={(e) => setMedicion(e.target.value)}
          list="mediciones-usadas"
          placeholder="Agrupa como (ej. ph)"
          title="Parámetros con el mismo valor acá se comparan entre sí en la gráfica de tendencia"
          className="rounded-lg px-2 py-1.5 text-sm"
          style={inputStyle}
        />
        <datalist id="mediciones-usadas">
          {medicionesUsadas.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <select value={refTipo} onChange={(e) => setRefTipo(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle}>
          {TIPOS_REF.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {refTipo === 'range' ? (
          <>
            <input type="number" step="any" value={refMin} onChange={(e) => setRefMin(e.target.value)} placeholder="Mínimo" className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle} />
            <input type="number" step="any" value={refMax} onChange={(e) => setRefMax(e.target.value)} placeholder="Máximo" className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle} />
          </>
        ) : (
          <input type="number" step="any" value={refValor} onChange={(e) => setRefValor(e.target.value)} placeholder="Valor" className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle} />
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={guardar}
          disabled={guardando}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold text-white"
          style={{ background: '#16a34a', opacity: guardando ? 0.7 : 1 }}
        >
          <Check size={15} /> {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={onCancelar} className="rounded-lg px-3 py-1.5 text-sm font-semibold" style={{ background: '#f1f5f9', color: '#475569' }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
