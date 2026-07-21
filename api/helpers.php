<?php
require_once __DIR__ . '/db.php';

// ── Sesión segura ────────────────────────────────────────────────────
function iniciar_sesion(): void {
    if (session_status() !== PHP_SESSION_NONE) return;
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'domain'   => defined('APP_DOMAIN') ? APP_DOMAIN : '',
        'secure'   => defined('APP_HTTPS') ? APP_HTTPS : true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_name('osmosis_sess');
    session_start();
}

// ── Respuestas JSON ──────────────────────────────────────────────────
function json_ok(array $data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_err(string $mensaje, int $code = 400): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $mensaje], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Autenticación ────────────────────────────────────────────────────
function usuario_actual(): ?array {
    iniciar_sesion();
    return $_SESSION['usuario'] ?? null;
}

function require_auth(): array {
    $u = usuario_actual();
    if (!$u) json_err('No autenticado', 401);
    return $u;
}

function require_rol(string ...$roles): array {
    $u = require_auth();
    if (!in_array($u['rol'], $roles, true)) json_err('Acceso denegado', 403);
    return $u;
}

// ── CSRF ─────────────────────────────────────────────────────────────
function csrf_generar(): string {
    iniciar_sesion();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function csrf_validar(): void {
    iniciar_sesion();
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (empty($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $token)) {
        json_err('Token CSRF inválido', 403);
    }
}

// ── Body JSON ────────────────────────────────────────────────────────
function body(): array {
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

// ── Validaciones ─────────────────────────────────────────────────────
function validar_param_id(string $id): bool {
    static $validos = [
        'pre_ce','pre_ph','pre_cl','pre_al',
        'air_ce','air_ph','air_cl',
        'prf_ce','prf_ph','prf_cl',
        'pof_ce','pof_ph','pof_cl',
        'prd_ce','prd_ph','prd_cl','prd_caudal',
    ];
    return in_array($id, $validos, true);
}

function validar_dia(int $dia, int $dias_mes): bool {
    return $dia >= 1 && $dia <= $dias_mes;
}

// ── Sedes accesibles según rol ───────────────────────────────────────
function sedes_del_usuario(int $uid, string $rol, ?int $empresa_id): array {
    if ($rol === 'super') {
        $stmt = db()->prepare(
            'SELECT s.id, s.nombre, s.empresa_id, e.nombre AS empresa_nombre
             FROM sedes s JOIN empresas e ON e.id = s.empresa_id
             ORDER BY e.nombre, s.nombre'
        );
        $stmt->execute();
    } elseif ($rol === 'admin') {
        $stmt = db()->prepare(
            'SELECT s.id, s.nombre, s.empresa_id, e.nombre AS empresa_nombre
             FROM sedes s JOIN empresas e ON e.id = s.empresa_id
             WHERE s.empresa_id = ?
             ORDER BY s.nombre'
        );
        $stmt->execute([$empresa_id]);
    } else {
        $stmt = db()->prepare(
            'SELECT s.id, s.nombre, s.empresa_id, e.nombre AS empresa_nombre
             FROM sedes s
             JOIN empresas e ON e.id = s.empresa_id
             JOIN usuario_sedes us ON us.sede_id = s.id
             WHERE us.usuario_id = ?
             ORDER BY s.nombre'
        );
        $stmt->execute([$uid]);
    }
    return $stmt->fetchAll();
}
