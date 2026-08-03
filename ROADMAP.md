# Roadmap

Plan de trabajo de "próximos pasos" acordado a partir de una revisión completa
del proyecto en agosto de 2026. Se ejecuta una fase por vez, cada una con su
propio commit. Las fases 1 a 3 ya están en `main` y desplegadas.

Si retomás este trabajo sin el contexto de la conversación original, este
archivo es la referencia. Actualizalo a medida que avances: marcá lo hecho, y
si una fase futura cambia de alcance, dejá dicho por qué.

## Fase 1 — Bloqueantes antes de meter datos reales ✅ `5c7a982`

- **Migraciones incrementales.** `db/schema.sql` ya no abre con
  `DROP TABLE ... CASCADE` — es la línea base idempotente de un proyecto
  nuevo. Todo cambio posterior va en `db/migrations/`, numerado, aplicado una
  vez cada uno. Ver `db/migrations/README.md` para las reglas.
- **Poder corregir y borrar.** Antes solo había políticas SELECT/INSERT para
  `empresas`, `sedes` y `periodos`: un typo era permanente y un período
  creado en el mes equivocado quedaba ocupando el `UNIQUE (sede_id, mes,
  anio)` para siempre. La migración `0001` agrega UPDATE/DELETE con triggers
  de columna protegida y guardas de borrado (nada con historial dependiente
  se borra en cascada en silencio — los FK son `ON DELETE CASCADE`).
- **Recuperación de contraseña.** Flujo por correo desde `Login.jsx`
  (`resetPasswordForEmail` + `NuevaPassword.jsx` en el `PASSWORD_RECOVERY` de
  `App.jsx`) y reseteo directo desde `AdminPanel.jsx` vía la Edge Function
  — este último funciona sin depender de que haya SMTP configurado.
- **Gestión de usuarios completa.** La Edge Function ya aceptaba `nombre`,
  `sedes` y `password` en la acción `actualizar` desde el día uno; le
  faltaba la pantalla. Ahora `AdminPanel.jsx` la expone entera.

## Fase 2 — Confiabilidad en planta ✅ `d9031c5`

- **`App.jsx` ya no confunde "sin sesión" con "no cargó el perfil".** Antes,
  cualquier fallo de la consulta de perfil (red caída, proyecto Supabase
  pausado por inactividad) caía al Login con sesión válida — invitaba a
  reescribir credenciales que estaban bien. Ahora se distingue con
  `maybeSingle()`: fallo de conexión → reintentar sin perder la sesión; cero
  filas → la cuenta existe en Auth pero no tiene perfil, y avisa que hace
  falta un admin.
- **Estado de guardado por celda.** El estado local de captura es optimista;
  antes solo se avisaba si un guardado fallaba, así que una escritura
  perdida seguía mostrando el valor en pantalla. Cada celda muestra ahora
  Guardando/Guardado/Error, con reintento manual.
- **CI en pull requests** (`.github/workflows/ci.yml`) — el deploy real solo
  corre en push a `main`, así que antes un build roto no se notaba hasta que
  Pages se quedaba con la versión vieja sin ninguna señal.

## Fase 3 — Parámetros por sede (multisede) ✅ `1464d9e`

Este era el bloqueante real de "hacer la app multisede": los 17 parámetros y
sus rangos estaban quemados en la constante `ETAPAS` del frontend y en un
`CHECK` sobre `mediciones.param_id` — eran los de una sola planta.

- **Modelo en dos niveles** (`db/migrations/0002`): `sede_etapas` /
  `sede_parametros` es la plantilla editable de cada sede; `periodo_etapas` /
  `periodo_parametros` es lo que rige en un período concreto, copiado de la
  plantilla al crearlo. `mediciones` cuelga del segundo nivel.
- **Decisión tomada:** los rangos quedan **congelados por período**. Corregir
  hoy un objetivo en la plantilla de la sede no reescribe el cumplimiento de
  meses ya reportados — marzo se sigue evaluando con los rangos que regían en
  marzo. Un admin puede editar directamente los rangos de un período ya
  creado (para el caso de un valor mal cargado desde el principio), pero es
  una acción explícita sobre ese período, no un efecto lateral de tocar la
  plantilla.
- **Frontend:** `MonitoreoOsmosisInversa.jsx` carga las etapas del período en
  vez de importar una constante. El campo `medicion` de cada parámetro
  reemplaza el `endsWith('_' + key)` que agrupaba parámetros entre etapas
  para la gráfica de tendencia.
- **`ParametrosPanel.jsx`** — pestaña nueva en el AdminPanel para editar la
  plantilla de una sede o los rangos vigentes de uno de sus períodos.

**Migraciones `0001` y `0002` ya aplicadas en producción** (agosto de 2026).
El esquema vivo del proyecto Supabase corresponde a `schema.sql` + `rls.sql` +
`0001` + `0002`; de acá en adelante, todo cambio de esquema arranca desde ese
punto, con una migración nueva.

## Fase 4 — Operación diaria (en curso)

