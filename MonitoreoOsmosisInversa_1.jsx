import { useState, useEffect, useMemo, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
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
  Droplets,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Save,
  Beaker,
  Wind,
  Filter,
  FlaskConical,
  Activity,
  RefreshCw,
} from "lucide-react";
import * as XLSX from "xlsx";

/* ───────────────────────────── MODELO DE DATOS ───────────────────────────── */

const ETAPAS = [
  {
    id: "pretratamiento",
    nombre: "Pretratamiento",
    icon: "Beaker",
    color: "#0369a1",
    params: [
      { id: "pre_ce", label: "Conductividad (Ce)", unidad: "mS/cm", ref: { type: "target", value: 0.8 } },
      { id: "pre_ph", label: "pH", unidad: "", ref: { type: "min", value: 8 } },
      { id: "pre_cl", label: "Cl-Libre", unidad: "ppm", ref: { type: "target", value: 0.5 } },
      { id: "pre_al", label: "Aluminio", unidad: "ppm", ref: { type: "min", value: 0.2 } },
    ],
  },
  {
    id: "aireacion",
    nombre: "Tanque de Aireación",
    icon: "Wind",
    color: "#0891b2",
    params: [
      { id: "air_ce", label: "Conductividad (Ce)", unidad: "mS/cm", ref: { type: "target", value: 0.1 } },
      { id: "air_ph", label: "pH", unidad: "", ref: { type: "range", min: 6, max: 6.6 } },
      { id: "air_cl", label: "Cl-Libre", unidad: "ppm", ref: { type: "target", value: 0.1 } },
    ],
  },
  {
    id: "prefiltro",
    nombre: "Pre-filtro",
    icon: "Filter",
    color: "#0d9488",
    params: [
      { id: "prf_ce", label: "Conductividad (Ce)", unidad: "mS/cm", ref: { type: "target", value: 1.1 } },
      { id: "prf_ph", label: "pH", unidad: "", ref: { type: "range", min: 6, max: 6.7 } },
      { id: "prf_cl", label: "Cl-Libre", unidad: "ppm", ref: { type: "target", value: 1.1 } },
    ],
  },
  {
    id: "posfiltro",
    nombre: "Pos-filtro",
    icon: "Filter",
    color: "#16a34a",
    params: [
      { id: "pof_ce", label: "Conductividad (Ce)", unidad: "mS/cm", ref: { type: "target", value: 1.1 } },
      { id: "pof_ph", label: "pH", unidad: "", ref: { type: "target", value: 6.7 } },
      { id: "pof_cl", label: "Cl-Libre", unidad: "ppm", ref: { type: "target", value: 0 } },
    ],
  },
  {
    id: "producto",
    nombre: "Producto",
    icon: "FlaskConical",
    color: "#2563eb",
    params: [
      { id: "prd_ce", label: "Conductividad (Ce)", unidad: "mS/cm", ref: { type: "range", min: 0.1, max: 0.3 } },
      { id: "prd_ph", label: "pH", unidad: "", ref: { type: "target", value: 6.7 } },
      { id: "prd_cl", label: "Cl-Libre", unidad: "ppm", ref: { type: "target", value: 0 } },
      { id: "prd_caudal", label: "Caudal", unidad: "l/min", ref: { type: "target", value: 35 } },
    ],
  },
];

const TODOS_PARAMS = ETAPAS.flatMap((e) => e.params.map((p) => ({ ...p, etapa: e.id, etapaNombre: e.nombre, etapaColor: e.color })));

// Mediciones disponibles para la gráfica. Ce/pH/Cl están en las 5 etapas;
// Aluminio solo en Pretratamiento y Caudal solo en Producto (una sola línea).
const MEDICIONES = [
  { key: "ce", label: "Conductividad (Ce)", unidad: "mS/cm" },
  { key: "ph", label: "pH", unidad: "" },
  { key: "cl", label: "Cl-Libre", unidad: "ppm" },
  { key: "al", label: "Aluminio", unidad: "ppm" },
  { key: "caudal", label: "Caudal", unidad: "l/min" },
];
const paramDeEtapa = (etapa, medKey) => etapa.params.find((p) => p.id.endsWith("_" + medKey));

