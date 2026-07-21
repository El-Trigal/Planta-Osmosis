<?php
require_once __DIR__ . '/helpers.php';

$u      = require_auth();
$method = $_SERVER['REQUEST_METHOD'];

// ── Verifica que el usuario tiene acceso a la sede ───────────────────
function puede_ver_sede(array $u, int $sede_id): bool {
    if ($u['rol'] === 'super') return true;

    if ($u['rol'] === 'admin') {
        $stmt = db()->prepare('SELECT id FROM sedes WHERE id = ? AND empresa_id = ?');
        $stmt->execute([$sede_id, $u['empresa_id']]);
        return (bool)$stmt->fetch();
    }

    $stmt = db()->prepare('SELECT 1 FROM usuario_sedes WHERE usuario_id = ? AND sede_id = ?');
    $stmt->execute([$u['id'], $sede_id]);
    return (bool)$stmt->fetch();
}

// ── GET — listar períodos de una sede ────────────────────────────────
if ($method === 'GET') {
    $sede_id = (int)($_GET['sede_id'] ?? 0);
    if ($sede_id <= 0) json_err('sede_id es requerido');
    if (!puede_ver_sede($u, $sede_id)) json_err('Acceso denegado', 403);

    $stmt = db()->prepare(
        'SELECT id, sede_id, mes, anio, dias, tolerancia, creado_en
         FROM periodos WHERE sede_id = ? ORDER BY anio DESC, mes DESC'
    );
    $stmt->execute([$sede_id]);
    json_ok($stmt->fetchAll());
}

// ── POST — crear período ─────────────────────────────────────────────
if ($method === 'POST') {
    csrf_validar();
    $data       = body();
    $sede_id    = (int)($data['sede_id']    ?? 0);
    $mes        = (int)($data['mes']        ?? 0);
    $anio       = (int)($data['anio']       ?? 0);
    $dias       = (int)($data['dias']       ?? 30);
    $tolerancia = (int)($data['tolerancia'] ?? 10);

    if ($sede_id <= 0)            json_err('sede_id es requerido');
    if ($mes < 1 || $mes > 12)   json_err('Mes inválido (1–12)');
    if ($anio < 2000 || $anio > 2100) json_err('Año inválido');
    if ($dias < 28 || $dias > 31) json_err('Días inválidos (28–31)');
    if ($tolerancia < 0 || $tolerancia > 100) json_err('Tolerancia inválida (0–100)');
    if (!puede_ver_sede($u, $sede_id)) json_err('Acceso denegado', 403);

    try {
        $stmt = db()->prepare(
            'INSERT INTO periodos (sede_id, mes, anio, dias, tolerancia) VALUES (?,?,?,?,?)'
        );
        $stmt->execute([$sede_id, $mes, $anio, $dias, $tolerancia]);
        $id = (int)db()->lastInsertId();
        json_ok([
            'id'         => $id,
            'sede_id'    => $sede_id,
            'mes'        => $mes,
            'anio'       => $anio,
            'dias'       => $dias,
            'tolerancia' => $tolerancia,
        ], 201);
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate entry')) {
            json_err('Ya existe un período para esa sede/mes/año', 409);
        }
        throw $e;
    }
}

json_err('Método no permitido', 405);
