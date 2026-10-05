<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';

$user     = requireRole('driver');
$driverId = sessionDriverId($pdo, $user);

if (method() === 'GET') {
    $stmt = $pdo->prepare('SELECT id, title, message, type, is_read, created_at FROM notifications
                           WHERE driver_id = ? ORDER BY created_at DESC LIMIT 50');
    $stmt->execute([$driverId]);
    $list = array_map(fn($r) => [
        'id'        => (string)$r['id'],
        'title'     => (string)$r['title'],
        'message'   => (string)$r['message'],
        'type'      => (string)($r['type'] ?? ''),
        'read'      => in_array($r['is_read'], [true, 't', 'true', 1, '1'], true),
        'createdAt' => date(DATE_ATOM, strtotime((string)$r['created_at'])),
    ], $stmt->fetchAll());

    ok(['notifications' => $list, 'unread' => count(array_filter($list, fn($n) => !$n['read']))]);
}

if (method() === 'POST' || method() === 'PATCH') {
    if (!empty(body()['markAllRead'])) {
        $pdo->prepare('UPDATE notifications SET is_read = true WHERE driver_id = ?')->execute([$driverId]);
        ok(null, 'All notifications marked as read.');
    }
    $nid = trim((string)(body()['id'] ?? ''));
    if ($nid === '') fail('No notification selected.', 422);
    $pdo->prepare('UPDATE notifications SET is_read = true WHERE id::text = ? AND driver_id = ?')->execute([$nid, $driverId]);
    ok(null, 'Notification marked as read.');
}

fail('Method not allowed.', 405);