// Fusiona registros remotos y locales por día/parámetro. Lo local gana en los
// campos que el usuario tocó; se conservan los días/campos que cargó otro operario.
function mergeRegistros(remoto, local) {
  const out = {};
  const dias = new Set([...Object.keys(remoto || {}), ...Object.keys(local || {})]);
  dias.forEach((d) => {
    out[d] = { ...((remoto || {})[d] || {}), ...((local || {})[d] || {}) };
  });
  return out;
}

const ICON_MAP = { Beaker, Wind, Filter, FlaskConical };

const DEMO = {
  empresa: "Flores el Trigal Caribe S.A.S",
  planta: "Finca Caribe",
  mes: "Abril",
  anio: 2026,
  dias: 30,
  tolerancia: 10,
  registros: {
    1: { pre_ce: 0.82, pre_ph: 8.1, pre_cl: 0.5, pre_al: 0.25, air_ce: 0.11, air_ph: 6.3, air_cl: 0.1, prf_ce: 1.1, prf_ph: 6.4, prf_cl: 1.1, pof_ce: 1.1, pof_ph: 6.7, pof_cl: 0, prd_ce: 0.2, prd_ph: 6.7, prd_cl: 0, prd_caudal: 35 },
    2: { pre_ce: 0.79, pre_ph: 7.6, pre_cl: 0.48, pre_al: 0.22, air_ce: 0.12, air_ph: 6.8, air_cl: 0.1, prf_ce: 1.0, prf_ph: 6.5, prf_cl: 1.1, pof_ce: 1.2, pof_ph: 6.7, pof_cl: 0, prd_ce: 0.35, prd_ph: 6.7, prd_cl: 0, prd_caudal: 31 },
    3: { pre_ce: 0.81, pre_ph: 8.2, pre_cl: 0.51, pre_al: 0.26, air_ce: 0.1, air_ph: 6.4, air_cl: 0.1, prf_ce: 1.1, prf_ph: 6.6, prf_cl: 1.1, pof_ce: 1.1, pof_ph: 6.7, pof_cl: 0, prd_ce: 0.18, prd_ph: 6.7, prd_cl: 0, prd_caudal: 36 },
  },
};

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/* ───────────────────────────── UTILIDADES ───────────────────────────── */

function diasEnMes(mes, anio) {
  const idx = MESES.indexOf(mes);
  if (idx < 0) return 31;
  return new Date(anio, idx + 1, 0).getDate();
}

// Extrae {mesIdx, anio} de una clave "monitoreo:<empresa>:<Mes>-<AAAA>"
// para poder ordenar los períodos por fecha real (no alfabéticamente).
function parsePeriodoKey(k) {
  const m = /:([^:]+)-(\d{4})$/.exec(k || "");
  if (!m) return { mesIdx: -1, anio: 0 };
  return { mesIdx: MESES.indexOf(m[1]), anio: Number(m[2]) };
}

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

/* ───────────────────────────── COMPONENTE PRINCIPAL ───────────────────────────── */

