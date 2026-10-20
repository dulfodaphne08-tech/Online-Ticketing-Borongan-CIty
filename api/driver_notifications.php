<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

$user     = requireRole('driver');
$driverId = sessionDriverId($pdo, $user);

 if (method() === 'GET') {
    $list = [];

    try {
        $stmt = $pdo->prepare(
            'SELECT id, title, message, type, is_read, created_at
             FROM notifications
             WHERE driver_id = ?
             ORDER BY created_at DESC NULLS LAST
             LIMIT 50'
        );
        $stmt->execute([$driverId]);
        $rows = $stmt->fetchAll();

        $list = array_map(function ($r) {
            $ts = $r['created_at'] ? strtotime((string)$r['created_at']) : time();
            $isRead = $r['is_read'];
            $readBool = in_array($isRead, [true, 't', 'true', 1, '1', 'TRUE', 'T'], true);

            return [
                'id'        => (string)$r['id'],
                'title'     => (string)($r['title'] ?? ''),
                'message'   => (string)($r['message'] ?? ''),
                'type'      => (string)($r['type'] ?? ''),
                'read'      => $readBool,
                'createdAt' => date(DATE_ATOM, $ts),
            ];
        }, $rows);
    } catch (Throwable $e) {
         error_log('driver_notifications primary query failed: ' . $e->getMessage());
        try {
            $stmt = $pdo->prepare(
                'SELECT id, title, message, type, is_read, created_at
                 FROM notifications WHERE driver_id = ?
                 ORDER BY created_at DESC LIMIT 50'
            );
            $stmt->execute([$driverId]);
            $rows = $stmt->fetchAll();
            $list = array_map(function ($r) {
                $ts = $r['created_at'] ? strtotime((string)$r['created_at']) : time();
                $readBool = in_array($r['is_read'], [true, 't', 'true', 1, '1'], true);
                return [
                    'id'        => (string)$r['id'],
                    'title'     => (string)($r['title'] ?? ''),
                    'message'   => (string)($r['message'] ?? ''),
                    'type'      => (string)($r['type'] ?? ''),
                    'read'      => $readBool,
                    'createdAt' => date(DATE_ATOM, $ts),
                ];
            }, $rows);
        } catch (Throwable $e2) {
            error_log('driver_notifications fallback also failed: ' . $e2->getMessage());
             ok(['notifications' => [], 'unread' => 0, 'warning' => 'notifications unavailable']);
        }
    }

    $unread = count(array_filter($list, fn($n) => empty($n['read'])));

    ok(['notifications' => $list, 'unread' => $unread]);
}

 if (method() === 'POST' || method() === 'PATCH') {
    $b = body();

    if (!empty($b['markAllRead'])) {
        try {
            $pdo->prepare('UPDATE notifications SET is_read = true WHERE driver_id = ?')
                ->execute([$driverId]);
        } catch (Throwable $e) {
            error_log('markAllRead failed: ' . $e->getMessage());
        }
        ok(null, 'All notifications marked as read.');
    }

    $nid = trim((string)($b['id'] ?? ''));
    if ($nid === '') fail('No notification selected.', 422);

    try {
        $pdo->prepare('UPDATE notifications SET is_read = true WHERE id::text = ? AND driver_id = ?')
            ->execute([$nid, $driverId]);
    } catch (Throwable $e) {
        error_log('mark one failed: ' . $e->getMessage());
        fail('Could not mark notification as read.', 500);
    }
    ok(null, 'Notification marked as read.');
}

fail('Method not allowed.', 405);