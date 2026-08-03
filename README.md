# Monitoreo Ósmosis Inversa

Stack 100% Supabase + GitHub Pages: no hay servidor propio que mantener.

- **Base de datos y autenticación**: Supabase (Postgres + Auth). Toda la
  autorización (quién ve/edita qué según rol y empresa/sede) vive en Row
  Level Security de Postgres, no en código de aplicación.
- **Único código de servidor**: una Edge Function de Supabase
  (`gestionar-usuario`), necesaria solo porque crear/desactivar cuentas y
  resetear contraseñas requiere la Admin API de Supabase Auth.
- **Frontend**: Vite/React, habla directo con Supabase vía
  `@supabase/supabase-js`. Se despliega como sitio estático en GitHub
  Pages con GitHub Actions.

---

## Estructura de archivos

```
db/schema.sql                              → Tablas, constraints y triggers (línea base, idempotente)
db/rls.sql                                 → Funciones helper y políticas RLS (correr después de schema.sql)
db/migrations/                             → Cambios de esquema posteriores, en orden numérico
db/RESPALDOS.md                            → Cómo activar, leer y restaurar los respaldos
supabase/functions/gestionar-usuario/      → Edge Function (crear/editar usuarios)
web/                                       → Proyecto Vite/React
.github/workflows/deploy.yml               → Build + deploy a GitHub Pages en cada push a main
.github/workflows/ci.yml                   → Build de verificación en cada pull request
.github/workflows/respaldo.yml             → pg_dump diario cifrado (ver db/RESPALDOS.md)
```

---

## Paso 1 — Crear el proyecto en Supabase

