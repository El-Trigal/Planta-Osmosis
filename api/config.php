<?php
// =====================================================================
// Configuración — reemplaza los valores con los de tu proyecto Supabase
// =====================================================================

// Credenciales Postgres (Supabase → Project Settings → Database → Connection string)
// Usa el "Session pooler" (puerto 5432) o "Transaction pooler" (puerto 6543) de Supabase,
// no la conexión directa, ya que el hosting PHP abre una conexión nueva por cada request.
define('DB_HOST',    'HOST_DE_TU_PROYECTO.pooler.supabase.com');
define('DB_PORT',    '5432');
define('DB_NAME',    'postgres');
define('DB_USER',    'postgres.TU_REF_DE_PROYECTO');
define('DB_PASS',    'CONTRASEÑA_SUPABASE');

// Dominio de la app (se usa en la cookie de sesión)
define('APP_DOMAIN', 'plantaosmosis.trigal-digital.com');

// true en producción (Hostinger ya tiene SSL); false sólo en local sin HTTPS
define('APP_HTTPS', true);

// Suprime errores PHP para que no contaminen las respuestas JSON
error_reporting(0);
ini_set('display_errors', '0');
