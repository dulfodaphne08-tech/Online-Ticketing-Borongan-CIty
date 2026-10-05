<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';

if (method() !== 'POST') fail('Method not allowed.', 405);

$login    = trim((string)(body()['username'] ?? ''));
$password = (string)(body()['password'] ?? '');

if ($login === '' || $password === '') {
    fail('Please enter your username and password.', 422);
}

$stmt = $pdo->prepare('SELECT * FROM users WHERE lower(username) = lower(:login) OR lower(email) = lower(:login) LIMIT 1');
$stmt->execute([':login' => $login]);
$user = $stmt->fetch();

 if (!$user || !verifyPasswordAndUpgrade($pdo, $user, $password)) {
    fail('Invalid username or password.', 401);
}

if (!isActive($user['status'] ?? 'Active')) {
    fail('Your account is inactive. Please contact the BCTT office.', 403);
}

$role = normalizeRole((string)($user['role'] ?? ''));
if (!in_array($role, ['admin', 'cashier', 'staff', 'driver'], true)) {
    fail('This account has no valid role. Please contact the system administrator.', 403);
}

$driverId = null;
if ($role === 'driver') {
    $d = $pdo->prepare('SELECT driver_id, status FROM drivers WHERE user_id = ? LIMIT 1');
    $d->execute([$user['id']]);
    $driver = $d->fetch();
    if (!$driver) fail('No driver profile is linked to this account. Please contact the BCTT office.', 403);
    if (!isActive($driver['status'] ?? 'Active')) fail('Your driver account is inactive. Please contact the BCTT office.', 403);
    $driverId = (string)$driver['driver_id'];
}

startAuthenticatedSession($user, $driverId);

ok([
    'user'     => currentUser(),
    'redirect' => landingPageFor($role),
], 'Welcome, ' . ($user['full_name'] ?: $user['username']) . '!');
