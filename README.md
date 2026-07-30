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
db/schema.sql                              → Tablas, constraints y triggers
db/rls.sql                                 → Funciones helper y políticas RLS (correr después de schema.sql)
supabase/functions/gestionar-usuario/      → Edge Function (crear/editar usuarios)
web/                                       → Proyecto Vite/React
.github/workflows/deploy.yml               → Build + deploy a GitHub Pages en cada push a main
```

---

## Paso 1 — Crear el proyecto en Supabase

1. Crear un proyecto en [supabase.com](https://supabase.com) (anota la contraseña de la base al crearlo).
2. En el **SQL Editor**: pegar y correr `db/schema.sql`, y luego `db/rls.sql`, en ese orden.

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

## Desarrollo local

```bash
cd web
npm install
npm run dev
```

Abre `http://localhost:5173`. Habla directo contra el proyecto Supabase configurado en `web/.env` — no hace falta nada local aparte del frontend.

---

## Roles y permisos

| Rol | Puede hacer |
|-----|------------|
| `super` | Crear empresas, crear/activar administradores de cualquier empresa |
| `admin` | Crear sedes y operarios en su empresa; editar cualquier celda de su empresa |
| `operario` | Ver todas las mediciones del período; crear/editar/borrar solo sus propias celdas |

---

## Notas de seguridad

- Las credenciales las gestiona Supabase Auth (no hay `password_hash` propio).
- Cada tabla tiene Row Level Security habilitado; `usuarios` y `usuario_sedes` solo son legibles por el cliente — toda escritura pasa por la Edge Function `gestionar-usuario`.
- Desactivar un usuario (`activo = false`) también revoca sus sesiones activas en Supabase Auth (`ban_duration`), no solo el acceso a datos vía RLS.
- Ni `mediciones.usuario_id` ni `usuarios.rol/empresa_id/email` son editables por un UPDATE normal del cliente (triggers de "columnas protegidas" en `db/rls.sql`), igual que en el modelo original.
- Esta app no tiene ninguna superficie anónima: `anon` no tiene permisos sobre ninguna tabla.
