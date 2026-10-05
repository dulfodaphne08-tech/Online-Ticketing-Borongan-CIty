<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';

if (method() !== 'POST') fail('Method not allowed.', 405);

$user    = requireRole();
$current = (string)(body()['currentPassword'] ?? '');
$new     = (string)(body()['newPassword'] ?? '');

if (strlen($new) < 8) fail('New password must be at least 8 characters.', 422);

$stmt = $pdo->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
$stmt->execute([$user['id']]);
$row = $stmt->fetch();
if (!$row) fail('Account not found.', 404);

if (!verifyPasswordAndUpgrade($pdo, $row, $current)) {
    fail('Your current password is incorrect.', 422);
}

$pdo->prepare('UPDATE users SET password = ? WHERE id = ?')
    ->execute([password_hash($new, PASSWORD_DEFAULT), $user['id']]);

ok(null, 'Password updated successfully.');