export default function MonitoreoOsmosisInversa() {
  const [config, setConfig] = useState({
    empresa: "Flores el Trigal Caribe S.A.S",
    planta: "",
    mes: MESES[new Date().getMonth()],
    anio: new Date().getFullYear(),
    dias: diasEnMes(MESES[new Date().getMonth()], new Date().getFullYear()),
    tolerancia: 10,
  });
  const [registros, setRegistros] = useState({}); // { dia: { paramId: rawValue } }
  const [fase, setFase] = useState(1);
  const [diaActual, setDiaActual] = useState(1);
  const [etapaActual, setEtapaActual] = useState(0);
  const [confirmados, setConfirmados] = useState({}); // `${dia}:${paramId}` -> true
  const [medicion, setMedicion] = useState("ce");
  const [etapasVisibles, setEtapasVisibles] = useState(() => Object.fromEntries(ETAPAS.map((e) => [e.id, true])));
  const [storageStatus, setStorageStatus] = useState("loading"); // loading | ok | unavailable
  const [toast, setToast] = useState(null);
  const [cargado, setCargado] = useState(false);
  const [esDemo, setEsDemo] = useState(false); // datos de demostración (no autoguardar)
  const [refrescando, setRefrescando] = useState(false);
  const lastSavedRef = useRef(""); // huella del último guardado, evita reescrituras/bucles

  const tol = Number(config.tolerancia) || 10;

  /* ── Carga inicial: storage → demo ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!window.storage) throw new Error("storage no disponible");
        const listing = await window.storage.list("monitoreo:", true);
        if (listing && Array.isArray(listing.keys) && listing.keys.length > 0) {
          const ordenadas = listing.keys.slice().sort((a, b) => {
            const pa = parsePeriodoKey(a);
            const pb = parsePeriodoKey(b);
            return pa.anio - pb.anio || pa.mesIdx - pb.mesIdx;
          });
          const key = ordenadas[ordenadas.length - 1];
          const r = await window.storage.get(key, true);
          if (r && r.value) {
            const data = JSON.parse(r.value);
            if (!cancelled) {
              if (data.config) setConfig(data.config);
              const regs = data.registros || {};
              setRegistros(regs);
              lastSavedRef.current = JSON.stringify(regs);
              setEsDemo(false);
              setStorageStatus("ok");
              setFase(4);
              setCargado(true);
            }
            return;
          }
        }
        if (!cancelled) {
          // storage operativo pero vacío → demo (no se autoguarda)
          setConfig({ empresa: DEMO.empresa, planta: DEMO.planta, mes: DEMO.mes, anio: DEMO.anio, dias: DEMO.dias, tolerancia: DEMO.tolerancia });
          setRegistros(DEMO.registros);
          setEsDemo(true);
          setStorageStatus("ok");
          setFase(4);
          setCargado(true);
        }
      } catch (e) {
        if (!cancelled) {
          setConfig({ empresa: DEMO.empresa, planta: DEMO.planta, mes: DEMO.mes, anio: DEMO.anio, dias: DEMO.dias, tolerancia: DEMO.tolerancia });
          setRegistros(DEMO.registros);
          setEsDemo(true);
          setStorageStatus("unavailable");
          setFase(4);
          setCargado(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const storageKey = `monitoreo:${config.empresa}:${config.mes}-${config.anio}`;

  function mostrarToast(tipo, msg) {
    setToast({ tipo, msg });
    setTimeout(() => setToast(null), 3200);
  }

  async function persistir(silencioso) {
    try {
      if (!window.storage) throw new Error("storage no disponible");
      // Leer lo remoto y fusionar para no pisar días cargados por otros operarios
      let remoto = null;
      try {
        const r = await window.storage.get(storageKey, true);
        if (r && r.value) remoto = JSON.parse(r.value);
      } catch (e) {
        /* aún no existe la clave */
      }
      const merged = mergeRegistros(remoto ? remoto.registros : {}, registros);
      const payload = { config, registros: merged };
      await window.storage.set(storageKey, JSON.stringify(payload), true);
      lastSavedRef.current = JSON.stringify(merged);
      setEsDemo(false);
      // Reflejar en pantalla lo que aportaron otros (si lo hubo)
      if (JSON.stringify(merged) !== JSON.stringify(registros)) setRegistros(merged);
      setStorageStatus("ok");
      if (!silencioso) mostrarToast("success", "Datos guardados");
      return true;
    } catch (e) {
      setStorageStatus("unavailable");
      if (!silencioso) mostrarToast("error", "No se pudo guardar (requiere artifact publicado). Exporta a Excel para no perder datos.");
      return false;
    }
  }

  // Vuelve a leer del almacenamiento compartido el mes en pantalla (lo que hayan
  // capturado otros), conservando ediciones locales sin guardar.
  async function recargarDatos(silencioso) {
    if (!silencioso) setRefrescando(true);
    try {
      if (!window.storage) throw new Error("storage no disponible");
      const r = await window.storage.get(storageKey, true);
      if (r && r.value) {
        const data = JSON.parse(r.value);
        const merged = mergeRegistros(data.registros || {}, registros);
        if (data.config) setConfig(data.config);
        setRegistros(merged);
        setEsDemo(false);
        if (!silencioso) mostrarToast("success", "Datos actualizados");
      } else if (!silencioso) {
        mostrarToast("success", "Aún no hay datos guardados para este mes");
      }
      setStorageStatus("ok");
    } catch (e) {
      setStorageStatus("unavailable");
      if (!silencioso) mostrarToast("error", "No se pudo actualizar (requiere artifact publicado)");
    } finally {
      if (!silencioso) setRefrescando(false);
    }
  }

  // Autoguardado: persiste en cuanto cambian los datos (sin esperar a "Guardar").
  useEffect(() => {
    if (!cargado || esDemo || !window.storage) return;
    if (JSON.stringify(registros) === lastSavedRef.current) return;
    const id = setTimeout(() => {
      persistir(true);
    }, 1200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registros, config, cargado, esDemo]);

  // Al volver a la pestaña/ventana, recargar datos solo en vistas de lectura.
  useEffect(() => {
    function onFocus() {
      if (document.visibilityState !== "visible") return;
      if (cargado && !esDemo && (fase === 3 || fase === 4)) recargarDatos(true);
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargado, esDemo, fase, registros, config]);

  function setValor(dia, paramId, valor) {
    if (esDemo) setEsDemo(false);
    setRegistros((prev) => {
      const nuevo = { ...prev, [dia]: { ...(prev[dia] || {}), [paramId]: valor } };
      if (valor === "") delete nuevo[dia][paramId];
      return nuevo;
    });
    // si vuelve a estar vacío o cambia, quitar confirmación previa
    setConfirmados((prev) => {
      const c = { ...prev };
      delete c[`${dia}:${paramId}`];
      return c;
    });
  }

  /* ── Resumen calculado ── */
  const resumen = useMemo(() => {
    const dias = Number(config.dias) || 31;
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
      for (const p of TODOS_PARAMS) {
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

    const promedios = TODOS_PARAMS.map((p) => {
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
  }, [registros, config.dias, tol]);

  const chartData = useMemo(() => {
    const dias = Number(config.dias) || 31;
    const med = MEDICIONES.find((m) => m.key === medicion) || MEDICIONES[0];
    const series = ETAPAS.map((et) => ({ etapa: et, param: paramDeEtapa(et, med.key) })).filter((s) => s.param);
    const mesIdx = MESES.indexOf(config.mes);
    const mm = String(mesIdx + 1).padStart(2, "0");
    const conDatos = [];
    for (let d = 1; d <= dias; d++) {
      const punto = { dia: d, fecha: `${String(d).padStart(2, "0")}/${mm}/${config.anio}` };
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
  }, [registros, config.dias, config.mes, config.anio, medicion, tol]);

  // Series actualmente visibles; si hay exactamente una, exponemos su parámetro
  // para dibujar la referencia (rango/mín/objetivo) sin ambigüedad.
  const seriesVisibles = chartData.series.filter((s) => etapasVisibles[s.etapa.id]);
  const refUnica = seriesVisibles.length === 1 ? seriesVisibles[0].param : null;

  // Referencias como datos planos (recharts ignora ReferenceLine dentro de fragments).
  let refBand = null; // { y1, y2 }
  let refLines = [];  // [{ key, y, stroke, dash, width, label, pos }]
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

  /* ── Exportar a Excel (estructura del original) ── */
  function exportar() {
    try {
      const dias = Number(config.dias) || 31;
      const aoa = [];

      const filaTitulo = [`Monitoreo Ósmosis Inversa — ${config.empresa} · ${config.planta || ""} · ${config.mes} ${config.anio}`];
      aoa.push(filaTitulo);
      aoa.push([]);

      const row1 = ["Día"];
      const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: TODOS_PARAMS.length } }];
      let col = 1;
      ETAPAS.forEach((et) => {
        row1.push(et.nombre);
        for (let i = 1; i < et.params.length; i++) row1.push("");
        if (et.params.length > 1) merges.push({ s: { r: 2, c: col }, e: { r: 2, c: col + et.params.length - 1 } });
        col += et.params.length;
      });
      aoa.push(row1);

      const row2 = ["Ref:"];
      ETAPAS.forEach((et) => et.params.forEach((p) => row2.push(`${p.label}${p.unidad ? " (" + p.unidad + ")" : ""} · ${refLabel(p)}`)));
      aoa.push(row2);

      for (let d = 1; d <= dias; d++) {
        const row = [d];
        ETAPAS.forEach((et) =>
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
        aoa.push(row);
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!merges"] = merges;
      ws["!cols"] = [{ wch: 6 }, ...TODOS_PARAMS.map(() => ({ wch: 16 }))];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Monitoreo");
      XLSX.writeFile(wb, `Monitoreo_OsmosisInversa_${config.mes}_${config.anio}.xlsx`);
      mostrarToast("success", "Excel exportado");
    } catch (e) {
      mostrarToast("error", "No se pudo generar el Excel");
    }
  }

  /* ── Respaldo completo (.json) de TODOS los meses guardados ── */
  async function respaldarTodo() {
    const meses = {};
    let leidoDeStorage = false;
    try {
      if (window.storage) {
        const listing = await window.storage.list("monitoreo:", true);
        if (listing && Array.isArray(listing.keys)) {
          for (const k of listing.keys) {
            try {
              const r = await window.storage.get(k, true);
              if (r && r.value) {
                meses[k] = JSON.parse(r.value);
                leidoDeStorage = true;
              }
            } catch (e) {
              /* clave ilegible, se omite */
            }
          }
        }
      }
    } catch (e) {
      /* storage no disponible: respaldamos al menos el mes en pantalla */
    }
    // Asegurar que el mes actualmente en pantalla quede incluido (aunque no esté guardado)
    meses[storageKey] = { config, registros };

    const respaldo = {
      app: "monitoreo-osmosis-inversa",
      version: 1,
      generado: new Date().toISOString(),
      origen: leidoDeStorage ? "almacenamiento+pantalla" : "solo-pantalla",
      meses,
    };
    try {
      const blob = new Blob([JSON.stringify(respaldo, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `respaldo_monitoreo_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      mostrarToast("success", `Respaldo descargado (${Object.keys(meses).length} mes/es)`);
    } catch (e) {
      mostrarToast("error", "No se pudo generar el respaldo");
    }
  }

  /* ── Restaurar desde un archivo .json de respaldo ── */
  async function restaurarTodo(file) {
    if (!file) return;
    try {
      const texto = await file.text();
      const data = JSON.parse(texto);
      const meses = data && data.meses ? data.meses : null;
      if (!meses || typeof meses !== "object" || Object.keys(meses).length === 0) {
        mostrarToast("error", "El archivo no parece un respaldo válido");
        return;
      }
      // Escribir cada mes al almacenamiento compartido (si está disponible)
      let guardados = 0;
      if (window.storage) {
        for (const [k, v] of Object.entries(meses)) {
          try {
            await window.storage.set(k, JSON.stringify(v), true);
            guardados++;
          } catch (e) {
            /* sigue con los demás */
          }
        }
      }
      // Cargar en pantalla el último mes del respaldo
      const claves = Object.keys(meses);
      const ultimo = meses[claves[claves.length - 1]];
      if (ultimo && ultimo.config) {
        setConfig(ultimo.config);
        setRegistros(ultimo.registros || {});
        setFase(4);
      }
      if (guardados > 0) mostrarToast("success", `Restaurado: ${claves.length} mes/es (${guardados} guardado/s)`);
      else mostrarToast("success", `Restaurado en pantalla (${claves.length} mes/es). Publica y Guarda para persistir.`);
    } catch (e) {
      mostrarToast("error", "No se pudo leer el respaldo (¿archivo correcto?)");
    }
  }

  /* ── Navegación de captura ── */
  function comenzarCaptura() {
    setEsDemo(false);
    setDiaActual(1);
    setEtapaActual(0);
    setFase(2);
  }
  function irDia(delta) {
    const dias = Number(config.dias) || 31;
    setDiaActual((d) => Math.min(dias, Math.max(1, d + delta)));
  }
  function irEtapa(delta) {
    setEtapaActual((e) => Math.min(ETAPAS.length - 1, Math.max(0, e + delta)));
  }

  const etapa = ETAPAS[etapaActual];
  const EtapaIcon = ICON_MAP[etapa.icon] || Beaker;

  // alertas del día actual
  const alertasDia = useMemo(() => {
    const reg = registros[diaActual] || {};
    const lista = [];
    for (const p of TODOS_PARAMS) {
      const ev = evaluar(p, reg[p.id], tol);
      if (esAlerta(ev.status)) lista.push({ param: p, ...ev });
    }
    return lista;
  }, [registros, diaActual, tol]);

  const progresoPct = Math.round((diaActual / (Number(config.dias) || 31)) * 100);

  /* ───────────────────────────── RENDER ───────────────────────────── */
  return (
    <div className="min-h-screen w-full" style={{ background: "#f8fafc", color: "#0f172a" }}>
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        {/* HEADER */}
        <header className="rounded-xl shadow-sm p-5 sm:p-6 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4" style={{ background: "linear-gradient(135deg,#0369a1,#0ea5e9)" }}>
          <div className="flex items-center gap-3 text-white">
            <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.18)" }}>
              <Droplets size={28} />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold leading-tight">Monitoreo Ósmosis Inversa</h1>
              <p className="text-sm opacity-90">
                {config.empresa} · {config.planta || "Planta"} · {config.mes} {config.anio}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => recargarDatos(false)} disabled={refrescando} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition" style={{ background: "rgba(255,255,255,0.18)" }}>
              <RefreshCw size={18} className={refrescando ? "animate-spin" : ""} /> Actualizar
            </button>
            <button onClick={() => persistir(false)} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition" style={{ background: "rgba(255,255,255,0.18)" }}>
              <Save size={18} /> Guardar
            </button>
            <button onClick={exportar} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition" style={{ background: "#ffffff", color: "#0369a1" }}>
              <Download size={18} /> Exportar
            </button>
          </div>
        </header>

        {/* Aviso storage no disponible */}
        {storageStatus === "unavailable" && (
          <div className="rounded-lg p-3 mb-4 text-sm flex items-start gap-2" style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>El guardado automático requiere un artifact <strong>publicado</strong> (plan Pro o superior). Puedes trabajar normalmente en esta sesión y usar <strong>Exportar</strong> para conservar tus datos en Excel.</span>
          </div>
        )}

        {/* NAV DE FASES */}
        <nav className="flex flex-wrap gap-2 mb-5">
          {[
            { n: 1, t: "Configurar" },
            { n: 2, t: "Capturar" },
            { n: 3, t: "Tabla" },
            { n: 4, t: "Resumen" },
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

        {/* ───── FASE 1 — CONFIGURAR ───── */}
        {fase === 1 && (
          <section className="rounded-xl shadow-sm p-6 bg-white" style={{ border: "1px solid #e2e8f0" }}>
            <h2 className="text-lg font-bold mb-1">Configurar período</h2>
            <p className="text-sm mb-5" style={{ color: "#64748b" }}>
              Define los datos del encabezado y la tolerancia antes de capturar.
            </p>
            <div className="rounded-lg p-3 mb-5 text-sm flex items-start gap-2" style={{ background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe" }}>
              <Droplets size={18} className="mt-0.5 shrink-0" />
              <span>Este registro es <strong>compartido</strong>: todas las personas que abran el link de la herramienta publicada ven y editan los mismos datos del mes. No ingreses información que deba permanecer privada.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Empresa">
                <input className="w-full rounded-lg px-3 py-2.5 text-sm" style={inputStyle} value={config.empresa} onChange={(e) => setConfig({ ...config, empresa: e.target.value })} />
              </Field>
              <Field label="Planta">
                <input className="w-full rounded-lg px-3 py-2.5 text-sm" style={inputStyle} value={config.planta} placeholder="Ej. Finca Caribe" onChange={(e) => setConfig({ ...config, planta: e.target.value })} />
              </Field>
              <Field label="Mes">
                <select className="w-full rounded-lg px-3 py-2.5 text-sm" style={inputStyle} value={config.mes} onChange={(e) => setConfig({ ...config, mes: e.target.value, dias: diasEnMes(e.target.value, config.anio) })}>
                  {MESES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Año">
                <input type="number" className="w-full rounded-lg px-3 py-2.5 text-sm" style={inputStyle} value={config.anio} onChange={(e) => setConfig({ ...config, anio: e.target.value, dias: diasEnMes(config.mes, Number(e.target.value)) })} />
              </Field>
              <Field label="Días del mes">
                <input type="number" min={28} max={31} className="w-full rounded-lg px-3 py-2.5 text-sm" style={inputStyle} value={config.dias} onChange={(e) => setConfig({ ...config, dias: Number(e.target.value) })} />
              </Field>
              <Field label="Tolerancia parámetros 'objetivo' (±%)">
                <input type="number" min={0} max={100} className="w-full rounded-lg px-3 py-2.5 text-sm" style={inputStyle} value={config.tolerancia} onChange={(e) => setConfig({ ...config, tolerancia: Number(e.target.value) })} />
              </Field>
            </div>

            {/* Respaldos */}
            <div className="mt-6 rounded-lg p-4" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <h3 className="text-sm font-bold mb-1">Respaldos</h3>
              <p className="text-xs mb-3" style={{ color: "#64748b" }}>
                Descarga una copia de seguridad de todos los meses (archivo .json) y guárdala fuera de la app. Puedes restaurarla aquí si fuera necesario.
              </p>
              <div className="flex flex-wrap gap-2">
                <button onClick={respaldarTodo} className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ background: "#0369a1" }}>
                  <Download size={16} /> Descargar respaldo (.json)
                </button>
                <label className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold cursor-pointer" style={{ background: "#fff", color: "#0369a1", border: "1px solid #bae6fd" }}>
                  <Save size={16} /> Restaurar desde respaldo
                  <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; restaurarTodo(f); e.target.value = ""; }} />
                </label>
              </div>
              <p className="text-xs mt-3" style={{ color: "#94a3b8" }}>
                Además, en la barra superior puedes usar <strong>Exportar</strong> para una copia legible en Excel del mes actual.
              </p>
            </div>

            <div className="mt-6 flex justify-end">
              <button onClick={comenzarCaptura} className="flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-bold text-white" style={{ background: "#16a34a" }}>
                Comenzar captura <ChevronRight size={18} />
              </button>
            </div>
          </section>
        )}

        {/* ───── FASE 2 — CAPTURAR ───── */}
        {fase === 2 && (
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
                    {Array.from({ length: Number(config.dias) || 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <span className="text-sm" style={{ color: "#94a3b8" }}>de {config.dias}</span>
                </div>
                <button onClick={() => irDia(1)} disabled={diaActual >= (Number(config.dias) || 31)} className="rounded-lg p-2.5" style={navBtnStyle(diaActual >= (Number(config.dias) || 31))}>
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
              {ETAPAS.map((et, i) => {
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
                    Etapa {etapaActual + 1}/{ETAPAS.length}
                  </p>
                  <h3 className="text-base font-bold" style={{ color: etapa.color }}>{etapa.nombre}</h3>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {etapa.params.map((p) => {
                  const raw = (registros[diaActual] || {})[p.id] ?? "";
                  const ev = evaluar(p, raw, tol);
                  const fueraVisible = esAlerta(ev.status) && !confirmados[`${diaActual}:${p.id}`];
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
                          onChange={(e) => setValor(diaActual, p.id, e.target.value)}
                          placeholder="—"
                          className="w-full rounded-lg px-3 py-2.5 text-sm font-medium"
                          style={{ border: `1.5px solid ${ev.status === "sin" ? "#cbd5e1" : STATUS_COLOR[ev.status]}`, background: STATUS_BG[ev.status], outline: "none" }}
                        />
                        {p.unidad && <span className="text-xs shrink-0" style={{ color: "#94a3b8" }}>{p.unidad}</span>}
                        <StatusBadge status={ev.status} />
                      </div>
                      {ev.status === "invalid" && (
                        <p className="text-xs mt-2 font-medium" style={{ color: "#dc2626" }}>Ingresa un número.</p>
                      )}
                      {fueraVisible && (
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
                {etapaActual < ETAPAS.length - 1 ? (
                  <button onClick={() => irEtapa(1)} className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ background: etapa.color }}>
                    Etapa sig. <ChevronRight size={16} />
                  </button>
                ) : (
                  <button onClick={() => { persistir(true); irDia(1); setEtapaActual(0); }} className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ background: "#16a34a" }}>
                    Guardar día y seguir <ChevronRight size={16} />
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

        {/* ───── FASE 3 — TABLA CONSOLIDADA ───── */}
        {fase === 3 && (
          <section className="rounded-xl shadow-sm bg-white overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
            <div className="p-5 border-b" style={{ borderColor: "#e2e8f0" }}>
              <h2 className="text-lg font-bold">Tabla consolidada</h2>
              <p className="text-sm" style={{ color: "#64748b" }}>
                {config.dias} días × 17 parámetros. <span style={{ color: "#dc2626" }}>■</span> fuera de rango · <span style={{ color: "#f59e0b" }}>■</span> revisar · <span style={{ color: "#94a3b8" }}>■</span> sin dato
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse" style={{ minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 px-3 py-2 text-left font-bold" style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>Día</th>
                    {ETAPAS.map((et) => (
                      <th key={et.id} colSpan={et.params.length} className="px-2 py-2 text-center font-bold text-white" style={{ background: et.color, borderRight: "2px solid #fff" }}>
                        {et.nombre}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="sticky left-0 z-10 px-3 py-2" style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}></th>
                    {TODOS_PARAMS.map((p) => (
                      <th key={p.id} className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                        {p.label.replace("Conductividad (Ce)", "Ce")}
                        <div className="font-normal" style={{ color: "#94a3b8" }}>{refLabel(p)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: Number(config.dias) || 31 }, (_, i) => i + 1).map((d) => (
                    <tr key={d}>
                      <td className="sticky left-0 z-10 px-3 py-1.5 font-bold text-center" style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>{d}</td>
                      {TODOS_PARAMS.map((p) => {
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

        {/* ───── FASE 4 — RESUMEN ───── */}
        {fase === 4 && (
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
                  {MEDICIONES.map((m) => {
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
                {ETAPAS.map((et) => {
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

/* ───────────────────────────── SUBCOMPONENTES ───────────────────────────── */

const inputStyle = { border: "1.5px solid #cbd5e1", background: "#fff", outline: "none", color: "#0f172a" };

function navBtnStyle(disabled) {
  return {
    background: disabled ? "#f1f5f9" : "#fff",
    color: disabled ? "#cbd5e1" : "#475569",
    border: "1px solid #e2e8f0",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: "#475569" }}>{label}</label>
      {children}
    </div>
  );
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
