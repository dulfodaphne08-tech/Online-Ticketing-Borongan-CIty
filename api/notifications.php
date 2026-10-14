<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

function notifRow(array $r): array {
    return [
        'id'          => (string)($r['id'] ?? ''),
        'type'        => (string)($r['type'] ?? 'info'),
        'title'       => (string)($r['title'] ?? ''),
        'message'     => (string)($r['message'] ?? ''),
        'referenceId' => $r['reference_id'] ?? null,
        'stationCode' => $r['station_code'] ?? null,
        'createdAt'   => !empty($r['created_at'])
                            ? date(DATE_ATOM, strtotime((string)$r['created_at']))
                            : date(DATE_ATOM),
        'read'        => ((int)($r['is_read'] ?? 0)) === 1,
    ];
}

function currentStaffOrFail(PDO $pdo): array {
    $me = currentUser();
    if (!$me || !in_array($me['role'], ['staff', 'admin'], true)) {
        fail('Unauthorized.', 403);
    }
    $stationCode = null;
    if ($me['role'] === 'staff') {
        try {
            $s = $pdo->prepare('SELECT station_code FROM station_assignments WHERE staff_id = ? LIMIT 1');
            $s->execute([(string)$me['id']]);
            $row = $s->fetch();
            $stationCode = $row ? (string)$row['station_code'] : null;
        } catch (Throwable $e) {
            $stationCode = null;
        }
    }
    return ['user' => $me, 'stationCode' => $stationCode];
}

$action = $_GET['action'] ?? 'list';

if (method() === 'GET' && $action === 'list') {
    $ctx = currentStaffOrFail($pdo);
    $staffId = (string)$ctx['user']['id'];
    $role    = (string)$ctx['user']['role'];

    try {
        if ($role === 'admin') {
            $stmt = $pdo->prepare(
                'SELECT id, type, title, message, reference_id, station_code, created_at, is_read
                 FROM notifications
                 WHERE recipient_type = \'staff\' AND recipient_id = ?
                 ORDER BY created_at DESC
                 LIMIT 200'
            );
            $stmt->execute([$staffId]);
        } else {
            $stmt = $pdo->prepare(
                'SELECT id, type, title, message, reference_id, station_code, created_at, is_read
                 FROM notifications
                 WHERE recipient_type = \'staff\'
                   AND (recipient_id = ? OR (station_code IS NOT NULL AND station_code = ?))
                 ORDER BY created_at DESC
                 LIMIT 200'
            );
            $stmt->execute([$staffId, $ctx['stationCode']]);
        }
        $rows = $stmt->fetchAll();
        ok(['notifications' => array_map('notifRow', $rows)]);
    } catch (Throwable $e) {
        error_log('staff notif list failed: ' . $e->getMessage());
        fail('Could not load notifications.', 500);
    }
}

if (method() === 'PATCH' && $action === 'read') {
    $ctx = currentStaffOrFail($pdo);
    $staffId = (string)$ctx['user']['id'];
    $input = body();
    $id = trim((string)($input['id'] ?? ''));
    $markAll = !empty($input['markAll']);

    try {
        if ($markAll) {
            $stmt = $pdo->prepare(
                'UPDATE notifications SET is_read = 1
                 WHERE recipient_type = \'staff\' AND recipient_id = ?'
            );
            $stmt->execute([$staffId]);
            ok(['updated' => $stmt->rowCount()], 'All notifications marked as read.');
        }
        if ($id === '') fail('Missing notification id.', 422);
        $stmt = $pdo->prepare(
            'UPDATE notifications SET is_read = 1
             WHERE id = ? AND recipient_type = \'staff\' AND recipient_id = ?'
        );
        $stmt->execute([$id, $staffId]);
        ok(['updated' => $stmt->rowCount()], 'Marked as read.');
    } catch (Throwable $e) {
        error_log('staff notif read failed: ' . $e->getMessage());
        fail('Could not update notification.', 500);
    }
}

if (method() === 'POST' && $action === 'announce') {
    requireRole('admin');
    $input = body();
    $title     = trim((string)($input['title'] ?? ''));
    $message   = trim((string)($input['message'] ?? ''));
    $stationCode = isset($input['station_code']) ? trim((string)$input['station_code']) : null;

    if ($title === '' || $message === '') {
        fail('Title and message are required.', 422);
    }

    try {
        $stmt = $pdo->prepare(
            'INSERT INTO notifications
                (recipient_type, recipient_id, station_code, type, title, message, is_read)
             VALUES (\'staff\', NULL, ?, \'announcement\', ?, ?, 0)
             RETURNING id, type, title, message, reference_id, station_code, created_at, is_read'
        );
        $stmt->execute([$stationCode ?: null, $title, $message]);
        $row = $stmt->fetch();
        ok(['notification' => notifRow($row)], 'Announcement posted.');
    } catch (Throwable $e) {
        error_log('announce failed: ' . $e->getMessage());
        fail('Could not post announcement.', 500);
    }
}

fail('Method not allowed.', 405);