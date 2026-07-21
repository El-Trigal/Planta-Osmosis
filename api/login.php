<?php
require_once __DIR__ . '/helpers.php';

iniciar_sesion();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_err('Método no permitido', 405);

$data     = body();
$email    = trim($data['email']    ?? '');
$password = $data['password'] ?? '';

if ($email === '' || $password === '') json_err('Email y contraseña son requeridos');
if (!filter_var($email, FILTER_VALIDATE_EMAIL))  json_err('Email inválido');

$stmt = db()->prepare(
    'SELECT id, empresa_id, nombre, email, password_hash, rol, activo
     FROM usuarios WHERE email = ? LIMIT 1'
);
$stmt->execute([$email]);
$usuario = $stmt->fetch();

// Misma demora tanto si el usuario no existe como si la contraseña es incorrecta
// (evita enumeración de cuentas)
if (!$usuario || !password_verify($password, $usuario['password_hash'])) {
    json_err('Credenciales incorrectas', 401);
}
if (!$usuario['activo']) json_err('Cuenta desactivada', 403);

// Nuevo ID de sesión al autenticar
session_regenerate_id(true);

$_SESSION['usuario'] = [
    'id'         => (int)$usuario['id'],
    'empresa_id' => $usuario['empresa_id'] !== null ? (int)$usuario['empresa_id'] : null,
    'nombre'     => $usuario['nombre'],
    'email'      => $usuario['email'],
    'rol'        => $usuario['rol'],
];

json_ok([
    'usuario'    => $_SESSION['usuario'],
    'csrf_token' => csrf_generar(),
    'sedes'      => sedes_del_usuario(
        (int)$usuario['id'],
        $usuario['rol'],
        $usuario['empresa_id'] !== null ? (int)$usuario['empresa_id'] : null
    ),
]);
