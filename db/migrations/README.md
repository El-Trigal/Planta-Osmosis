# Migraciones

Cambios de esquema posteriores a la línea base (`db/schema.sql` + `db/rls.sql`).

## Cómo se corren

En orden numérico ascendente, **una sola vez cada uno**, contra el Postgres
del proyecto Supabase — por el SQL Editor del dashboard o por la Management
API (`POST https://api.supabase.com/v1/projects/{ref}/database/query`).

Un proyecto nuevo se levanta así:

```
db/schema.sql          → tablas, constraints, triggers
db/rls.sql             → helpers, columnas protegidas, políticas, grants
db/migrations/0001_…   → y de ahí en adelante, en orden
```

Un proyecto que ya está vivo solo necesita las migraciones que le falten.

## Reglas

- **Nunca borrar ni editar una migración ya aplicada en producción.** Si algo
  salió mal, se corrige con una migración nueva que la enmiende.
- Cada archivo debe ser idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`,
  `DROP POLICY IF EXISTS` antes de `CREATE POLICY`), para que volver a
  correrlo por accidente no rompa nada.
- Nada de `DROP TABLE` ni de borrado de columnas con datos sin una nota
  explícita en el encabezado del archivo explicando qué se pierde.
- Ninguna migración asume que la base está vacía: la línea base sí describe
  un proyecto desde cero, las migraciones no.

## Aplicadas

| Archivo | Qué hace |
|---------|----------|
| `0001_correcciones_y_borrado.sql` | Permite renombrar empresas y sedes, ajustar días/tolerancia de un período y borrar lo que todavía no tiene historial. Agrega triggers de columna protegida y guardas de borrado para que ningún `DELETE` se lleve datos en cascada en silencio. |
| `0002_parametros_por_sede.sql` | Saca los 17 parámetros de estar quemados en el código: cada sede define los suyos (`sede_etapas`/`sede_parametros`) y cada período conserva congelada la copia que regía al crearlo (`periodo_etapas`/`periodo_parametros`). Migra `mediciones.param_id` a `parametro_id`. **Aborta sin cambiar nada si alguna medición existente no logra mapearse**, así que si falla no hay que deshacer nada: se corrige la causa y se vuelve a correr. |
