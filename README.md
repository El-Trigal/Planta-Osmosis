# Monitoreo Ósmosis Inversa — Despliegue en Hostinger Business

Dominio: `plantaosmosis.trigal-digital.com`

---

## Estructura de archivos

```
db/schema.sql          → Esquema MySQL (importar en phpMyAdmin)
api/                   → API PHP (subir a public_html/api/)
web/                   → Proyecto Vite (compilar → subir dist/ a public_html/)
```

---

## Paso 1 — Crear la base de datos MySQL en hPanel

1. Entrar a **hPanel → Bases de datos → MySQL**.
2. Crear una nueva base de datos. Anota:
   - Nombre de la base: `u123456789_osmosis` (ejemplo)
   - Usuario MySQL: `u123456789_admin`
   - Contraseña MySQL: (la que definas)
3. En el mismo panel, abrir **phpMyAdmin**.
4. Seleccionar la base recién creada.
5. Ir a la pestaña **Importar** y cargar `db/schema.sql`.

---

## Paso 2 — Configurar credenciales de la API

Editar `api/config.php` con los valores reales:

```php
define('DB_HOST',  'localhost');
define('DB_NAME',  'u123456789_osmosis');
define('DB_USER',  'u123456789_admin');
define('DB_PASS',  'TuContraseñaMySQL');
define('APP_DOMAIN', 'plantaosmosis.trigal-digital.com');
define('APP_HTTPS', true);
```

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

Necesitarás una base MySQL local con el mismo esquema y ajustar `api/config.php` con `APP_HTTPS = false`.

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
