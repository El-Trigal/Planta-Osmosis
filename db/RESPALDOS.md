# Respaldos

El plan Free de Supabase **no corre ningún respaldo automático** — los diarios
empiezan en el plan Pro. Sin lo que está acá descrito, la única copia de las
mediciones sería la base viva.

`.github/workflows/respaldo.yml` vuelca la base todos los días a las 07:00 UTC
(02:00 en Colombia), la cifra y la sube como artifact del run, con 90 días de
retención. También se puede disparar a mano desde la pestaña **Actions →
Respaldo de la base → Run workflow**.

## Estado

El workflow ya está en `main` y activo, pero **todavía no respalda nada**:
faltan los dos secrets. Checklist de puesta en marcha, en orden:

- [x] Workflow en `main` (GitHub solo corre los `schedule` desde la rama por
      defecto, y el botón "Run workflow" solo aparece si el archivo está ahí)
- [ ] Secret `SUPABASE_DB_URL` cargado (paso 1)
- [ ] Secret `RESPALDO_PASSPHRASE` cargado y guardado también fuera de GitHub (paso 2)
- [ ] Primer run manual en verde (paso 4)
- [ ] Restauración probada una vez contra un proyecto de prueba (paso 5)

Los últimos cuatro necesitan credenciales del proyecto Supabase, así que no
pudieron hacerse en la sesión que escribió el workflow. **Hasta que el paso 5
esté hecho, esto son archivos cifrados, no un respaldo verificado.**

## Por qué va cifrado

Este repositorio es **público**, y los artifacts de un repo público los puede
descargar cualquiera. Subir el volcado en claro no sería un respaldo, sería
publicar los correos de los usuarios, los nombres de las empresas y todas las
mediciones. Por eso el workflow cifra con `gpg --symmetric` (AES256) antes de
subir, y aborta si detecta un `.sql` sin cifrar en la carpeta que publica.

---

## Paso 1 — Sacar la cadena de conexión

1. Entrar al [dashboard del proyecto](https://supabase.com/dashboard/project/hucfrcgcwerpbzlixgjg).
2. Botón **Connect**, arriba, al lado del nombre del proyecto.
3. Pestaña **Session pooler** — *no* "Direct connection" ni "Transaction pooler".
4. Copiar la cadena. Se ve así:

   ```
   postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

5. Reemplazar `[YOUR-PASSWORD]` por la contraseña **de la base de datos** (no es
   la de la cuenta de Supabase; es la que se anotó al crear el proyecto).

**Si esa contraseña se perdió:** Settings → Database → **Reset database
password**. Resetearla no rompe la aplicación: el frontend entra por la API REST
con la `anon` key, nunca por Postgres directo.

**Cuidado con los caracteres especiales.** Si la contraseña tiene `@`, `/`, `:`,
`?` o `#`, hay que codificarlos en la URL (`@` → `%40`, `/` → `%2F`, `:` →
`%3A`, `?` → `%3F`, `#` → `%23`) o la cadena se parsea mal y el run falla con un
error de autenticación. Lo más simple es, al resetearla, generar una solo con
letras y números.

Dos cosas que el workflow verifica antes de arrancar, porque son los dos errores
que hacen fallar esto:

- **No sirve la conexión directa** (`db.<ref>.supabase.co`): es solo IPv6 y los
  runners de GitHub son IPv4.
- **No sirve el puerto 6543**: ese es el pooler en *transaction mode*, que no
  soporta `pg_dump`. Tiene que ser el 5432 del *session pooler*.

## Paso 2 — Generar la passphrase de cifrado

```bash
openssl rand -base64 32
```

> **Guardarla en el gestor de contraseñas de la organización antes de seguir.**
> Un secret de Actions se puede escribir pero no volver a leer: si se pierde, los
> respaldos quedan como archivos que nadie puede abrir nunca. Este es el único
> modo realista de que todo este sistema falle en silencio.

## Paso 3 — Cargar los dos secrets

