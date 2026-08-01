// Cola de escrituras de `mediciones` pendientes de reenviar por falta de
// conexión. Vive en localStorage (no en memoria) para sobrevivir a un
// reload de página con algo a medio guardar. Cada período tiene su propia
// clave; dentro de ella, cada celda solo guarda su último valor pendiente
// — igual que el debounce de guardarCelda ya colapsa varias tecleadas en
// un solo request, acá se colapsa en una sola entrada de cola.

function clave(periodoId) {
  return `offline_cola_${periodoId}`;
}

function leer(periodoId) {
  try {
    return JSON.parse(localStorage.getItem(clave(periodoId)) || "{}");
  } catch {
    return {};
  }
}

function escribir(periodoId, cola) {
  localStorage.setItem(clave(periodoId), JSON.stringify(cola));
}

export function leerCola(periodoId) {
  return leer(periodoId);
}

// `valor: null` representa un borrado (celda vaciada estando offline).
export function encolar(periodoId, dia, parametroId, valor) {
  const cola = leer(periodoId);
  cola[`${dia}:${parametroId}`] = { dia, parametroId, valor };
  escribir(periodoId, cola);
}

export function quitarDeCola(periodoId, dia, parametroId) {
  const cola = leer(periodoId);
  if (!(`${dia}:${parametroId}` in cola)) return;
  delete cola[`${dia}:${parametroId}`];
  escribir(periodoId, cola);
}

export function contarCola(periodoId) {
  return Object.keys(leer(periodoId)).length;
}