- **Modo offline / PWA** ✅ (reconexión en caliente) — cubre el caso de
  "el período ya se cargó con conexión y el wifi se corta a mitad de la
  captura", que es la queja real de uso en planta. Queda fuera de
  alcance a propósito: abrir un período ya visitado estando offline
  desde el arranque (cachear la grilla completa) — se deja para una
  iteración futura si hace falta.
  - `web/vite.config.js` agrega `vite-plugin-pwa` (`registerType:
    'autoUpdate'`, `devOptions.enabled` para poder probarlo con `npm run
    dev`); no usa `runtimeCaching`, así que las llamadas a Supabase nunca
    se sirven cacheadas — solo se precachea el shell de la app (JS/CSS/
    HTML). Íconos placeholder en `web/public/icons/` (cuadrados
    `#0369a1`, reemplazables por un logo real sin tocar código).
    `web/src/main.jsx` registra el service worker vía
    `virtual:pwa-register`.
  - `web/src/lib/useOnline.js` — hook `navigator.onLine` + eventos
    `online`/`offline`.
  - `web/src/lib/colaOffline.js` — cola de escrituras de `mediciones`
    pendientes en `localStorage` (clave `offline_cola_${periodoId}`,
    colapsada por celda al último valor, igual que el debounce ya
    colapsa varias tecleadas en un solo request).
  - `MonitoreoOsmosisInversa.jsx`: `enviarMedicion()` clasifica cualquier
    fallo en `red` (transitorio — `status === 0`, la señal que arma
    postgrest-js cuando el fetch nunca tuvo respuesta) o `rechazo` (real:
    `mediciones_valor_check`, `PGRST116` por conflicto de dueño, `23503`
    por FK — período/parámetro borrado). Solo `red` se encola y se
    reintenta solo; un `rechazo` se muestra como el `error` de siempre,
    con su botón "Reintentar" manual, y nunca queda encolado. Nuevo
    estado de celda `'pendiente'` y badge en el encabezado del período
    ("Sin conexión" / "N cambios por enviar"). Al montar, la cola local
    se superpone sobre lo cargado del servidor para no perder un valor
    tipeado si la página se recarga con algo sin enviar.
  - **Sin probar el flujo real de punta a punta** (escribir → cortar
    conexión → ver "pendiente" → reconectar → ver que se reenvía solo):
    requiere loguearse con una sesión real de Supabase, que no se hizo en
    esta sesión de trabajo. Si algo no cuadra en planta, empezar por acá.
- **Respaldos** (pendiente — analizado en agosto de 2026, falta decidir e
  implementar). El plan Free de Supabase **no corre ningún respaldo
  automático** (los diarios empiezan en Pro), así que hoy la única copia de
  las mediciones es la base viva. Sale gratis hacerlo con un Action, pero
  con tres condiciones que no son opcionales:
  - **El dump va cifrado, sí o sí.** Este repo es público y los artifacts de
    un repo público los puede descargar cualquiera. Subir el volcado en
    claro es publicar la base (correos de usuarios, empresas, mediciones).
    `gpg --symmetric` con la passphrase en un secret del repo — y esa
    passphrase guardada además fuera de GitHub, o el respaldo no se puede
    restaurar.
  - **Conexión por el pooler, no directa.** `db.<ref>.supabase.co` es solo
    IPv6 y los runners de GitHub son IPv4: hay que ir por el session pooler
    (puerto 5432, no el 6543 de transaction mode, que no sirve para
    `pg_dump`). Y el `pg_dump` del runner tiene que ser de la misma major
    que el Postgres del proyecto.
  - **Un cron que se apaga solo no es un respaldo.** GitHub deshabilita los
    workflows `schedule` de un repo sin commits por 60 días. Si el proyecto
    se queda quieto unos meses — que es justo cuando el respaldo importa —
    hay que verificar que siga corriendo.

  Alternativa más simple si `pg_dump` da pelea: exportar solo los datos por
  la API REST a JSON. El esquema ya está versionado en `db/`, así que basta
  con las filas; a cambio, restaurar deja de ser un `psql` y pasa a ser
  correr `db/` y recargar los datos.
- **Reemplazar `xlsx@0.18.5`** ✅ — arrastraba vulnerabilidades conocidas
  (prototype pollution / ReDoS) y la versión parchada de SheetJS no se
  publica en npm. Se migró la exportación de `MonitoreoOsmosisInversa.jsx`
  a `exceljs` (misma maquetación: título fusionado, cabecera de etapas con
  merges, fila de referencias, anchos de columna). La generación pasó a ser
  asíncrona (`workbook.xlsx.writeBuffer()` + descarga vía `Blob`/`<a>`, ya
  que ExcelJS no tiene un `writeFile` de navegador equivalente a
  `XLSX.writeFile`). `exceljs@4.4.0` arrastra a su vez `uuid@8.3.2`
  (`GHSA-w5hq-g745-h8pq`, moderado) — no es explotable en este uso: exceljs
  solo llama a `uuidv4()` sin el parámetro `buf` que dispara la falla, y no
  hay una versión de exceljs que rompa esa cadena de dependencias. Sin
  probar el clic de "Exportar" en la app real (requiere sesión con datos
  reales); sí se validó que el build de Vite resuelve la build de
  navegador de exceljs sin polyfills y sin errores de consola.

## Decisiones tomadas que vale la pena recordar

- **La Fase 5 se sacó del alcance** (agosto de 2026). Eran la vista
  consolidada entre sedes y una auditoría de aislamiento con pruebas. Es una
  decisión explícita, no un olvido: no volver a agregarlas sin que alguien
  las pida. Con la Fase 4 cerrada, el roadmap se termina.

- **Un operario puede crear períodos.** `periodos_insert` usa
  `puede_ver_sede(sede_id)`, heredado del PHP original. Se revisó
  explícitamente durante la Fase 1 y se dejó así a propósito — no es un
  descuido. Si en algún momento se decide que abrir el mes debe ser cosa
  solo de admin, es cambiar esa política a una sola línea.
- **Rangos de referencia congelados por período**, no vigentes en tiempo
  real (ver Fase 3). Es una decisión de negocio, no técnica: se tomó porque
  esto funciona como registro de cumplimiento auditable.
