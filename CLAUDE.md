# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All frontend commands run from `web/`:

```bash
cd web
npm install
npm run dev      # local dev server against the live Supabase project configured in web/.env
npm run build    # production build to web/dist/, used by the GitHub Actions deploy workflow
npm run preview  # preview a production build locally
```

There is no lint or test script in this project.

Database changes (schema + RLS) are applied by running the SQL directly against the Supabase project's Postgres instance — via the SQL Editor in the Supabase dashboard, or via the Management API's `database/query` endpoint (`POST https://api.supabase.com/v1/projects/{ref}/database/query` with a Personal Access Token), in this order:

1. `db/schema.sql` — tables, constraints, triggers (does a full `DROP ... CASCADE` + recreate; not an incremental migration file)
2. `db/rls.sql` — helper functions, column-protection triggers, RLS policies, grants

Deploying the Edge Function:

```bash
npx supabase login   # or set SUPABASE_ACCESS_TOKEN
npx supabase link --project-ref <ref>
npx supabase functions deploy gestionar-usuario
```

## Architecture

This app has **no backend server of its own**. It is a static React/Vite frontend (deployed to GitHub Pages) talking directly to Supabase (Postgres + Auth) via `@supabase/supabase-js`, plus exactly one Supabase Edge Function for the handful of actions that require elevated privileges. There used to be a PHP API on Hostinger; it was fully removed in favor of this model — don't reintroduce a custom backend without a strong reason.

### The authorization model lives in Postgres, not in application code

All permission logic — who can see/create/edit what — is implemented as Row Level Security policies in `db/rls.sql`, not in the frontend or in any server code. Reading `web/src/*.jsx` alone will not reveal the access-control rules; they only exist in the SQL. Roles: `super` (sees/manages everything, `empresa_id` is `NULL`), `admin` (scoped to their own `empresa_id`), `operario` (scoped to the specific `sedes` they're assigned in `usuario_sedes`, and further restricted on `mediciones` to only writing cells they themselves own).

Key building blocks in `db/rls.sql`:
- `rol_actual()` / `empresa_actual()` — `SECURITY DEFINER` helpers that read the caller's own `usuarios` row (filtered `AND activo`, so deactivating a user immediately fails every policy built on these, without waiting for their session to expire).
- `puede_ver_sede(sede_id)` / `puede_ver_periodo(periodo_id)` — the shared 3-way (super/admin/operario) access-check reused across `sedes`, `periodos`, and `mediciones` policies.
- Column-protection triggers (`mediciones_proteger_columnas`, `usuarios_proteger_columnas`) — RLS policies only filter which *rows* are writable, not which *columns* within an otherwise-allowed row. These triggers separately pin `mediciones.usuario_id/periodo_id/dia/param_id` back to their original values on UPDATE, and block changes to `usuarios.rol/empresa_id/email` unless the writer is `service_role`. Without them, e.g. an admin's legitimate `UPDATE` on a measurement could silently reassign its ownership.
- `usuarios` and `usuario_sedes` have **no client-facing INSERT/UPDATE policies at all** (SELECT only) — every write to those two tables goes through the Edge Function instead.

### Edge Function `gestionar-usuario`

The only code in the project that runs with `service_role` privileges. It exists solely because creating/deactivating a Supabase Auth user or resetting a password requires the Auth Admin API, which can never be called with the public `anon` key from the browser. It re-validates the caller's role/empresa itself (via a second, caller-scoped Supabase client) before doing anything privileged — it is not just a thin proxy to the Admin API.

It also enforces that a user cannot deactivate their own account: setting `activo = false` on a user also bans them at the Auth level (`ban_duration`), so a super/admin accidentally deactivating themselves is a full self-lockout, not just a data-access restriction. This is guarded both in the function and by disabling the toggle for your own row in `AdminPanel.jsx`.

Everything else — `empresas`, `sedes`, `periodos`, and `mediciones` CRUD — goes straight from the frontend through `supabase-js`, relying entirely on RLS. Do not add new endpoints to this function for actions that don't touch `auth.users`; add an RLS policy (and, if needed, a `SECURITY DEFINER` RPC function committed to `db/rls.sql`) instead.

### Data model specifics

- `mediciones` rows are per-(`periodo_id`, `dia`, `param_id`) cells; `usuario_id` is "whoever last owns this cell," used by the operario ownership restriction. The valid `param_id` values are a fixed whitelist of 17 strings enforced by a CHECK constraint in `db/schema.sql` **and** duplicated as the `ETAPAS` constant in `web/src/MonitoreoOsmosisInversa.jsx` (parameter labels, units, and reference ranges/targets for the "ok / revisar / fuera de rango" evaluation) — keep both in sync if parameters ever change.
- The frontend upserts a cell via `onConflict: 'periodo_id,dia,param_id'`; clearing a value issues a `DELETE` rather than an upsert with a null.
- `usuarios.id` *is* `auth.users.id` (no separate `password_hash` column) — profile data (role, empresa, activo) lives in `public.usuarios`, credentials live entirely in Supabase Auth.

### Frontend flow

`App.jsx` owns the Supabase auth session (via `onAuthStateChange`) and the logged-in user's profile row; it gates between `Login.jsx` (no session), a deactivated-account screen (`perfil.activo === false`), `AdminPanel.jsx` (empresas/sedes/usuarios management, super/admin only), and the main flow: `SedePeriodoSelector.jsx` (pick or create a sede + monthly período) → `MonitoreoOsmosisInversa.jsx` (the actual day/stage capture grid, consolidated table, and summary/charts for that período).

### Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds `web/` and publishes `web/dist/` to GitHub Pages on every push to `main`. `web/vite.config.js` sets `base` conditionally — `/` in dev, `/Planta-Osmosis/` in a production build — because Pages serves this repo under a subpath. `web/.env` commits the real Supabase project URL and `anon` key; this is intentional, not an oversight — those values are safe to expose (the `anon` key is protected by RLS, not by secrecy), and they'd be visible in the deployed bundle regardless.

Supabase's free tier auto-pauses a project after a period of inactivity — if Supabase calls start failing with the project reachable everywhere else, check the project's status via the Management API (`GET /v1/projects/{ref}`) and restore it with `POST /v1/projects/{ref}/restore` if it shows anything other than `ACTIVE_HEALTHY`.
