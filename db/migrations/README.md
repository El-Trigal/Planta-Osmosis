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
- **Una tabla nueva necesita su `GRANT` también en `db/rls.sql`**, no solo
  dentro de la migración. El respaldo se vuelca con `--no-privileges` (no
  lleva ningún `GRANT`) y el procedimiento de restauración de
  `db/RESPALDOS.md` reaplica los permisos corriendo `rls.sql` y nada más:
  una tabla cuyo `GRANT` viva únicamente en la migración queda sin
  privilegios al restaurar, y eso se descubre el día del desastre. Como en
  un proyecto nuevo `rls.sql` corre *antes* que las migraciones, el `GRANT`
  de una tabla que todavía no existe va en un bloque guardado por
  `to_regclass` — hay uno hecho al final de `rls.sql`, con las cuatro
  tablas de `0002`, para copiar.

## Cómo probarla antes de aplicarla

Una migración se aplica a mano contra la base de producción, que es la única
que hay. Antes de eso conviene correrla en un Postgres descartable: levantar
uno lleva un minuto y no toca nada.

```bash
# En Debian/Ubuntu initdb y pg_ctl no están en el PATH — ahí solo queda
# psql — así que van por su ruta versionada (misma razón por la que el
# workflow de respaldo llama a pg_dump por ruta completa).
PGBIN=/usr/lib/postgresql/16/bin

# Un cluster propio, en un directorio temporal, que se borra al terminar.
# initdb se niega a correr como root: si hace falta, un `useradd -M pgtest`
# y correr estos tres comandos con `su pgtest -c '...'` sobre un directorio
# que ese usuario pueda atravesar.
"$PGBIN/initdb" -D /tmp/pg/data -U postgres --auth=trust
"$PGBIN/pg_ctl" -D /tmp/pg/data -o "-k /tmp/pg -h ''" -l /tmp/pg/log start
psql "host=/tmp/pg user=postgres dbname=postgres" -c "CREATE DATABASE proyecto"
```

Falta lo que pone Supabase y un Postgres pelado no tiene. Sin esto,
`rls.sql` no aplica: sus políticas llaman a `auth.uid()` y `auth.role()`, y
sus `GRANT` nombran roles que no existen.

```sql
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid()  RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);  -- usuarios.id la referencia
```

Y ahí sí, el camino completo de un proyecto nuevo, con `-v ON_ERROR_STOP=1`
para que no pase por alto un error a mitad:

```bash
for f in db/schema.sql db/rls.sql db/migrations/*.sql; do
  psql "host=/tmp/pg user=postgres dbname=proyecto" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

Los `NOTICE: ... does not exist, skipping` son normales: son los
`DROP ... IF EXISTS` que hacen idempotentes a estos archivos.

Qué conviene mirar después, además de que no haya fallado nada:

- **Que valga también para una base que ya existía.** Correr la migración
  dos veces seguidas (tiene que ser idempotente) y correrla sobre una base
  con datos, no solo sobre una recién creada.
- **Los permisos, tabla por tabla** — es lo que no salta como error:

  ```sql
  SELECT c.relname,
         COALESCE(string_agg(DISTINCT g.privilege_type, ','), '(NINGUNO)')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  LEFT JOIN information_schema.role_table_grants g
    ON g.table_name = c.relname AND g.table_schema = 'public'
   AND g.grantee = 'authenticated'
  WHERE c.relkind = 'r'
  GROUP BY c.relname ORDER BY c.relname;
  ```

  Ninguna tabla debería quedar en `(NINGUNO)`. Así se encontró que las
  cuatro tablas de `0002` no sobrevivían a una restauración.
- **Los triggers, con datos de mentira.** Insertar una empresa → una sede →
  un período alcanza para ver la siembra de la plantilla (5 etapas, 17
  parámetros) y su copia al período; una medición alcanza para ver las
  guardas de borrado y la protección de columnas.

Cuando termina: `"$PGBIN/pg_ctl" -D /tmp/pg/data stop && rm -rf /tmp/pg`.

Lo que esta prueba **no** cubre: el comportamiento real de RLS (las políticas
se aplican, pero `auth.uid()` acá es un stub, así que no hay sesiones de
verdad que probar) ni nada del esquema `auth` de Supabase.

## Aplicadas

| Archivo | Qué hace |
|---------|----------|
| `0001_correcciones_y_borrado.sql` | Permite renombrar empresas y sedes, ajustar días/tolerancia de un período y borrar lo que todavía no tiene historial. Agrega triggers de columna protegida y guardas de borrado para que ningún `DELETE` se lleve datos en cascada en silencio. |
| `0002_parametros_por_sede.sql` | Saca los 17 parámetros de estar quemados en el código: cada sede define los suyos (`sede_etapas`/`sede_parametros`) y cada período conserva congelada la copia que regía al crearlo (`periodo_etapas`/`periodo_parametros`). Migra `mediciones.param_id` a `parametro_id`. **Aborta sin cambiar nada si alguna medición existente no logra mapearse**, así que si falla no hay que deshacer nada: se corrige la causa y se vuelve a correr. |
