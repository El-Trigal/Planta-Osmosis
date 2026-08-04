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

There is no lint or test script in this project — `npm run build` is the only automated check, and it's what CI runs on pull requests.

`ROADMAP.md` is the decision log: it records what each phase of work changed, what was deliberately left out of scope (and why), and which flows were never exercised against the real app. Read it before assuming something is missing by oversight.

Database changes (schema + RLS) are applied by running the SQL directly against the Supabase project's Postgres instance — via the SQL Editor in the Supabase dashboard, or via the Management API's `database/query` endpoint (`POST https://api.supabase.com/v1/projects/{ref}/database/query` with a Personal Access Token), in this order:

1. `db/schema.sql` — tables, constraints, triggers. This is the **baseline for a fresh project**, not a migration: it is idempotent (`CREATE TABLE IF NOT EXISTS`) and no longer drops anything. Because it skips tables that already exist, it will not add missing columns to a live project.
2. `db/rls.sql` — helper functions, column-protection triggers, RLS policies, grants
3. `db/migrations/*.sql` — every schema change after the baseline, applied **in ascending numeric order, once each**. See `db/migrations/README.md`. Never edit a migration that has already been applied in production; fix it with a new one.

There is no staging database — a migration is applied by hand against the only Postgres there is. `db/migrations/README.md` has a recipe for rehearsing one first against a disposable local cluster (including the `auth` schema stubs `rls.sql` needs, which a plain Postgres doesn't have); it takes about a minute and is the only way to find out that something doesn't apply *before* production does.

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
- Grants live here, not only in the migration that created the table. `rls.sql` is re-runnable and is the *only* file the restore procedure in `db/RESPALDOS.md` reapplies after loading a dump — and the dump itself is taken with `--no-privileges`. A table whose `GRANT ... TO authenticated` exists only inside its migration therefore comes back from a backup with no privileges at all, which surfaces as a permission-denied on a table the app needs, on the worst possible day. Post-baseline tables are granted at the end of `rls.sql` inside a `to_regclass` guard, because on a fresh project this file runs before the migrations that create them.
- Delete guards (`empresas_guardar_borrado`, `sedes_guardar_borrado`, `periodos_guardar_borrado`, added in `db/migrations/0001`) — the FKs in `schema.sql` are `ON DELETE CASCADE`, so without these `BEFORE DELETE` triggers deleting one empresa would silently take its sedes, periodos and every medición with it. Each raises a Spanish exception naming what still depends on the row; the frontend surfaces `error.message` verbatim, so those strings are user-facing copy.

### Edge Function `gestionar-usuario`

The only code in the project that runs with `service_role` privileges. It exists solely because creating/deactivating a Supabase Auth user or resetting a password requires the Auth Admin API, which can never be called with the public `anon` key from the browser. It re-validates the caller's role/empresa itself (via a second, caller-scoped Supabase client) before doing anything privileged — it is not just a thin proxy to the Admin API.

It also enforces that a user cannot deactivate their own account: setting `activo = false` on a user also bans them at the Auth level (`ban_duration`), so a super/admin accidentally deactivating themselves is a full self-lockout, not just a data-access restriction. This is guarded both in the function and by disabling the toggle for your own row in `AdminPanel.jsx`.

Everything else — `empresas`, `sedes`, `periodos`, and `mediciones` CRUD — goes straight from the frontend through `supabase-js`, relying entirely on RLS. Do not add new endpoints to this function for actions that don't touch `auth.users`; add an RLS policy (and, if needed, a `SECURITY DEFINER` RPC function committed to `db/rls.sql`) instead.

### Data model specifics

- `mediciones` rows are per-(`periodo_id`, `dia`, `parametro_id`) cells; `usuario_id` is "whoever last owns this cell," used by the operario ownership restriction.
- **Parameters are per-sede and frozen per-período** (`db/migrations/0002`). Two levels, identical in shape: `sede_etapas`/`sede_parametros` is the sede's editable **template**, and `periodo_etapas`/`periodo_parametros` is what actually **governs a given período**, copied from the template by an `AFTER INSERT` trigger on `periodos`. `mediciones.parametro_id` points at the *período* copy, never the template. The reason is that a measurement's status (ok / revisar / fuera de rango) is recomputed against its reference range rather than stored: if ranges lived only on the sede, correcting a target today would silently rewrite the compliance figures of every month already reported. A período's ranges are still editable by admin/super — that's the escape hatch for a range that was wrong from the start — but doing so is explicit about which período it touches.
- A parameter's `medicion` column is what groups the same assay across stages (the conductivity of `pretratamiento` and of `producto` are both `ce`) and is what the trend chart superimposes. It replaced a `p.id.endsWith("_" + medKey)` trick that only worked because the 17 hardcoded keys happened to be written in that format.
- New sedes get the original 17-parameter set seeded by an `AFTER INSERT` trigger (`sembrar_plantilla_sede`), so creating a sede or a período from the frontend is still a single INSERT with no extra round-trip.
- The frontend upserts a cell via `onConflict: 'periodo_id,dia,parametro_id'`; clearing a value issues a `DELETE` rather than an upsert with a null. Every write reports its outcome per cell (`guardado` state in `MonitoreoOsmosisInversa.jsx`: `guardando`/`ok`/`error`) — the local `registros` state is optimistic, so without that indicator a write that never landed still looks captured on screen.
- `usuarios.id` *is* `auth.users.id` (no separate `password_hash` column) — profile data (role, empresa, activo) lives in `public.usuarios`, credentials live entirely in Supabase Auth.

### Frontend flow

`App.jsx` owns the Supabase auth session (via `onAuthStateChange`) and the logged-in user's profile row; it gates between `Login.jsx` (no session), `NuevaPassword.jsx` (the `PASSWORD_RECOVERY` event), the `Aviso` screens (profile query failed → retry; profile row missing; `perfil.activo === false`), `AdminPanel.jsx` (empresas/sedes/parámetros/usuarios management, super/admin only; the Parámetros tab is `ParametrosPanel.jsx`, which edits either the sede template or one período's frozen copy — same form, only the table names differ), and the main flow: `SedePeriodoSelector.jsx` (pick or create a sede + monthly período) → `MonitoreoOsmosisInversa.jsx` (the actual day/stage capture grid, consolidated table, and summary/charts for that período).

