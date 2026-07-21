<?php
require_once __DIR__ . '/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('Método no permitido', 405);

require_auth();
csrf_validar();
session_destroy();
json_ok(['ok' => true]);
