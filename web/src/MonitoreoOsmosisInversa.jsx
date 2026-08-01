import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import {
  CheckCircle2,
  AlertTriangle,
  CloudOff,
  ChevronLeft,
  ChevronRight,
  Download,
  Beaker,
  Wind,
  Filter,
  FlaskConical,
  Activity,
  RefreshCw,
} from "lucide-react";
import ExcelJS from "exceljs";
import { supabase } from "./lib/supabase";
import { useOnline } from "./lib/useOnline";
import { leerCola, encolar, quitarDeCola } from "./lib/colaOffline";

/* ───────────────────────────── MODELO DE DATOS ───────────────────────────── */

// Las etapas y sus parámetros ya no son una constante: cada sede define
// los suyos, y cada período conserva congelada la copia que regía cuando
// se creó (ver db/migrations/0002). El componente los recibe cargados
// desde periodo_etapas / periodo_parametros.

const ICON_MAP = { Beaker, Wind, Filter, FlaskConical, Activity };

// Normaliza una fila de periodo_parametros a la forma que usa el resto
// del componente. El 'ref' anidado es el mismo contrato que tenía la
// constante ETAPAS, así que evaluar() y refLabel() no cambian.
function normalizarParametro(fila) {
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    id: fila.id,
    clave: fila.clave,
    label: fila.label,
    unidad: fila.unidad || "",
    medicion: fila.medicion,
    ref: {
      type: fila.ref_tipo,
      value: num(fila.ref_valor),
      min: num(fila.ref_min),
      max: num(fila.ref_max),
    },
  };
}

const paramDeEtapa = (etapa, medKey) => etapa.params.find((p) => p.medicion === medKey);

/* ───────────────────────────── UTILIDADES ───────────────────────────── */

function fmt(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : Number(n.toFixed(3)).toString();
}

function refLabel(param) {
  const r = param.ref;
  if (r.type === "range") return `${fmt(r.min)}–${fmt(r.max)}`;
  if (r.type === "min") return `≥ ${fmt(r.value)}`;
  if (r.type === "max") return `≤ ${fmt(r.value)}`;
  return fmt(r.value);
}

// Devuelve { status: 'ok'|'revisar'|'fuera'|'sin'|'invalid', n }
function evaluar(param, raw, tolPct) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return { status: "sin" };
  const n = Number(String(raw).replace(",", "."));
  if (Number.isNaN(n)) return { status: "invalid" };
  const r = param.ref;
  if (r.type === "range") {
    if (n < r.min || n > r.max) return { status: "fuera", n };
    return { status: "ok", n };
  }
  if (r.type === "min") {
    if (n < r.value) return { status: "fuera", n };
    return { status: "ok", n };
  }
  if (r.type === "max") {
    if (n > r.value) return { status: "fuera", n };
    return { status: "ok", n };
  }
  // target
  if (r.value === 0) {
    if (Math.abs(n) > 0.05) return { status: "revisar", n };
    return { status: "ok", n };
  }
  const dev = Math.abs(n - r.value) / Math.max(r.value, 0.01);
  if (dev > tolPct / 100) return { status: "revisar", n };
  return { status: "ok", n };
}

const STATUS_COLOR = {
  ok: "#16a34a",
  revisar: "#f59e0b",
  fuera: "#dc2626",
  invalid: "#dc2626",
  sin: "#94a3b8",
};
const STATUS_BG = {
  ok: "#f0fdf4",
  revisar: "#fffbeb",
  fuera: "#fef2f2",
  invalid: "#fef2f2",
  sin: "#f8fafc",
};

function esAlerta(status) {
  return status === "revisar" || status === "fuera" || status === "invalid";
}

const inputStyle = { border: "1.5px solid #cbd5e1", background: "#fff", outline: "none", color: "#0f172a" };

