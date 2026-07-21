<?php
require_once __DIR__ . '/helpers.php';

$u      = require_auth();
$method = $_SERVER['REQUEST_METHOD'];

// ── Devuelve el período si el usuario tiene acceso, null si no ───────
function get_periodo_accesible(int $periodo_id, array $u): ?array {
    $stmt = db()->prepare(
        'SELECT p.id, p.sede_id, p.mes, p.anio, p.dias, p.tolerancia
         FROM periodos p WHERE p.id = ?'
    );
    $stmt->execute([$periodo_id]);
    $p = $stmt->fetch();
    if (!$p) return null;

    if ($u['rol'] === 'super') return $p;

    if ($u['rol'] === 'admin') {
        $stmt = db()->prepare('SELECT id FROM sedes WHERE id = ? AND empresa_id = ?');
        $stmt->execute([$p['sede_id'], $u['empresa_id']]);
        return $stmt->fetch() ? $p : null;
    }

    $stmt = db()->prepare('SELECT 1 FROM usuario_sedes WHERE usuario_id = ? AND sede_id = ?');
    $stmt->execute([$u['id'], $p['sede_id']]);
    return $stmt->fetch() ? $p : null;
}

// ── GET — listar mediciones del período ──────────────────────────────
if ($method === 'GET') {
    $periodo_id = (int)($_GET['periodo_id'] ?? 0);
    if ($periodo_id <= 0) json_err('periodo_id es requerido');

    $periodo = get_periodo_accesible($periodo_id, $u);
    if (!$periodo) json_err('Período no encontrado o sin acceso', 403);

    $stmt = db()->prepare(
        'SELECT m.dia, m.param_id, m.valor, m.usuario_id, u.nombre AS usuario_nombre, m.actualizado_en
         FROM mediciones m JOIN usuarios u ON u.id = m.usuario_id
         WHERE m.periodo_id = ?
         ORDER BY m.dia, m.param_id'
    );
    $stmt->execute([$periodo_id]);

    // Estructura: { dia: { param_id: { valor, usuario_id, usuario_nombre } } }
    $resultado = [];
    foreach ($stmt->fetchAll() as $row) {
        $dia = (int)$row['dia'];
        $resultado[$dia][$row['param_id']] = [
            'valor'          => $row['valor'] !== null ? (float)$row['valor'] : null,
            'usuario_id'     => (int)$row['usuario_id'],
            'usuario_nombre' => $row['usuario_nombre'],
            'actualizado_en' => $row['actualizado_en'],
        ];
    }
    json_ok($resultado);
}

// ── POST — upsert de una medición (onBlur del operario) ──────────────
if ($method === 'POST') {
    csrf_validar();
    $data       = body();
    $periodo_id = (int)($data['periodo_id'] ?? 0);
    $dia        = (int)($data['dia']        ?? 0);
    $param_id   = $data['param_id'] ?? '';
    $valor_raw  = $data['valor']    ?? null;

    if ($periodo_id <= 0)                json_err('periodo_id es requerido');
    if (!validar_param_id($param_id))   json_err('param_id inválido');

    $periodo = get_periodo_accesible($periodo_id, $u);
    if (!$periodo) json_err('Período no encontrado o sin acceso', 403);
    if (!validar_dia($dia, (int)$periodo['dias'])) {
        json_err("Día fuera de rango (1–{$periodo['dias']})");
    }

    // Parsear y validar valor numérico
    if ($valor_raw !== null && (string)$valor_raw !== '') {
        $valor_str = str_replace(',', '.', trim((string)$valor_raw));
        if (!is_numeric($valor_str)) json_err('El valor debe ser numérico');
        $valor = (float)$valor_str;
        if ($valor < -9999.9999 || $valor > 99999.9999) json_err('Valor fuera de rango permitido');
    } else {
        $valor = null;
    }

    $pdo = db();

    // Buscar medición existente con nombre del dueño
    $stmt = $pdo->prepare(
        'SELECT m.id, m.usuario_id, u.nombre AS usuario_nombre
         FROM mediciones m JOIN usuarios u ON u.id = m.usuario_id
         WHERE m.periodo_id = ? AND m.dia = ? AND m.param_id = ?'
    );
    $stmt->execute([$periodo_id, $dia, $param_id]);
    $existente = $stmt->fetch();

    if ($existente) {
        $dueno_id     = (int)$existente['usuario_id'];
        $dueno_nombre = $existente['usuario_nombre'];

        // Operario solo puede editar sus propias celdas
        if ($u['rol'] === 'operario' && $dueno_id !== $u['id']) {
            json_err('Solo puedes editar tus propias mediciones', 403);
        }

        if ($valor === null) {
            // Valor vacío = borrar la medición
            $pdo->prepare('DELETE FROM mediciones WHERE id = ?')->execute([$existente['id']]);
            json_ok(['eliminado' => true]);
        }

        // Actualizar valor; no cambiamos usuario_id para preservar autoría original
        $pdo->prepare('UPDATE mediciones SET valor = ? WHERE id = ?')
            ->execute([$valor, $existente['id']]);
        json_ok([
            'updated'        => true,
            'usuario_id'     => $dueno_id,
            'usuario_nombre' => $dueno_nombre,
        ]);
    } else {
        if ($valor === null) json_ok(['sin_cambio' => true]);

        $pdo->prepare(
            'INSERT INTO mediciones (periodo_id, dia, param_id, valor, usuario_id) VALUES (?,?,?,?,?)'
        )->execute([$periodo_id, $dia, $param_id, $valor, $u['id']]);
        json_ok([
            'created'        => true,
            'usuario_id'     => $u['id'],
            'usuario_nombre' => $u['nombre'],
        ], 201);
    }
}

// ── DELETE — borrar medición explícitamente ──────────────────────────
if ($method === 'DELETE') {
    csrf_validar();
    $data       = body();
    $periodo_id = (int)($data['periodo_id'] ?? 0);
    $dia        = (int)($data['dia']        ?? 0);
    $param_id   = $data['param_id'] ?? '';

    if ($periodo_id <= 0 || $dia <= 0 || !validar_param_id($param_id)) {
        json_err('Parámetros inválidos');
    }

    $periodo = get_periodo_accesible($periodo_id, $u);
    if (!$periodo) json_err('Período no encontrado o sin acceso', 403);

    $pdo  = db();
    $stmt = $pdo->prepare(
        'SELECT id, usuario_id FROM mediciones WHERE periodo_id = ? AND dia = ? AND param_id = ?'
    );
    $stmt->execute([$periodo_id, $dia, $param_id]);
    $m = $stmt->fetch();

    if (!$m) json_ok(['sin_cambio' => true]);

    if ($u['rol'] === 'operario' && (int)$m['usuario_id'] !== $u['id']) {
        json_err('Solo puedes borrar tus propias mediciones', 403);
    }

    $pdo->prepare('DELETE FROM mediciones WHERE id = ?')->execute([$m['id']]);
    json_ok(['eliminado' => true]);
}

json_err('Método no permitido', 405);
