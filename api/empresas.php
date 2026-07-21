<?php
require_once __DIR__ . '/helpers.php';

$u      = require_rol('super');
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $stmt = db()->query('SELECT id, nombre, creado_en FROM empresas ORDER BY nombre');
    json_ok($stmt->fetchAll());
}

if ($method === 'POST') {
    csrf_validar();
    $data   = body();
    $nombre = trim($data['nombre'] ?? '');
    if ($nombre === '') json_err('El nombre es requerido');

    $stmt = db()->prepare('INSERT INTO empresas (nombre) VALUES (?)');
    $stmt->execute([$nombre]);
    json_ok(['id' => (int)db()->lastInsertId(), 'nombre' => $nombre], 201);
}

json_err('Método no permitido', 405);
