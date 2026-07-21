<?php
require_once __DIR__ . '/helpers.php';

$u      = require_auth();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // Reutiliza la misma lógica de sedes_del_usuario; opcionalmente filtra por empresa
    if ($u['rol'] === 'super') {
        $eid  = isset($_GET['empresa_id']) ? (int)$_GET['empresa_id'] : null;
        if ($eid) {
            $stmt = db()->prepare(
                'SELECT s.id, s.nombre, s.empresa_id, e.nombre AS empresa_nombre, s.creado_en
                 FROM sedes s JOIN empresas e ON e.id = s.empresa_id
                 WHERE s.empresa_id = ? ORDER BY s.nombre'
            );
            $stmt->execute([$eid]);
        } else {
            $stmt = db()->query(
                'SELECT s.id, s.nombre, s.empresa_id, e.nombre AS empresa_nombre, s.creado_en
                 FROM sedes s JOIN empresas e ON e.id = s.empresa_id
                 ORDER BY e.nombre, s.nombre'
            );
        }
    } elseif ($u['rol'] === 'admin') {
        $stmt = db()->prepare(
            'SELECT s.id, s.nombre, s.empresa_id, e.nombre AS empresa_nombre, s.creado_en
             FROM sedes s JOIN empresas e ON e.id = s.empresa_id
             WHERE s.empresa_id = ? ORDER BY s.nombre'
        );
        $stmt->execute([$u['empresa_id']]);
    } else {
        $stmt = db()->prepare(
            'SELECT s.id, s.nombre, s.empresa_id, e.nombre AS empresa_nombre, s.creado_en
             FROM sedes s
             JOIN empresas e ON e.id = s.empresa_id
             JOIN usuario_sedes us ON us.sede_id = s.id
             WHERE us.usuario_id = ? ORDER BY s.nombre'
        );
        $stmt->execute([$u['id']]);
    }
    json_ok($stmt->fetchAll());
}

if ($method === 'POST') {
    require_rol('super', 'admin');
    csrf_validar();
    $data       = body();
    $nombre     = trim($data['nombre'] ?? '');
    $empresa_id = (int)($data['empresa_id'] ?? $u['empresa_id'] ?? 0);

    if ($nombre === '') json_err('El nombre es requerido');
    if ($empresa_id <= 0) json_err('empresa_id es requerido');
    if ($u['rol'] === 'admin' && $empresa_id !== (int)$u['empresa_id']) {
        json_err('Solo puedes crear sedes en tu empresa', 403);
    }

    $stmt = db()->prepare('INSERT INTO sedes (empresa_id, nombre) VALUES (?,?) RETURNING id');
    $stmt->execute([$empresa_id, $nombre]);
    json_ok(['id' => (int)$stmt->fetchColumn(), 'nombre' => $nombre, 'empresa_id' => $empresa_id], 201);
}

json_err('Método no permitido', 405);
