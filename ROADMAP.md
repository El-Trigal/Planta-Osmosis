# Roadmap

Plan de trabajo de "próximos pasos" acordado a partir de una revisión completa
del proyecto en agosto de 2026. Se ejecuta en `claude/project-next-steps-0rpzhu`,
una fase por vez, cada una con su propio commit.

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

**Antes de desplegar esta fase en producción:** correr `0001` y `0002` en
orden contra el proyecto Supabase. `0002` hace
`ALTER TABLE mediciones DROP COLUMN param_id` — no pierde información (el
valor queda preservado como `periodo_parametros.clave` del snapshot) pero es
la primera migración de esta serie que toca una columna con datos reales.
Conviene probarla primero en un proyecto de staging o un branch de Supabase
si hay uno disponible, no directo en producción.

## Fase 4 — Operación diaria (pendiente)

- **Modo offline / PWA.** Es una app que se usa con el celular junto a la
  máquina; hoy cada tecla depende del wifi. Cache local con cola de reenvío
  para las escrituras, y ese reintento se enchufa naturalmente con el
  indicador de guardado de la Fase 2. Probablemente la mejora de mayor
  impacto real para quien usa la app día a día.
- **Respaldos.** El tier gratuito de Supabase no garantiza point-in-time
  recovery y hoy no hay ningún export automático. Un Action semanal que
  vuelque las tablas a un artifact alcanzaría.
- **Reemplazar `xlsx@0.18.5`.** Arrastra vulnerabilidades conocidas
  (prototype pollution / ReDoS) y la versión parchada de SheetJS no se
  publica en npm. Migrar a `exceljs` o al tarball oficial de SheetJS.

## Fase 5 — Cierre (pendiente)

- **Vista consolidada entre sedes**, para admin/super: cumplimiento, alertas
  abiertas y tendencias de varias sedes a la vez. Se vuelve bastante más
  fácil (y más útil) ahora que cada sede tiene sus propios parámetros.
- **Auditoría de aislamiento entre sedes/empresas.** Verificar de punta a
  punta (RLS, Edge Function, joins del frontend) que un operario o admin no
  pueda ver ni escribir datos de otra sede o empresa por ningún camino, y
  dejarlo con pruebas.

## Decisiones tomadas que vale la pena recordar

- **Un operario puede crear períodos.** `periodos_insert` usa
  `puede_ver_sede(sede_id)`, heredado del PHP original. Se revisó
  explícitamente durante la Fase 1 y se dejó así a propósito — no es un
  descuido. Si en algún momento se decide que abrir el mes debe ser cosa
  solo de admin, es cambiar esa política a una sola línea.
- **Rangos de referencia congelados por período**, no vigentes en tiempo
  real (ver Fase 3). Es una decisión de negocio, no técnica: se tomó porque
  esto funciona como registro de cumplimiento auditable.
