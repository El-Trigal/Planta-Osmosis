<?php
require_once __DIR__ . '/helpers.php';

$u      = require_rol('super', 'admin');
$method = $_SERVER['REQUEST_METHOD'];
$pdo    = db();

// Empresa que gestiona este usuario administrador
$mi_empresa = $u['empresa_id'] !== null ? (int)$u['empresa_id'] : null;

// ── Devuelve un usuario con sus sedes asignadas ──────────────────────
function usuario_con_sedes(array $row): array {
    $stmt = db()->prepare('SELECT sede_id FROM usuario_sedes WHERE usuario_id = ?');
    $stmt->execute([$row['id']]);
    $row['sedes'] = array_column($stmt->fetchAll(), 'sede_id');
    return $row;
}

// ── Asigna sedes a un usuario verificando que pertenecen a su empresa ─
function asignar_sedes(int $uid, array $sedes_ids, int $empresa_id): void {
    $pdo = db();
    $pdo->prepare('DELETE FROM usuario_sedes WHERE usuario_id = ?')->execute([$uid]);
    $ins  = $pdo->prepare('INSERT IGNORE INTO usuario_sedes (usuario_id, sede_id) VALUES (?,?)');
    $chk  = $pdo->prepare('SELECT id FROM sedes WHERE id = ? AND empresa_id = ?');
    foreach ($sedes_ids as $sid) {
        $chk->execute([(int)$sid, $empresa_id]);
        if ($chk->fetch()) $ins->execute([$uid, (int)$sid]);
    }
}

// ── GET — listar usuarios ────────────────────────────────────────────
if ($method === 'GET') {
    if ($u['rol'] === 'super') {
        $eid = isset($_GET['empresa_id']) ? (int)$_GET['empresa_id'] : null;
        if ($eid) {
            $stmt = $pdo->prepare(
                'SELECT id, empresa_id, nombre, email, rol, activo, creado_en
                 FROM usuarios WHERE empresa_id = ? ORDER BY nombre'
            );
            $stmt->execute([$eid]);
        } else {
            $stmt = $pdo->query(
                'SELECT id, empresa_id, nombre, email, rol, activo, creado_en
                 FROM usuarios ORDER BY empresa_id, nombre'
            );
        }
    } else {
        $stmt = $pdo->prepare(
            'SELECT id, empresa_id, nombre, email, rol, activo, creado_en
             FROM usuarios WHERE empresa_id = ? ORDER BY nombre'
        );
        $stmt->execute([$mi_empresa]);
    }
    $filas = $stmt->fetchAll();
    json_ok(array_map('usuario_con_sedes', $filas));
}

// ── POST — crear usuario ─────────────────────────────────────────────
if ($method === 'POST') {
    csrf_validar();
    $data       = body();
    $nombre     = trim($data['nombre']   ?? '');
    $email      = trim($data['email']    ?? '');
    $password   = $data['password'] ?? '';
    $rol        = $data['rol']      ?? 'operario';
    $empresa_id = (int)($data['empresa_id'] ?? $mi_empresa ?? 0);
    $sedes_ids  = is_array($data['sedes'] ?? null) ? $data['sedes'] : [];

    if ($nombre === '')                                json_err('El nombre es requerido');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))   json_err('Email inválido');
    if (strlen($password) < 8)                        json_err('La contraseña debe tener al menos 8 caracteres');
    if (!in_array($rol, ['admin','operario'], true))  json_err('Rol inválido (admin u operario)');
    if ($empresa_id <= 0)                             json_err('empresa_id es requerido');
    if ($u['rol'] === 'admin' && $empresa_id !== $mi_empresa) {
        json_err('Solo puedes crear usuarios en tu empresa', 403);
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);

    try {
        $stmt = $pdo->prepare(
            'INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol) VALUES (?,?,?,?,?)'
        );
        $stmt->execute([$empresa_id, $nombre, $email, $hash, $rol]);
        $nuevo_id = (int)$pdo->lastInsertId();
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate entry')) {
            json_err('El email ya está registrado', 409);
        }
        throw $e;
    }

    if (!empty($sedes_ids)) asignar_sedes($nuevo_id, $sedes_ids, $empresa_id);

    json_ok(['id' => $nuevo_id, 'nombre' => $nombre, 'email' => $email, 'rol' => $rol, 'sedes' => $sedes_ids], 201);
}

// ── PUT — actualizar usuario ─────────────────────────────────────────
if ($method === 'PUT') {
    csrf_validar();
    $data      = body();
    $target_id = (int)($data['id'] ?? 0);
    if ($target_id <= 0) json_err('id es requerido');

    $stmt = $pdo->prepare('SELECT id, empresa_id, rol FROM usuarios WHERE id = ?');
    $stmt->execute([$target_id]);
    $target = $stmt->fetch();
    if (!$target) json_err('Usuario no encontrado', 404);

    if ($u['rol'] === 'admin' && (int)$target['empresa_id'] !== $mi_empresa) {
        json_err('Acceso denegado', 403);
    }

    $updates = [];
    $params  = [];

    if (isset($data['nombre'])) {
        $nombre = trim($data['nombre']);
        if ($nombre === '') json_err('El nombre no puede estar vacío');
        $updates[] = 'nombre = ?';
        $params[]  = $nombre;
    }
    if (isset($data['activo'])) {
        $updates[] = 'activo = ?';
        $params[]  = (int)(bool)$data['activo'];
    }
    if (!empty($data['password'])) {
        if (strlen($data['password']) < 8) json_err('Contraseña muy corta (mínimo 8 caracteres)');
        $updates[] = 'password_hash = ?';
        $params[]  = password_hash($data['password'], PASSWORD_BCRYPT);
    }

    if (!empty($updates)) {
        $params[] = $target_id;
        $pdo->prepare('UPDATE usuarios SET ' . implode(', ', $updates) . ' WHERE id = ?')
            ->execute($params);
    }

    if (isset($data['sedes']) && is_array($data['sedes'])) {
        asignar_sedes($target_id, $data['sedes'], (int)$target['empresa_id']);
    }

    json_ok(['ok' => true]);
}

json_err('Método no permitido', 405);
