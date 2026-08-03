# Respaldos

El plan Free de Supabase **no corre ningún respaldo automático** — los diarios
empiezan en el plan Pro. Sin lo que está acá descrito, la única copia de las
mediciones sería la base viva.

`.github/workflows/respaldo.yml` vuelca la base todos los días a las 07:00 UTC
(02:00 en Colombia), la cifra y la sube como artifact del run, con 90 días de
retención. También se puede disparar a mano desde la pestaña **Actions →
Respaldo de la base → Run workflow**.

## Por qué va cifrado

Este repositorio es **público**, y los artifacts de un repo público los puede
descargar cualquiera. Subir el volcado en claro no sería un respaldo, sería
publicar los correos de los usuarios, los nombres de las empresas y todas las
mediciones. Por eso el workflow cifra con `gpg --symmetric` (AES256) antes de
subir, y aborta si detecta un `.sql` sin cifrar en la carpeta que publica.

## Puesta en marcha (una sola vez)

Los dos valores van en **Settings → Secrets and variables → Actions → New
repository secret**.

### `SUPABASE_DB_URL`

La cadena de conexión del **session pooler**, con la contraseña de la base
adentro. Se saca del dashboard de Supabase: **Connect → Session pooler**. Se ve
así:

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Dos cosas que el workflow verifica antes de arrancar, porque son los dos
errores que hacen fallar esto:

- **No sirve la conexión directa** (`db.<ref>.supabase.co`): es solo IPv6 y los
  runners de GitHub son IPv4.
- **No sirve el puerto 6543**: ese es el pooler en *transaction mode*, que no
  soporta `pg_dump`. Tiene que ser el 5432 del *session pooler*.

### `RESPALDO_PASSPHRASE`

Una passphrase larga y aleatoria, la que cifra el volcado.

> **Guardala también fuera de GitHub** — en el gestor de contraseñas de la
> organización. Un secret de Actions se puede escribir pero no leer: si se
> pierde, los respaldos quedan como archivos que nadie puede abrir. Es el único
> modo realista de que este sistema falle en silencio.

## Qué incluye

| Archivo | Contenido |
|---|---|
| `public_<fecha>.sql.gz.gpg` | Esquema **y** datos de `public`: empresas, sedes, usuarios (perfil), períodos, parámetros congelados y mediciones. Es lo irreemplazable. |
| `auth_<fecha>.sql.gz.gpg` | Solo datos de `auth.users` y `auth.identities`, para que los logins sobrevivan a una restauración. |
| `MANIFIESTO.txt` | Fecha, commit, versión de `pg_dump` y si el volcado de `auth` entró o no. Sin datos sensibles: es lo único que va en claro. |

El volcado de `auth` es **mejor esfuerzo**: si el rol del pooler no puede leer
esas tablas, el run deja una advertencia y sigue. El respaldo de `public` es
válido igual — las mediciones no se pueden reconstruir, pero los usuarios sí,
recreándolos desde el AdminPanel (la Edge Function `gestionar-usuario`).

## Restaurar

1. Descargar el artifact del run que corresponda (**Actions → el run →
   Artifacts**).
2. Descifrar y descomprimir:

   ```bash
   gpg --decrypt public_<fecha>.sql.gz.gpg | gunzip > public.sql
   ```

3. Contra un proyecto Supabase **vacío**, en este orden:

   ```bash
   psql "$DB_URL" -f public.sql     # esquema + datos de public
   psql "$DB_URL" -f db/rls.sql     # helpers, triggers de columna, políticas, grants
   ```

   `public.sql` trae las tablas con sus datos, pero `pg_dump` corrió con
   `--no-owner --no-privileges`: las políticas de RLS y los `GRANT` se
   reaplican corriendo `db/rls.sql`, que es la fuente de verdad de la
   autorización. **No** hace falta correr `db/schema.sql` ni las migraciones:
   el volcado ya refleja el esquema con todas ellas aplicadas.

4. Si se restaura también `auth`, cargar `auth.sql` **antes** que `public.sql`
   (las filas de `public.usuarios` referencian `auth.users.id`).

## Dos cosas que hay que mirar de vez en cuando

- **GitHub apaga los workflows programados de un repo sin commits por 60
  días.** Justo cuando el proyecto se aquieta es cuando el respaldo más
  importa. Si pasan un par de meses sin tocar el repo, entrar a Actions y
  confirmar que el schedule sigue activo (GitHub avisa por correo antes de
  desactivarlo, al dueño del repo).
- **Un respaldo no probado es una suposición.** El workflow verifica en cada
  run que el archivo se puede descifrar y descomprimir, pero eso no prueba que
  el `.sql` restaure bien. Conviene hacer la restauración completa contra un
  proyecto Supabase de prueba al menos una vez, y repetirla después de
  cualquier migración que cambie el esquema en serio.