function navBtnStyle(disabled) {
  return {
    background: disabled ? "#f1f5f9" : "#fff",
    color: disabled ? "#cbd5e1" : "#475569",
    border: "1px solid #e2e8f0",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function StatusBadge({ status }) {
  if (status === "sin") return <span className="shrink-0 text-xs" style={{ color: "#94a3b8" }}>—</span>;
  if (status === "ok") return <CheckCircle2 size={18} className="shrink-0" style={{ color: "#16a34a" }} />;
  if (status === "revisar") return <AlertTriangle size={18} className="shrink-0" style={{ color: "#f59e0b" }} />;
  return <AlertTriangle size={18} className="shrink-0" style={{ color: "#dc2626" }} />;
}

function Card({ title, value, sub, color, Icon }) {
  return (
    <div className="rounded-xl shadow-sm bg-white p-5" style={{ border: "1px solid #e2e8f0" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>{title}</p>
        <div className="rounded-lg p-1.5" style={{ background: color + "18", color }}>
          <Icon size={18} />
        </div>
      </div>
      <p className="text-3xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>{sub}</p>
    </div>
  );
}

/* ───────────────────────────── COMPONENTE PRINCIPAL ───────────────────────────── */

export default function MonitoreoOsmosisInversa({ usuario, sede, periodo, onCambiarPeriodo }) {
  const [etapas, setEtapas] = useState([]); // del período, congeladas
  const [registros, setRegistros] = useState({}); // { dia: { parametroId: rawValue } }
  const [duenos, setDuenos] = useState({}); // { dia: { parametroId: { usuario_id, usuario_nombre } } }
  const [fase, setFase] = useState(1); // 1 Capturar · 2 Tabla · 3 Resumen
  const [diaActual, setDiaActual] = useState(1);
  const [etapaActual, setEtapaActual] = useState(0);
  const [confirmados, setConfirmados] = useState({}); // `${dia}:${parametroId}` -> true
  const [medicion, setMedicion] = useState(null);
  const [etapasVisibles, setEtapasVisibles] = useState({});
  const [toast, setToast] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [guardado, setGuardado] = useState({}); // `${dia}:${parametroId}` -> 'guardando' | 'ok' | 'error' | 'pendiente'
  const timersRef = useRef({});
  const avisoTimersRef = useRef({});
  const vaciandoRef = useRef(false);
  const online = useOnline();
  const pendientesCount = useMemo(
    () => Object.values(guardado).filter((v) => v === "pendiente").length,
    [guardado]
  );

  const tol = Number(periodo.tolerancia) || 10;
  const dias = Number(periodo.dias) || 31;

  function mostrarToast(tipo, msg) {
    setToast({ tipo, msg });
    setTimeout(() => setToast(null), 3200);
  }

  // El "guardado ✓" se borra solo a los dos segundos: sirve como acuse de
  // recibo, pero dejarlo fijo llenaría la pantalla de tildes verdes. El
  // 'error' se queda hasta que el reintento funcione — es justo el estado
  // que no se puede dejar pasar de largo.
  function marcarGuardado(key, estado) {
    clearTimeout(avisoTimersRef.current[key]);
    setGuardado((prev) => {
      if (estado === null) {
        const nuevo = { ...prev };
        delete nuevo[key];
        return nuevo;
      }
      return { ...prev, [key]: estado };
    });
    if (estado === 'ok') {
      avisoTimersRef.current[key] = setTimeout(() => {
        setGuardado((prev) => {
          const nuevo = { ...prev };
          delete nuevo[key];
          return nuevo;
        });
      }, 2000);
    }
  }

  // Los debounces y los timers del acuse quedarían corriendo contra un
  // componente ya desmontado si se cambia de período con algo a medio
  // guardar.
  useEffect(() => {
    const debounces = timersRef.current;
    const avisos = avisoTimersRef.current;
    return () => {
      Object.values(debounces).forEach(clearTimeout);
      Object.values(avisos).forEach(clearTimeout);
    };
  }, []);

  // Las etapas del período se leen una sola vez: están congeladas, así
  // que no hay nada que refrescar salvo que un admin las edite, y en ese
  // caso vuelve a entrar al período.
  const cargarEtapas = useCallback(async () => {
    const { data, error } = await supabase
      .from("periodo_etapas")
      .select("id, clave, nombre, icono, color, orden, periodo_parametros(id, clave, label, unidad, medicion, ref_tipo, ref_valor, ref_min, ref_max, orden)")
      .eq("periodo_id", periodo.id)
      .order("orden");
    if (error) throw error;
    return (data || []).map((e) => ({
      id: e.id,
      clave: e.clave,
      nombre: e.nombre,
      icon: e.icono,
      color: e.color,
      params: [...(e.periodo_parametros || [])]
        .sort((a, b) => a.orden - b.orden || a.id - b.id)
        .map(normalizarParametro),
    }));
  }, [periodo.id]);

  const cargarMediciones = useCallback(
    async (silencioso) => {
      if (!silencioso) setRefrescando(true);
      try {
        const { data, error } = await supabase
          .from("mediciones")
          .select("dia, parametro_id, valor, usuario_id, usuarios(nombre)")
          .eq("periodo_id", periodo.id);
        if (error) throw error;
        const regs = {};
        const dus = {};
        for (const row of data || []) {
          regs[row.dia] = { ...(regs[row.dia] || {}), [row.parametro_id]: row.valor === null ? "" : row.valor };
          dus[row.dia] = {
            ...(dus[row.dia] || {}),
            [row.parametro_id]: { usuario_id: row.usuario_id, usuario_nombre: row.usuarios?.nombre },
          };
        }
        setRegistros(regs);
        setDuenos(dus);
      } catch (e) {
        mostrarToast("error", e.message || "No se pudieron cargar las mediciones");
      } finally {
        if (!silencioso) setRefrescando(false);
      }
    },
    [periodo.id]
  );

  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const cargadas = await cargarEtapas();
        if (!vigente) return;
        setEtapas(cargadas);
        setEtapasVisibles(Object.fromEntries(cargadas.map((e) => [e.id, true])));
        setMedicion(cargadas.flatMap((e) => e.params)[0]?.medicion ?? null);
      } catch (e) {
        if (vigente) mostrarToast("error", e.message || "No se pudo cargar la configuración del período");
      }
      await cargarMediciones(true);
      if (!vigente) return;

      // Lo que haya quedado en la cola local es más reciente que lo que
      // acaba de devolver el servidor (todavía no llegó a escribirse):
      // se superpone para no perder el valor tipeado ni el aviso
      // "pendiente" si la página se recargó con algo sin enviar.
      const cola = leerCola(periodo.id);
      const claves = Object.values(cola);
      if (claves.length > 0) {
        setRegistros((prev) => {
          const nuevo = { ...prev };
          for (const { dia, parametroId, valor } of claves) {
            nuevo[dia] = { ...(nuevo[dia] || {}) };
            if (valor === null) delete nuevo[dia][parametroId];
            else nuevo[dia][parametroId] = valor;
          }
          return nuevo;
        });
        setGuardado((prev) => {
          const nuevo = { ...prev };
          for (const { dia, parametroId } of claves) nuevo[`${dia}:${parametroId}`] = "pendiente";
          return nuevo;
        });
      }

      setCargando(false);
    })();
    return () => {
      vigente = false;
    };
  }, [cargarEtapas, cargarMediciones, periodo.id]);

  const todosParams = useMemo(
    () =>
      etapas.flatMap((e) =>
        e.params.map((p) => ({ ...p, etapa: e.id, etapaNombre: e.nombre, etapaColor: e.color }))
      ),
    [etapas]
  );

  // Las mediciones comparables entre etapas salen de los propios
  // parámetros: todos los que comparten 'medicion' son el mismo ensayo en
  // distintos puntos del proceso, y son los que la gráfica superpone.
  const medicionesDisponibles = useMemo(() => {
    const vistas = new Map();
    for (const p of todosParams) {
      if (!vistas.has(p.medicion)) vistas.set(p.medicion, { key: p.medicion, label: p.label, unidad: p.unidad });
    }
    return [...vistas.values()];
  }, [todosParams]);

  // `status === 0` es la señal que arma postgrest-js cuando el propio
  // fetch nunca llegó a tener respuesta (sin conexión, DNS caído, etc.) —
  // no viene de PostgREST, así que es fiable para distinguir "transitorio,
  // reintentar solo" de un rechazo real del servidor (valor fuera de
  // rango, conflicto de dueño, o período/parámetro que ya no existe).
  function clasificarError(error, status) {
    if (status === 0) return { tipo: "red" };
    if (/mediciones_valor_check/.test(error.message || "")) {
      return { tipo: "rechazo", mensaje: "Valor fuera de rango permitido" };
    }
    if (error.code === "PGRST116") {
      return { tipo: "rechazo", mensaje: "Otro usuario ya escribió este valor. Actualizá para ver el valor vigente." };
    }
    if (error.code === "23503") {
      return { tipo: "rechazo", mensaje: "El período o parámetro ya no existe." };
    }
    return { tipo: "rechazo", mensaje: error.message || "No se pudo guardar el valor" };
  }

  // El upsert/delete real, sin manejo de estado — lo usan tanto
  // guardarCelda (la escritura en vivo) como vaciarCola (el reintento
  // automático de lo que quedó pendiente offline).
  async function enviarMedicion(dia, parametroId, valorNum) {
    if (valorNum === null) {
      const { error, status } = await supabase
        .from("mediciones")
        .delete()
        .eq("periodo_id", periodo.id)
        .eq("dia", dia)
        .eq("parametro_id", parametroId);
      if (error) throw clasificarError(error, status);
      return null;
    }

    const { data, error, status } = await supabase
      .from("mediciones")
      .upsert(
        { periodo_id: periodo.id, dia, parametro_id: parametroId, valor: valorNum, usuario_id: usuario.id },
        { onConflict: "periodo_id,dia,parametro_id" }
      )
      .select("usuario_id, usuarios(nombre)")
      .single();
    if (error) throw clasificarError(error, status);
    return { usuario_id: data.usuario_id, usuario_nombre: data.usuarios?.nombre };
  }

  async function guardarCelda(dia, parametroId, valorRaw) {
    const key = `${dia}:${parametroId}`;
    const vacio = valorRaw === "" || valorRaw === undefined || valorRaw === null;

    marcarGuardado(key, "guardando");

    let valorNum = null;
    if (!vacio) {
      const valorStr = String(valorRaw).replace(",", ".").trim();
      if (!valorStr || Number.isNaN(Number(valorStr))) {
        // No es un guardado fallido sino un valor que todavía no es un
        // número; la celda ya lo señala como "invalid" por su cuenta.
        marcarGuardado(key, null);
        return;
      }
      valorNum = Number(valorStr);
    }

    try {
      const dueño = await enviarMedicion(dia, parametroId, valorNum);
      setDuenos((prev) => {
        const dia_ = { ...(prev[dia] || {}) };
        if (dueño) dia_[parametroId] = dueño;
        else delete dia_[parametroId];
        return { ...prev, [dia]: dia_ };
      });
      quitarDeCola(periodo.id, dia, parametroId);
      marcarGuardado(key, "ok");
    } catch (e) {
      if (e.tipo === "red") {
        // Sin conexión: se guarda localmente y se reintenta solo al
        // reconectar (ver vaciarCola). No es un error para avisar con
        // toast, es el caso esperado.
        encolar(periodo.id, dia, parametroId, valorNum);
        marcarGuardado(key, "pendiente");
        return;
      }
      quitarDeCola(periodo.id, dia, parametroId);
      marcarGuardado(key, "error");
      mostrarToast("error", e.mensaje || "No se pudo guardar el valor");
    }
  }

  // Reenvía lo que haya quedado en la cola local. Se dispara al montar
  // (por si quedó algo pendiente de una sesión anterior) y cada vez que
  // el navegador avisa que volvió la conexión. `vaciandoRef` evita que
  // dos disparos superpuestos (mount + un 'online' casi simultáneo)
  // procesen la misma cola en paralelo.
  async function vaciarCola() {
    if (vaciandoRef.current) return;
    vaciandoRef.current = true;
    try {
      const cola = leerCola(periodo.id);
      for (const { dia, parametroId, valor } of Object.values(cola)) {
        const key = `${dia}:${parametroId}`;
        marcarGuardado(key, "guardando");
        try {
          const dueño = await enviarMedicion(dia, parametroId, valor);
          setDuenos((prev) => {
            const dia_ = { ...(prev[dia] || {}) };
            if (dueño) dia_[parametroId] = dueño;
            else delete dia_[parametroId];
            return { ...prev, [dia]: dia_ };
          });
          quitarDeCola(periodo.id, dia, parametroId);
          marcarGuardado(key, "ok");
        } catch (e) {
          if (e.tipo === "red") {
            // Se volvió a cortar la conexión a mitad del reenvío: se deja
            // en la cola y no tiene sentido seguir con el resto ahora.
            marcarGuardado(key, "pendiente");
            break;
          }
          quitarDeCola(periodo.id, dia, parametroId);
          marcarGuardado(key, "error");
          mostrarToast("error", e.mensaje || "No se pudo guardar el valor");
        }
      }
    } finally {
      vaciandoRef.current = false;
    }
  }

  // No incluye vaciarCola en las dependencias a propósito: se redefine en
  // cada render (no está en useCallback) y lo único que debe disparar el
  // reintento es el cambio de `online`, no cada render.
  useEffect(() => {
    if (online) vaciarCola();
  }, [online]);

  function setValor(dia, parametroId, valor, { debounced } = {}) {
    setRegistros((prev) => {
      const nuevo = { ...prev, [dia]: { ...(prev[dia] || {}), [parametroId]: valor } };
      if (valor === "") delete nuevo[dia][parametroId];
      return nuevo;
    });
    setConfirmados((prev) => {
      const c = { ...prev };
      delete c[`${dia}:${parametroId}`];
      return c;
    });

    const key = `${dia}:${parametroId}`;
    clearTimeout(timersRef.current[key]);
    if (debounced) {
      timersRef.current[key] = setTimeout(() => guardarCelda(dia, parametroId, valor), 800);
    } else {
      guardarCelda(dia, parametroId, valor);
    }
  }

  function handleBlur(dia, parametroId, valor) {
    const key = `${dia}:${parametroId}`;
    clearTimeout(timersRef.current[key]);
    guardarCelda(dia, parametroId, valor);
  }

  /* ── Resumen calculado ── */
  const resumen = useMemo(() => {
    let diasRegistrados = 0;
    let diasConAlertas = 0;
    let celdasEvaluadas = 0;
    let celdasOk = 0;
    const diasFuera = [];

    for (let d = 1; d <= dias; d++) {
      const reg = registros[d] || {};
      const claves = Object.keys(reg).filter((k) => String(reg[k]).trim() !== "");
      if (claves.length === 0) continue;
      diasRegistrados++;
      const detalles = [];
      for (const p of todosParams) {
        const ev = evaluar(p, reg[p.id], tol);
        if (ev.status === "sin") continue;
        if (ev.status !== "invalid") celdasEvaluadas++;
        if (ev.status === "ok") celdasOk++;
        if (esAlerta(ev.status)) detalles.push({ param: p, status: ev.status, n: ev.n });
      }
      if (detalles.length > 0) {
        diasConAlertas++;
        diasFuera.push({ dia: d, detalles });
      }
    }

    const cumplimiento = celdasEvaluadas > 0 ? Math.round((celdasOk / celdasEvaluadas) * 100) : 0;

    const promedios = todosParams.map((p) => {
      const vals = [];
      for (let d = 1; d <= dias; d++) {
        const ev = evaluar(p, (registros[d] || {})[p.id], tol);
        if (ev.status !== "sin" && ev.status !== "invalid") vals.push(ev.n);
      }
      if (vals.length === 0) return { param: p, prom: null, status: "sin", n: 0 };
      const prom = vals.reduce((a, b) => a + b, 0) / vals.length;
      const ev = evaluar(p, prom, tol);
      return { param: p, prom, status: ev.status, n: vals.length };
    });

    return { diasRegistrados, diasConAlertas, cumplimiento, promedios, diasFuera, totalDias: dias };
  }, [registros, dias, tol, todosParams]);

  const chartData = useMemo(() => {
    const med = medicionesDisponibles.find((m) => m.key === medicion) || medicionesDisponibles[0];
    if (!med) return { puntos: [], med: null, series: [], hayDatos: false, totalConDatos: 0, mostrados: 0 };
    const series = etapas.map((et) => ({ etapa: et, param: paramDeEtapa(et, med.key) })).filter((s) => s.param);
    const mm = String(periodo.mes).padStart(2, "0");
    const conDatos = [];
    for (let d = 1; d <= dias; d++) {
      const punto = { dia: d, fecha: `${String(d).padStart(2, "0")}/${mm}/${periodo.anio}` };
      let tieneAlguno = false;
      for (const s of series) {
        const ev = evaluar(s.param, (registros[d] || {})[s.param.id], tol);
        if (ev.status !== "sin" && ev.status !== "invalid") {
          punto[s.etapa.id] = ev.n;
          tieneAlguno = true;
        }
      }
      if (tieneAlguno) conDatos.push(punto);
    }
    const MAX = 10;
    const puntos = conDatos.length > MAX ? conDatos.slice(conDatos.length - MAX) : conDatos;
    return { puntos, med, series, hayDatos: conDatos.length > 0, totalConDatos: conDatos.length, mostrados: puntos.length };
  }, [registros, dias, periodo.mes, periodo.anio, medicion, tol, etapas, medicionesDisponibles]);

  const seriesVisibles = chartData.series.filter((s) => etapasVisibles[s.etapa.id]);
  const refUnica = seriesVisibles.length === 1 ? seriesVisibles[0].param : null;

  let refBand = null; // { y1, y2 }
  let refLines = []; // [{ key, y, stroke, dash, width, label, pos }]
  if (refUnica) {
    const r = refUnica.ref;
    if (r.type === "range") {
      refBand = { y1: r.min, y2: r.max };
      refLines = [
        { key: "min", y: r.min, stroke: "#dc2626", dash: "5 4", width: 1.5, label: `mín ${fmt(r.min)}`, pos: "insideBottomLeft" },
        { key: "max", y: r.max, stroke: "#dc2626", dash: "5 4", width: 1.5, label: `máx ${fmt(r.max)}`, pos: "insideTopLeft" },
      ];
    } else if (r.type === "min") {
      refLines = [{ key: "min", y: r.value, stroke: "#dc2626", dash: "5 4", width: 1.5, label: `mín ${fmt(r.value)}`, pos: "insideBottomLeft" }];
    } else if (r.type === "max") {
      refLines = [{ key: "max", y: r.value, stroke: "#dc2626", dash: "5 4", width: 1.5, label: `máx ${fmt(r.value)}`, pos: "insideTopLeft" }];
    } else {
      const v = r.value;
      const lo = v === 0 ? null : v * (1 - tol / 100);
      const hi = v === 0 ? 0.05 : v * (1 + tol / 100);
      if (lo !== null) {
        refBand = { y1: lo, y2: hi };
        refLines.push({ key: "lo", y: lo, stroke: "#f59e0b", dash: "3 3", width: 1, label: `−${tol}%`, pos: "insideBottomLeft" });
      }
      refLines.push({ key: "hi", y: hi, stroke: "#f59e0b", dash: "3 3", width: 1, label: v === 0 ? `límite ${fmt(hi)}` : `+${tol}%`, pos: "insideTopLeft" });
      refLines.push({ key: "obj", y: v, stroke: "#16a34a", dash: "5 4", width: 1.5, label: `objetivo ${fmt(v)}`, pos: "insideTopLeft" });
    }
  }

  /* ── Exportar a Excel ── */
  async function exportar() {
    try {
      const totalCols = todosParams.length + 1;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Monitoreo");

      ws.addRow([`Monitoreo Ósmosis Inversa — ${sede.empresa_nombre} · ${sede.nombre} · ${periodo.mes}/${periodo.anio}`]);
      ws.addRow([]);

      const row1 = ["Día"];
      const merges = [];
      let col = 1;
      etapas.forEach((et) => {
        row1.push(et.nombre);
        for (let i = 1; i < et.params.length; i++) row1.push("");
        if (et.params.length > 1) merges.push([3, col + 1, 3, col + et.params.length]);
        col += et.params.length;
      });
      ws.addRow(row1);

      const row2 = ["Ref:"];
      etapas.forEach((et) => et.params.forEach((p) => row2.push(`${p.label}${p.unidad ? " (" + p.unidad + ")" : ""} · ${refLabel(p)}`)));
      ws.addRow(row2);

      for (let d = 1; d <= dias; d++) {
        const row = [d];
        etapas.forEach((et) =>
          et.params.forEach((p) => {
            const raw = (registros[d] || {})[p.id];
            if (raw === undefined || String(raw).trim() === "") {
              row.push("");
            } else {
              const num = Number(String(raw).replace(",", "."));
              row.push(Number.isNaN(num) ? raw : num);
            }
          })
        );
        ws.addRow(row);
      }

      ws.mergeCells(1, 1, 1, totalCols);
      merges.forEach((m) => ws.mergeCells(...m));
      ws.getColumn(1).width = 6;
      for (let i = 0; i < todosParams.length; i++) ws.getColumn(i + 2).width = 16;

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Monitoreo_OsmosisInversa_${periodo.mes}_${periodo.anio}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      mostrarToast("success", "Excel exportado");
    } catch {
      mostrarToast("error", "No se pudo generar el Excel");
    }
  }

  function irDia(delta) {
    setDiaActual((d) => Math.min(dias, Math.max(1, d + delta)));
  }
  function irEtapa(delta) {
    setEtapaActual((e) => Math.min(etapas.length - 1, Math.max(0, e + delta)));
  }

  // etapas llega vacío mientras carga, y puede seguir vacío si alguien
  // borró toda la configuración del período; los hooks de abajo tienen que
  // correr igual, así que se resuelve con un valor nulo y se corta recién
  // en el render.
  const etapa = etapas[etapaActual] ?? null;
  const EtapaIcon = (etapa && ICON_MAP[etapa.icon]) || Beaker;

  const alertasDia = useMemo(() => {
    const reg = registros[diaActual] || {};
    const lista = [];
    for (const p of todosParams) {
      const ev = evaluar(p, reg[p.id], tol);
      if (esAlerta(ev.status)) lista.push({ param: p, ...ev });
    }
    return lista;
  }, [registros, diaActual, tol, todosParams]);

  const progresoPct = Math.round((diaActual / dias) * 100);

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-20 text-sm" style={{ color: "#94a3b8" }}>
        Cargando mediciones…
      </div>
    );
  }

  if (etapas.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-20 px-4 text-sm" style={{ color: "#64748b" }}>
        Este período no tiene etapas ni parámetros configurados. Un administrador puede definirlos
        desde <strong>Panel de administración → Parámetros</strong>.
      </div>
    );
  }

  /* ───────────────────────────── RENDER ───────────────────────────── */
  return (
    <div className="w-full">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        {/* Encabezado del período */}
        <div className="rounded-xl shadow-sm p-4 mb-5 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" style={{ border: "1px solid #e2e8f0" }}>
          <div>
            <p className="text-sm font-bold">{sede.empresa_nombre} · {sede.nombre}</p>
            <p className="text-xs" style={{ color: "#64748b" }}>Período {periodo.mes}/{periodo.anio} · {dias} días · tolerancia ±{tol}%</p>
          </div>
          <div className="flex items-center gap-2">
            {(!online || pendientesCount > 0) && (
              <span
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
                style={{ background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" }}
              >
                <CloudOff size={14} /> {online ? `${pendientesCount} cambio${pendientesCount === 1 ? "" : "s"} por enviar` : "Sin conexión"}
              </span>
            )}
            <button onClick={() => cargarMediciones(false)} disabled={refrescando} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold" style={navBtnStyle(false)}>
              <RefreshCw size={15} className={refrescando ? "animate-spin" : ""} /> Actualizar
            </button>
            <button onClick={exportar} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-white" style={{ background: "#0369a1" }}>
              <Download size={15} /> Exportar
            </button>
            <button onClick={onCambiarPeriodo} className="rounded-lg px-3 py-2 text-xs font-semibold" style={navBtnStyle(false)}>
              Cambiar período
            </button>
          </div>
        </div>

        {/* NAV DE FASES */}
        <nav className="flex flex-wrap gap-2 mb-5">
          {[
            { n: 1, t: "Capturar" },
            { n: 2, t: "Tabla" },
            { n: 3, t: "Resumen" },
          ].map((f) => {
            const activa = fase === f.n;
            return (
              <button
                key={f.n}
                onClick={() => setFase(f.n)}
                className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition"
                style={{
                  background: activa ? "#0369a1" : "#ffffff",
                  color: activa ? "#ffffff" : "#475569",
                  border: activa ? "1px solid #0369a1" : "1px solid #e2e8f0",
                  boxShadow: activa ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}
              >
                <span className="inline-flex items-center justify-center rounded-full w-5 h-5 text-xs font-bold" style={{ background: activa ? "rgba(255,255,255,0.25)" : "#e2e8f0", color: activa ? "#fff" : "#64748b" }}>
                  {f.n}
                </span>
                {f.t}
              </button>
            );
          })}
        </nav>

        {/* ───── FASE 1 — CAPTURAR ───── */}
        {fase === 1 && (
          <section className="rounded-xl shadow-sm p-5 sm:p-6 bg-white" style={{ border: "1px solid #e2e8f0" }}>
            {/* Nav día */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <button onClick={() => irDia(-1)} disabled={diaActual <= 1} className="rounded-lg p-2.5" style={navBtnStyle(diaActual <= 1)}>
                  <ChevronLeft size={18} />
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: "#475569" }}>Día</span>
                  <select value={diaActual} onChange={(e) => setDiaActual(Number(e.target.value))} className="rounded-lg px-3 py-2 text-sm font-bold" style={inputStyle}>
                    {Array.from({ length: dias }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <span className="text-sm" style={{ color: "#94a3b8" }}>de {dias}</span>
                </div>
                <button onClick={() => irDia(1)} disabled={diaActual >= dias} className="rounded-lg p-2.5" style={navBtnStyle(diaActual >= dias)}>
                  <ChevronRight size={18} />
                </button>
              </div>
              <div className="flex-1 sm:max-w-xs">
                <div className="flex justify-between text-xs mb-1" style={{ color: "#64748b" }}>
                  <span>Progreso del mes</span>
                  <span className="font-semibold">{progresoPct}%</span>
                </div>
                <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "#e2e8f0" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${progresoPct}%`, background: "#0ea5e9" }} />
                </div>
              </div>
            </div>

            {/* Tabs de etapa */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {etapas.map((et, i) => {
                const Icn = ICON_MAP[et.icon] || Beaker;
                const activa = i === etapaActual;
                return (
                  <button key={et.id} onClick={() => setEtapaActual(i)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition" style={{ background: activa ? et.color : "#f1f5f9", color: activa ? "#fff" : "#475569" }}>
                    <Icn size={15} /> <span className="hidden sm:inline">{et.nombre}</span><span className="sm:hidden">{i + 1}</span>
                  </button>
                );
              })}
            </div>

            {/* Card de etapa actual */}
            <div className="rounded-xl p-5" style={{ background: STATUS_BG.sin, border: `2px solid ${etapa.color}22` }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="rounded-lg p-2 text-white" style={{ background: etapa.color }}>
                  <EtapaIcon size={20} />
                </div>
                <div>
                  <p className="text-xs font-semibold" style={{ color: "#94a3b8" }}>
                    Etapa {etapaActual + 1}/{etapas.length}
                  </p>
                  <h3 className="text-base font-bold" style={{ color: etapa.color }}>{etapa.nombre}</h3>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {etapa.params.map((p) => {
                  const raw = (registros[diaActual] || {})[p.id] ?? "";
                  const ev = evaluar(p, raw, tol);
                  const fueraVisible = esAlerta(ev.status) && !confirmados[`${diaActual}:${p.id}`];
                  const dueño = (duenos[diaActual] || {})[p.id];
                  const soloLectura = !!dueño && usuario.rol === "operario" && dueño.usuario_id !== usuario.id;
                  const estadoGuardado = guardado[`${diaActual}:${p.id}`];
                  return (
                    <div key={p.id} className="rounded-lg p-3 bg-white" style={{ border: `1px solid ${ev.status === "sin" ? "#e2e8f0" : STATUS_COLOR[ev.status] + "55"}` }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm font-semibold">{p.label}</label>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#f1f5f9", color: "#64748b" }}>
                          ref: {refLabel(p)} {p.unidad}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          inputMode="decimal"
                          value={raw}
                          disabled={soloLectura}
                          onChange={(e) => setValor(diaActual, p.id, e.target.value, { debounced: true })}
                          onBlur={(e) => handleBlur(diaActual, p.id, e.target.value)}
                          placeholder="—"
                          className="w-full rounded-lg px-3 py-2.5 text-sm font-medium"
                          style={{
                            border: `1.5px solid ${ev.status === "sin" ? "#cbd5e1" : STATUS_COLOR[ev.status]}`,
                            background: soloLectura ? "#f8fafc" : STATUS_BG[ev.status],
                            outline: "none",
                          }}
                        />
                        {p.unidad && <span className="text-xs shrink-0" style={{ color: "#94a3b8" }}>{p.unidad}</span>}
                        <StatusBadge status={ev.status} />
                      </div>
                      {ev.status === "invalid" && (
                        <p className="text-xs mt-2 font-medium" style={{ color: "#dc2626" }}>Ingresa un número.</p>
                      )}
                      {estadoGuardado === "guardando" && (
                        <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: "#94a3b8" }}>
                          <RefreshCw size={12} className="animate-spin" /> Guardando…
                        </p>
                      )}
                      {estadoGuardado === "ok" && (
                        <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: "#16a34a" }}>
                          <CheckCircle2 size={12} /> Guardado
                        </p>
                      )}
                      {estadoGuardado === "pendiente" && (
                        <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: "#b45309" }}>
                          <CloudOff size={12} /> Sin conexión — se guardará solo
                        </p>
                      )}
                      {estadoGuardado === "error" && (
                        <div className="text-xs mt-2 flex items-center gap-2" style={{ color: "#dc2626" }}>
                          <span className="flex items-center gap-1.5 font-semibold">
                            <AlertTriangle size={12} /> No se guardó
                          </span>
                          <button
                            onClick={() => guardarCelda(diaActual, p.id, raw)}
                            className="rounded px-2 py-0.5 font-semibold text-white"
                            style={{ background: "#dc2626" }}
                          >
                            Reintentar
                          </button>
                        </div>
                      )}
                      {soloLectura && (
                        <p className="text-xs mt-2" style={{ color: "#94a3b8" }}>Cargado por {dueño.usuario_nombre}. Solo esa persona puede editarlo.</p>
                      )}
                      {fueraVisible && !soloLectura && (
                        <div className="mt-2 rounded-lg p-2 text-xs" style={{ background: STATUS_BG[ev.status], color: STATUS_COLOR[ev.status] }}>
                          <p className="font-semibold mb-1">Fuera de referencia (esperado: {refLabel(p)} {p.unidad}). ¿Confirmar o corregir?</p>
                          <button onClick={() => setConfirmados((c) => ({ ...c, [`${diaActual}:${p.id}`]: true }))} className="rounded px-2 py-1 font-semibold" style={{ background: STATUS_COLOR[ev.status], color: "#fff" }}>
                            Confirmar de todos modos
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between mt-5">
                <button onClick={() => irEtapa(-1)} disabled={etapaActual <= 0} className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold" style={navBtnStyle(etapaActual <= 0)}>
                  <ChevronLeft size={16} /> Etapa ant.
                </button>
                {etapaActual < etapas.length - 1 ? (
                  <button onClick={() => irEtapa(1)} className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ background: etapa.color }}>
                    Etapa sig. <ChevronRight size={16} />
                  </button>
                ) : (
                  <button onClick={() => { irDia(1); setEtapaActual(0); }} className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ background: "#16a34a" }}>
                    Siguiente día <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Banner alertas del día */}
            {alertasDia.length > 0 && (
              <div className="mt-4 rounded-lg p-3 text-sm flex items-start gap-2" style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <span>
                  El día {diaActual} tiene {alertasDia.length} valor(es) fuera de referencia. Revisa las celdas resaltadas: confirma o corrige.
                </span>
              </div>
            )}
          </section>
        )}

        {/* ───── FASE 2 — TABLA CONSOLIDADA ───── */}
        {fase === 2 && (
          <section className="rounded-xl shadow-sm bg-white overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
            <div className="p-5 border-b" style={{ borderColor: "#e2e8f0" }}>
              <h2 className="text-lg font-bold">Tabla consolidada</h2>
              <p className="text-sm" style={{ color: "#64748b" }}>
                {dias} días × {todosParams.length} parámetros. <span style={{ color: "#dc2626" }}>■</span> fuera de rango · <span style={{ color: "#f59e0b" }}>■</span> revisar · <span style={{ color: "#94a3b8" }}>■</span> sin dato
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse" style={{ minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 px-3 py-2 text-left font-bold" style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>Día</th>
                    {etapas.map((et) => (
                      <th key={et.id} colSpan={et.params.length} className="px-2 py-2 text-center font-bold text-white" style={{ background: et.color, borderRight: "2px solid #fff" }}>
                        {et.nombre}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="sticky left-0 z-10 px-3 py-2" style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}></th>
                    {todosParams.map((p) => (
                      <th key={p.id} className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                        {p.label.replace("Conductividad (Ce)", "Ce")}
                        <div className="font-normal" style={{ color: "#94a3b8" }}>{refLabel(p)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: dias }, (_, i) => i + 1).map((d) => (
                    <tr key={d}>
                      <td className="sticky left-0 z-10 px-3 py-1.5 font-bold text-center" style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>{d}</td>
                      {todosParams.map((p) => {
                        const raw = (registros[d] || {})[p.id] ?? "";
                        const ev = evaluar(p, raw, tol);
                        return (
                          <td key={p.id} className="px-2 py-1.5 text-center font-medium whitespace-nowrap" style={{ background: STATUS_BG[ev.status], color: STATUS_COLOR[ev.status], borderBottom: "1px solid #f1f5f9" }}>
                            {ev.status === "sin" ? "—" : ev.status === "invalid" ? "!" : fmt(ev.n)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ───── FASE 3 — RESUMEN ───── */}
        {fase === 3 && (
          <section className="space-y-5">
            {/* Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card title="Días registrados" value={`${resumen.diasRegistrados}`} sub={`de ${resumen.totalDias}`} color="#0369a1" Icon={CheckCircle2} />
              <Card title="Días con alertas" value={`${resumen.diasConAlertas}`} sub="con ≥1 valor fuera" color="#f59e0b" Icon={AlertTriangle} />
              <Card title="Cumplimiento global" value={`${resumen.cumplimiento}%`} sub="celdas dentro de referencia" color="#16a34a" Icon={Activity} />
            </div>

            {/* Promedios por parámetro */}
            <div className="rounded-xl shadow-sm bg-white p-5" style={{ border: "1px solid #e2e8f0" }}>
              <h3 className="text-base font-bold mb-3">Promedio por parámetro vs referencia</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: "#64748b" }}>
                      <th className="text-left py-2 font-semibold">Etapa</th>
                      <th className="text-left py-2 font-semibold">Parámetro</th>
                      <th className="text-right py-2 font-semibold">Promedio</th>
                      <th className="text-right py-2 font-semibold">Referencia</th>
                      <th className="text-center py-2 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.promedios.map(({ param, prom, status, n }) => (
                      <tr key={param.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td className="py-2">
                          <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: param.etapaColor }} />
                          <span className="text-xs" style={{ color: "#64748b" }}>{param.etapaNombre}</span>
                        </td>
                        <td className="py-2 font-medium">{param.label} {param.unidad && <span style={{ color: "#94a3b8" }}>({param.unidad})</span>}</td>
                        <td className="py-2 text-right font-bold">{prom === null ? "—" : fmt(prom)}{n > 0 && <span className="text-xs font-normal ml-1" style={{ color: "#94a3b8" }}>({n})</span>}</td>
                        <td className="py-2 text-right" style={{ color: "#64748b" }}>{refLabel(param)}</td>
                        <td className="py-2 text-center"><StatusBadge status={status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Gráfico de tendencia por etapa */}
            <div className="rounded-xl shadow-sm bg-white p-5" style={{ border: "1px solid #e2e8f0" }}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-base font-bold">Tendencia por etapa</h3>
                  <p className="text-xs" style={{ color: "#94a3b8" }}>
                    Compara la misma medición a lo largo del proceso (una línea por etapa). Elige la medición y enciende las etapas que quieras ver.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {medicionesDisponibles.map((m) => {
                    const activa = medicion === m.key;
                    return (
                      <button key={m.key} onClick={() => setMedicion(m.key)} className="rounded-lg px-3 py-2 text-xs font-semibold transition" style={{ background: activa ? "#0369a1" : "#f1f5f9", color: activa ? "#fff" : "#475569" }}>
                        {m.label}
                        {m.unidad && <span className="font-normal" style={{ opacity: 0.8 }}> ({m.unidad})</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Casillas por etapa */}
              <div className="flex flex-wrap gap-2 mb-4">
                {etapas.map((et) => {
                  const tiene = !!paramDeEtapa(et, medicion);
                  const on = etapasVisibles[et.id] && tiene;
                  return (
                    <button
                      key={et.id}
                      onClick={() => setEtapasVisibles((v) => ({ ...v, [et.id]: !v[et.id] }))}
                      disabled={!tiene}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition"
                      style={{
                        background: on ? "#fff" : "#f8fafc",
                        border: `1.5px solid ${on ? et.color : "#e2e8f0"}`,
                        color: tiene ? "#334155" : "#cbd5e1",
                        cursor: tiene ? "pointer" : "not-allowed",
                      }}
                    >
                      <span className="inline-flex items-center justify-center rounded shrink-0" style={{ width: 16, height: 16, background: on ? et.color : "transparent", border: `1.5px solid ${tiene ? et.color : "#cbd5e1"}` }}>
                        {on && <CheckCircle2 size={11} color="#fff" />}
                      </span>
                      {et.nombre}
                    </button>
                  );
                })}
              </div>

              {!chartData.hayDatos ? (
                <p className="text-sm py-10 text-center" style={{ color: "#94a3b8" }}>Sin datos para esta medición todavía.</p>
              ) : (
                <>
                  <p className="text-xs mb-2" style={{ color: "#94a3b8" }}>
                    {chartData.totalConDatos > chartData.mostrados
                      ? `Mostrando los últimos ${chartData.mostrados} de ${chartData.totalConDatos} días con datos.`
                      : `Mostrando ${chartData.mostrados} día(s) con datos.`}
                  </p>
                  <div className="text-xs mb-3 rounded-lg px-3 py-2 inline-flex items-center gap-2" style={refUnica ? { background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" } : { background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe" }}>
                    {refUnica ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    {refUnica
                      ? `Referencia visible: ${seriesVisibles[0].etapa.nombre} — ${refLabel(refUnica)}${refUnica.unidad ? " " + refUnica.unidad : ""}.`
                      : "Deja activa una sola etapa (apaga las demás con las casillas de arriba) para ver su rango de referencia."}
                  </div>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={chartData.puntos} margin={{ top: 10, right: 20, bottom: 10, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: "#64748b" }} angle={-30} textAnchor="end" height={58} interval={0} />
                      <YAxis tick={{ fontSize: 12, fill: "#64748b" }} label={chartData.med.unidad ? { value: chartData.med.unidad, angle: -90, position: "insideLeft", fontSize: 11, fill: "#94a3b8" } : undefined} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }} />
                      <Legend />
                      {refBand && <ReferenceArea y1={refBand.y1} y2={refBand.y2} fill="#16a34a" fillOpacity={0.08} ifOverflow="extendDomain" />}
                      {refLines.map((l) => (
                        <ReferenceLine key={l.key} y={l.y} stroke={l.stroke} strokeWidth={l.width} strokeDasharray={l.dash} ifOverflow="extendDomain" label={{ value: l.label, position: l.pos, fontSize: 10, fill: l.stroke }} />
                      ))}
                      {chartData.series
                        .filter((s) => etapasVisibles[s.etapa.id])
                        .map((s) => (
                          <Line key={s.etapa.id} type="monotone" dataKey={s.etapa.id} name={s.etapa.nombre} stroke={s.etapa.color} strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls />
                        ))}
                    </LineChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>

            {/* Días fuera de rango */}
            <div className="rounded-xl shadow-sm bg-white p-5" style={{ border: "1px solid #e2e8f0" }}>
              <h3 className="text-base font-bold mb-3">Días fuera de rango</h3>
              {resumen.diasFuera.length === 0 ? (
                <p className="text-sm flex items-center gap-2" style={{ color: "#16a34a" }}><CheckCircle2 size={18} /> Ningún día con valores fuera de referencia.</p>
              ) : (
                <div className="space-y-2">
                  {resumen.diasFuera.map(({ dia, detalles }) => (
                    <div key={dia} className="rounded-lg p-3" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
                      <p className="font-bold text-sm mb-1.5" style={{ color: "#991b1b" }}>Día {dia}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {detalles.map((d, idx) => (
                          <span key={idx} className="text-xs rounded-full px-2.5 py-1 font-medium" style={{ background: "#fff", color: STATUS_COLOR[d.status], border: `1px solid ${STATUS_COLOR[d.status]}55` }}>
                            {d.param.etapaNombre} · {d.param.label}: <strong>{fmt(d.n)}</strong> (ref {refLabel(d.param)})
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-lg flex items-center gap-2 z-50" style={{ background: toast.tipo === "success" ? "#16a34a" : "#dc2626", maxWidth: "90vw" }}>
          {toast.tipo === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
