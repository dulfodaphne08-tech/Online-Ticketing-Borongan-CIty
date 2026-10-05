<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';

if (method() !== 'POST') fail('Method not allowed.', 405);

$b         = body();
$username  = trim((string)($b['username'] ?? ''));
$licenseNo = trim((string)($b['licenseNo'] ?? ''));
$new       = (string)($b['newPassword'] ?? '');
$confirm   = (string)($b['confirmPassword'] ?? '');

if ($username === '' || $licenseNo === '') fail('Please enter your username and license number.', 422);
if (strlen($new) < 8) fail('Password must be at least 8 characters.', 422);
if ($new !== $confirm) fail('Passwords do not match.', 422);

$stmt = $pdo->prepare("
    SELECT u.id
    FROM users u
    JOIN drivers d ON d.user_id = u.id
    WHERE lower(u.username) = lower(:u)
      AND lower(u.role) = 'driver'
      AND upper(replace(d.license_no, ' ', '')) = upper(replace(:l, ' ', ''))
    LIMIT 1
");
$stmt->execute([':u' => $username, ':l' => $licenseNo]);
$userId = $stmt->fetchColumn();

 if (!$userId) fail('Username and license number do not match our records. Cashier, staff and admin accounts must be reset by the office.', 422);

$pdo->prepare('UPDATE users SET password = ? WHERE id = ?')
    ->execute([password_hash($new, PASSWORD_DEFAULT), $userId]);

ok(null, 'Password reset successfully. You can now log in.');