1. Crear un proyecto en [supabase.com](https://supabase.com) (anota la contraseña de la base al crearlo).
2. En el **SQL Editor**, pegar y correr en este orden:
   1. `db/schema.sql`
   2. `db/rls.sql`
   3. cada archivo de `db/migrations/`, en orden numérico ascendente

Un proyecto que **ya está en uso** solo necesita el paso 2.iii: `schema.sql` es la
línea base de un proyecto nuevo y no modifica tablas que ya existen. Ver
[`db/migrations/README.md`](db/migrations/README.md) para las reglas de las
migraciones — la principal es que una migración ya aplicada no se edita nunca,
se enmienda con otra nueva.

---

## Paso 2 — Configurar el frontend

Editar `web/.env` con los valores reales (**Project Settings → API**):

```
VITE_SUPABASE_URL=https://TU_REF_DE_PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY_PUBLICA
```

Estos dos valores son públicos por diseño (viajan en el bundle del navegador); la protección real la da RLS, no el secreto de estos valores. Sí son commiteables.

---

## Paso 3 — Desplegar la Edge Function

Necesita `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` (Supabase los inyecta automáticamente como variables de entorno a toda Edge Function — no hay que configurarlos a mano).

Con la [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
npx supabase login
npx supabase link --project-ref TU_REF_DE_PROYECTO
npx supabase functions deploy gestionar-usuario
```

O pegar el contenido de `supabase/functions/gestionar-usuario/index.ts` directamente en **Dashboard → Edge Functions → New Function → Deploy**.

---

## Paso 4 — Crear el primer usuario `super`

Como las credenciales ahora las gestiona Supabase Auth, no un `INSERT` directo:

1. **Authentication → Users → Add user** en el dashboard de Supabase. Marca "Auto Confirm User". Copia el UUID generado.
2. En el **SQL Editor**, ejecuta (ajusta el UUID, nombre y email):

```sql
INSERT INTO usuarios (id, nombre, email, rol)
VALUES ('UUID-COPIADO-DEL-PASO-ANTERIOR', 'Super Admin', 'super@tudominio.com', 'super');
```

---

## Paso 5 — Desplegar el frontend en GitHub Pages

1. En el repo de GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions**.
2. Cualquier push a `main` dispara `.github/workflows/deploy.yml`, que compila `web/` y publica `web/dist/` en Pages.
3. El sitio queda en `https://<organización>.github.io/Planta-Osmosis/` (ajusta `base` en `web/vite.config.js` si el nombre del repo cambia).

---

## Paso 6 — Habilitar la recuperación de contraseña (opcional)

La pantalla de **"¿Olvidaste tu contraseña?"** manda un enlace por correo. Para
que funcione hacen falta dos cosas en el dashboard de Supabase:

1. **Authentication → URL Configuration → Redirect URLs**: agregar la URL del
   sitio (`https://<organización>.github.io/Planta-Osmosis/`). Si no está en esa
   lista, Supabase ignora el `redirectTo` y el enlace no vuelve a la app.
2. **Project Settings → Authentication → SMTP Settings**: configurar un
   proveedor propio. El mailer que trae Supabase por defecto solo sirve para
   probar — permite unos pocos correos por hora y no garantiza entrega.

Aunque no configures nada de esto, nadie queda bloqueado: un `admin` o `super`
puede restablecerle la contraseña a cualquiera desde **Panel de administración →
Usuarios → editar**, sin correo de por medio.

---

## Paso 7 — Activar los respaldos

**El plan Free de Supabase no corre ningún respaldo automático** (los diarios
empiezan en Pro). `.github/workflows/respaldo.yml` lo suple: `pg_dump` diario,
cifrado y subido como artifact con 90 días de retención. En un repo público no
cuesta nada — ni los minutos de Actions ni el almacenamiento de artifacts se
facturan.

El workflow ya está en `main`, pero **no respalda nada hasta que se carguen dos
secrets** (`SUPABASE_DB_URL` con la cadena del *session pooler*, y
`RESPALDO_PASSPHRASE`). El paso a paso completo — de dónde sale cada valor, cómo
leer el resultado del run y cómo restaurar — está en
[`db/RESPALDOS.md`](db/RESPALDOS.md), que además lleva el checklist de qué falta.

Dos cosas que conviene saber antes de tocarlo:

- **El volcado va cifrado y no es opcional**: este repo es público y los
  artifacts de un repo público los descarga cualquiera.
- **La passphrase hay que guardarla fuera de GitHub.** Un secret de Actions se
  escribe pero no se puede volver a leer; si se pierde, los respaldos quedan
  como archivos que nadie puede abrir.

---

## Desarrollo local

```bash
cd web
npm install
npm run dev
```

Abre `http://localhost:5173`. Habla directo contra el proyecto Supabase configurado en `web/.env` — no hace falta nada local aparte del frontend.

---

## Parámetros de cada planta

Las etapas del proceso y sus rangos de referencia **se definen por sede**, en
**Panel de administración → Parámetros**. Una sede nueva arranca con las 5
etapas y 17 parámetros del proceso original (pretratamiento, aireación,
pre-filtro, pos-filtro y producto), y desde ahí se agregan, se quitan o se
ajustan según la planta.

Hay dos niveles, y la diferencia importa:

- **Plantilla de la sede** — la configuración vigente. Es lo que se copia al
  crear un período nuevo.
- **Período** — al crearse, se queda con una copia propia de esos rangos y no
  vuelve a cambiar. Por eso corregir hoy un objetivo no altera el cumplimiento
  ya reportado de meses anteriores: marzo se sigue evaluando con los rangos que
  regían en marzo.

Si un rango estaba mal cargado desde el principio y hay que corregirlo de
verdad, se puede editar el período directamente (mismo panel, eligiéndolo en el
segundo selector); ahí sí cambia cómo se evalúan las mediciones de ese mes, y la
pantalla lo advierte.

El campo **"agrupa como"** de cada parámetro es lo que permite comparar el mismo
ensayo a lo largo del proceso en la gráfica de tendencia: todos los parámetros
que compartan ese valor (`ce`, `ph`, `cl`…) se dibujan superpuestos, una línea
por etapa.

---

## Roles y permisos

| Rol | Puede hacer |
|-----|------------|
| `super` | Todo lo del `admin`, en cualquier empresa; además crear, renombrar y borrar empresas |
| `admin` | Crear/renombrar/borrar sedes de su empresa; crear, editar, desactivar y resetear la contraseña de sus usuarios; ajustar días y tolerancia de un período; editar cualquier celda de su empresa |
| `operario` | Ver todas las mediciones del período y crear períodos en sus sedes; crear/editar/borrar solo sus propias celdas |

Qué se puede borrar y qué no: una empresa solo se borra si ya no tiene sedes ni
usuarios, una sede solo si no tiene períodos, y un período solo si todavía no
tiene ninguna medición cargada. Es decir, la aplicación deja deshacer un error
reciente pero nunca borrar historial de planta; para dejar de usar algo que ya
tiene datos, desactiva a sus usuarios en vez de borrarlo.

---

## Notas de seguridad

- Las credenciales las gestiona Supabase Auth (no hay `password_hash` propio).
- Cada tabla tiene Row Level Security habilitado; `usuarios` y `usuario_sedes` solo son legibles por el cliente — toda escritura pasa por la Edge Function `gestionar-usuario`.
- Desactivar un usuario (`activo = false`) también revoca sus sesiones activas en Supabase Auth (`ban_duration`), no solo el acceso a datos vía RLS.
- Ni `mediciones.usuario_id` ni `usuarios.rol/empresa_id/email` son editables por un UPDATE normal del cliente (triggers de "columnas protegidas" en `db/rls.sql`), igual que en el modelo original.
- Esta app no tiene ninguna superficie anónima: `anon` no tiene permisos sobre ninguna tabla.