En [Settings → Secrets and variables → Actions](https://github.com/El-Trigal/Planta-Osmosis/settings/secrets/actions),
con **New repository secret**, con estos nombres exactos:

| Name | Secret |
|---|---|
| `SUPABASE_DB_URL` | la cadena completa del paso 1, con la contraseña adentro |
| `RESPALDO_PASSPHRASE` | la passphrase del paso 2 |

## Paso 4 — Correrlo a mano y leer el run

[Actions → Respaldo de la base](https://github.com/El-Trigal/Planta-Osmosis/actions/workflows/respaldo.yml)
→ **Run workflow** → rama `main`. Qué mirar:

| Qué aparece | Qué significa |
|---|---|
| `ok: public_<fecha>.sql.gz.gpg` | El respaldo se hizo y se puede abrir. Es lo que hay que ver. |
| Warning amarillo sobre `auth` | El respaldo de las mediciones está bien igual. Solo significa que una restauración va a requerir recrear los usuarios desde el AdminPanel. No es un fallo. |
| Falla en el primer paso | La cadena de conexión: el mensaje dice si es el host directo o el puerto 6543. Volver al paso 1. |
| Falla en "Volcar y cifrar", error de autenticación | La contraseña — casi siempre, caracteres especiales sin codificar. Paso 1. |

Al final del run, abajo de todo, tiene que aparecer el artifact
**`respaldo-<id>`**. Desde acá ya corre solo todas las noches.

## Paso 5 — Probar una restauración (una vez)

El workflow verifica en cada run que el archivo se descifra y descomprime, pero
**eso no prueba que el `.sql` restaure**. Para saberlo hay que hacerlo una vez:

1. Descargar el artifact del run y descomprimir el zip.
2. Descifrar (pide la passphrase):

   ```bash
   gpg --decrypt public_<fecha>.sql.gz.gpg | gunzip > public.sql
   ```

3. Crear un proyecto Supabase **nuevo y vacío** (el plan Free permite 2 activos).
4. Contra la cadena de conexión de *ese* proyecto:

   ```bash
   psql "<cadena-del-proyecto-de-prueba>" -f public.sql
   psql "<cadena-del-proyecto-de-prueba>" -f db/rls.sql
   ```

5. Comprobar en el Table Editor que estén las mediciones. Si están, hay respaldo
   de verdad: borrar el proyecto de prueba y marcar el checklist de arriba.

---

## Qué incluye el respaldo

| Archivo | Contenido |
|---|---|
| `public_<fecha>.sql.gz.gpg` | Esquema **y** datos de `public`: empresas, sedes, usuarios (perfil), períodos, parámetros congelados y mediciones. Es lo irreemplazable. |
| `auth_<fecha>.sql.gz.gpg` | Solo datos de `auth.users` y `auth.identities`, para que los logins sobrevivan a una restauración. |
| `MANIFIESTO.txt` | Fecha, commit, versión de `pg_dump` y si el volcado de `auth` entró o no. Sin datos sensibles: es lo único que va en claro. |

El volcado de `auth` es **mejor esfuerzo**: si el rol del pooler no puede leer
esas tablas, el run deja una advertencia y sigue. El respaldo de `public` es
válido igual — las mediciones no se pueden reconstruir, pero los usuarios sí,
recreándolos desde el AdminPanel (la Edge Function `gestionar-usuario`).

## Restaurar en producción

Igual que el paso 5, con dos aclaraciones:

- `public.sql` trae las tablas con sus datos, pero `pg_dump` corrió con
  `--no-owner --no-privileges`: las políticas de RLS y los `GRANT` se reaplican
  corriendo `db/rls.sql`, que es la fuente de verdad de la autorización.
  **No** hace falta correr `db/schema.sql` ni las migraciones: el volcado ya
  refleja el esquema con todas ellas aplicadas.
- Si se restaura también `auth`, cargar `auth.sql` **antes** que `public.sql`
  (las filas de `public.usuarios` referencian `auth.users.id`).

## Dos cosas que hay que mirar de vez en cuando

- **GitHub apaga los workflows programados de un repo sin commits por 60 días.**
  Justo cuando el proyecto se aquieta es cuando el respaldo más importa. GitHub
  avisa por correo al dueño del repo antes de desactivarlo; si llega ese aviso,
  entrar a Actions y reactivarlo con un clic.
- **Un respaldo no probado es una suposición.** Conviene repetir la restauración
  completa del paso 5 después de cualquier migración que cambie el esquema en
  serio.