**Capture survives losing the wifi mid-shift.** `MonitoreoOsmosisInversa.jsx` classifies every failed write as either `red` (transient — `postgrest-js` reports `status === 0` when the fetch never got a response) or `rechazo` (a real server answer: `mediciones_valor_check`, `PGRST116` for an ownership conflict, `23503` for a deleted período/parámetro). Only `red` is queued in `web/src/lib/colaOffline.js` (`localStorage`, one key per período, collapsed to the last value per cell) and retried automatically; a `rechazo` surfaces as the usual cell error with its manual "Reintentar" and is never queued. Cells get a fourth `guardado` state, `pendiente`, and the período header shows a "Sin conexión" / "N cambios por enviar" badge. On mount, the local queue is superimposed over what the server returned, so a reload with unsent values doesn't lose them. `web/src/lib/useOnline.js` (the `online`/`offline` events) is only the retry trigger and the UI signal — never the thing that decides whether a write failed. Two known limits, both deliberate: the queue only flushes for the período currently open (pending cells of another período wait until it's reopened), and opening a never-visited período while offline from the start doesn't work — the app shell is precached, the data is not.

The PWA setup in `web/vite.config.js` (`vite-plugin-pwa`, `registerType: 'autoUpdate'`, service worker registered from `web/src/main.jsx`) exists for that same reason and makes the app installable on a tablet. It deliberately declares **no `runtimeCaching`**: only the built JS/CSS/HTML is precached, so a Supabase call is never served from cache. The icons in `web/public/icons/` are placeholders — replaceable with a real logo without touching code.

The Excel export uses `exceljs` (async: `workbook.xlsx.writeBuffer()` + a `Blob` download), not SheetJS — `xlsx@0.18.5` carried unpatched advisories and the fixed SheetJS is not published on npm. `exceljs` pulls in `uuid@8.3.2` (`GHSA-w5hq-g745-h8pq`, moderate), which `npm audit` will keep reporting; it isn't reachable here (exceljs calls `uuidv4()` without the `buf` argument that triggers it) and no exceljs release breaks that dependency chain.

Password recovery has two independent paths, because the self-service one depends on project configuration that may not be set up: `Login.jsx` → `resetPasswordForEmail` (needs the Pages URL registered under **Authentication → URL Configuration → Redirect URLs**, and realistically a custom SMTP provider — Supabase's built-in mailer is rate-limited to a handful of messages per hour), and an admin resetting the password directly from `AdminPanel.jsx` through the Edge Function, which always works. The `PASSWORD_RECOVERY` gate deliberately sits *above* the profile and `activo` checks in `App.jsx`, so a broken profile load can't trap someone on the recovery link.

### Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds `web/` and publishes `web/dist/` to GitHub Pages on every push to `main`; `.github/workflows/ci.yml` runs the same build on pull requests, because a build that only breaks on `main` leaves Pages serving the previous version with no other signal. `web/vite.config.js` sets `base` conditionally — `/` in dev, `/Planta-Osmosis/` in a production build — because Pages serves this repo under a subpath. `web/.env` commits the real Supabase project URL and `anon` key; this is intentional, not an oversight — those values are safe to expose (the `anon` key is protected by RLS, not by secrecy), and they'd be visible in the deployed bundle regardless.

`.github/workflows/respaldo.yml` runs a daily `pg_dump` and uploads it as an **encrypted** artifact (see `db/RESPALDOS.md`) — the free tier runs no backups of its own, so this is the only copy of the data besides the live database. The encryption is not optional: this repo is public, and artifacts of a public repo are downloadable by anyone. It connects through the **session pooler** (port 5432), never the direct connection — the latter is IPv6-only and GitHub runners are IPv4 — and the workflow fails early with an explicit message if `SUPABASE_DB_URL` points at either the direct host or the 6543 transaction-mode port. `ubuntu-latest` already ships `pg_dump` 16 on `PATH` (also from PGDG), and Debian's `update-alternatives` there only manages `psql`, not `pg_dump` — installing `postgresql-client-17` alongside it does *not* make `pg_dump` resolve to 17, so the workflow calls it by its versioned path (`/usr/lib/postgresql/17/bin/pg_dump`) rather than trusting `PATH`. Confirmed end-to-end in production (2026-08-04): secrets loaded, a live run went green with `auth` included, and the artifact was decrypted and restored against a local disposable Postgres to confirm the dump actually restores.

Supabase's free tier auto-pauses a project after a period of inactivity — if Supabase calls start failing with the project reachable everywhere else, check the project's status via the Management API (`GET /v1/projects/{ref}`) and restore it with `POST /v1/projects/{ref}/restore` if it shows anything other than `ACTIVE_HEALTHY`.
