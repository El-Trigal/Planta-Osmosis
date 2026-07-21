<?php
require_once __DIR__ . '/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') json_err('Método no permitido', 405);

$u = require_auth();

json_ok([
    'usuario'    => $u,
    'csrf_token' => csrf_generar(),
    'sedes'      => sedes_del_usuario($u['id'], $u['rol'], $u['empresa_id']),
]);
