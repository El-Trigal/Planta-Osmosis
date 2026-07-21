# Monitoreo Ósmosis Inversa — Despliegue en Hostinger Business

Dominio: `plantaosmosis.trigal-digital.com`

---

## Estructura de archivos

```
db/schema.sql          → Esquema PostgreSQL (importar en el SQL Editor de Supabase)
api/                   → API PHP (subir a public_html/api/)
web/                   → Proyecto Vite (compilar → subir dist/ a public_html/)
```

---

## Paso 1 — Crear el proyecto y la base de datos en Supabase

1. Crear un proyecto en [supabase.com](https://supabase.com) (anota la contraseña de la base al crearlo).
2. Ir a **SQL Editor** → pegar el contenido de `db/schema.sql` → **Run**.
3. Ir a **Project Settings → Database → Connection string** y copiar los datos del **Session pooler** (puerto `5432`):
   - Host: algo como `aws-0-xxxx.pooler.supabase.com`
   - User: `postgres.TU_REF_DE_PROYECTO`
   - Database: `postgres`
   - Password: la que definiste al crear el proyecto

   Usa el pooler (no la conexión directa) porque el hosting PHP abre una conexión nueva en cada request y la conexión directa tiene un límite bajo de conexiones concurrentes.

---

## Paso 2 — Configurar credenciales de la API

Editar `api/config.php` con los valores reales:

```php
define('DB_HOST', 'aws-0-xxxx.pooler.supabase.com');
define('DB_PORT', '5432');
define('DB_NAME', 'postgres');
define('DB_USER', 'postgres.TU_REF_DE_PROYECTO');
define('DB_PASS', 'TuContraseñaSupabase');
define('APP_DOMAIN', 'plantaosmosis.trigal-digital.com');
define('APP_HTTPS', true);
```

> **Importante:** la API usa el driver `pdo_pgsql` de PHP para hablar con Postgres. En hPanel de Hostinger, ve a **Sitios web → Administrar → PHP Configuration → Extensiones** y confirma que `pdo_pgsql` (y `pgsql`) estén activadas antes de subir la API; no todos los planes las traen activas por defecto.

---

## Paso 3 — Crear el primer usuario Super

Crear el archivo `create_super.php` en la raíz del servidor (temporalmente):

```php
<?php
require_once __DIR__ . '/api/config.php';
require_once __DIR__ . '/api/db.php';

$nombre   = 'Super Admin';            // cambia a lo que quieras
$email    = 'super@tudominio.com';    // cambia
$password = 'CambiaEstaContraseña1!'; // mínimo 8 chars

$hash = password_hash($password, PASSWORD_BCRYPT);
db()->prepare(
    "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?,?,?,?)"
)->execute([$nombre, $email, $hash, 'super']);

echo 'Usuario super creado. ELIMINA ESTE ARCHIVO AHORA.';
```

Acceder una vez a `https://plantaosmosis.trigal-digital.com/create_super.php` y luego **eliminar el archivo** inmediatamente.

---

## Paso 4 — Compilar el front-end React

En tu máquina local, desde la carpeta `web/`:

```bash
cd web
npm install
npm run build
```

Esto genera la carpeta `web/dist/` con los archivos estáticos.

---

## Paso 5 — Subir archivos al servidor

Usando el **Administrador de archivos de hPanel** o FTP (FileZilla):

### Subir el front compilado
Copiar **el contenido** de `web/dist/` (no la carpeta en sí) a `public_html/`:
```
public_html/
  index.html
  assets/
    index-xxxx.js
    index-xxxx.css
```

### Subir la API PHP
Copiar la carpeta `api/` completa a `public_html/api/`:
```
public_html/api/
  .htaccess
  config.php
  db.php
  helpers.php
  login.php
  logout.php
  me.php
  empresas.php
  sedes.php
  usuarios.php
  periodos.php
  mediciones.php
```

### Crear .htaccess raíz (public_html/.htaccess)
Si no existe, crear con este contenido para forzar HTTPS:

```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

---

## Paso 6 — Activar SSL

En **hPanel → SSL → Instalar** → seleccionar tu dominio → activar Let's Encrypt (gratuito).

---

## Paso 7 — Verificar la instalación

1. Acceder a `https://plantaosmosis.trigal-digital.com`
2. Debe aparecer la pantalla de login.
3. Ingresar con el usuario super creado en el Paso 3.
4. En el **Panel Admin** (esquina superior derecha):
   - Crear empresa(s)
   - Crear sede(s) dentro de cada empresa
   - Crear administradores para cada empresa
5. Cada admin puede crear operarios y asignarles sedes.

---

## Desarrollo local (opcional)

Para probar en tu máquina antes de subir:

```bash
# Terminal 1 — servidor PHP (desde la raíz del proyecto)
php -S localhost:8000

# Terminal 2 — Vite dev server
cd web
npm run dev
```

Acceder a `http://localhost:5173` (Vite redirige `/api` a PHP por el proxy configurado en `vite.config.js`).

Puedes apuntar directamente al mismo proyecto Supabase (no hace falta una base local) y ajustar `api/config.php` con `APP_HTTPS = false`.

---

## Roles y permisos

| Rol | Puede hacer |
|-----|------------|
| `super` | Crear empresas, crear/activar administradores de cualquier empresa |
| `admin` | Crear sedes y operarios en su empresa; editar cualquier celda de su empresa |
| `operario` | Ver todas las mediciones del período; crear/editar/borrar solo sus propias celdas |

---

## Notas de seguridad

- Las contraseñas se almacenan con `password_hash()` (bcrypt).
- Las sesiones usan cookies `httponly + SameSite=Strict`.
- Todas las escrituras requieren token CSRF en el header `X-CSRF-Token`.
- El control de propiedad por celda se valida siempre en el servidor (HTTP 403 si viola la regla).
- Ningún archivo de configuración (`config.php`, `db.php`, `helpers.php`) es accesible directamente por HTTP (bloqueado por `.htaccess`).
