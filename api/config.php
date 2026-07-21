<?php
// =====================================================================
// Configuración — reemplaza los valores con los de Hostinger hPanel
// =====================================================================

// Credenciales MySQL (Hostinger → Bases de datos → MySQL)
define('DB_HOST',    'localhost');
define('DB_NAME',    'NOMBRE_DE_TU_BASE');   // ej. u123456789_osmosis
define('DB_USER',    'USUARIO_MYSQL');        // ej. u123456789_admin
define('DB_PASS',    'CONTRASEÑA_MYSQL');
define('DB_CHARSET', 'utf8mb4');

// Dominio de la app (se usa en la cookie de sesión)
define('APP_DOMAIN', 'plantaosmosis.trigal-digital.com');

// true en producción (Hostinger ya tiene SSL); false sólo en local sin HTTPS
define('APP_HTTPS', true);

// Suprime errores PHP para que no contaminen las respuestas JSON
error_reporting(0);
ini_set('display_errors', '0');
