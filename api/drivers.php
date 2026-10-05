<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/driver_account.php';

$id = trim((string)($_GET['id'] ?? ''));

 if (method() === 'GET' && isset($_GET['me'])) {
    $user   = requireRole('driver');
    $driver = findDriver($pdo, sessionDriverId($pdo, $user));
    if (!$driver) fail('Driver profile not found.', 404);

    $profile = formatDriver($driver, getFee($pdo, (string)$driver['vehicle_type']));
    $profile['qrPayload'] = json_encode([
        'version'     => 1,
        'driverId'    => $profile['driverId'],
        'plateNumber' => $profile['plateNumber'],
        'vehicleType' => $profile['vehicleType'],
    ], JSON_UNESCAPED_SLASHES);
    ok(['driver' => $profile]);
}

$admin = requireRole('admin');

 if (method() === 'GET') {
    if ($id !== '') {
        $driver = findDriver($pdo, $id);
        if (!$driver) fail('Driver not found.', 404);
        ok(['driver' => formatDriver($driver, getFee($pdo, (string)$driver['vehicle_type']))]);
    }

    $where = [];
    $args  = [];
    $q = trim((string)($_GET['q'] ?? ''));
    if ($q !== '') {
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
        $where[] = '(d.full_name ILIKE ? OR d.driver_id ILIKE ? OR d.plate_number ILIKE ?)';
        array_push($args, $like, $like, $like);
    }
    if (!empty($_GET['status'])) { $where[] = 'lower(d.status) = lower(?)'; $args[] = (string)$_GET['status']; }

    $stmt = $pdo->prepare('SELECT ' . DRIVER_COLUMNS . ' FROM drivers d LEFT JOIN users u ON u.id = d.user_id'
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY d.created_at DESC NULLS LAST, d.full_name');
    $stmt->execute($args);

    $fees = [];
    $drivers = array_map(function ($d) use ($pdo, &$fees) {
        $type = strtolower((string)$d['vehicle_type']);
        $fees[$type] ??= getFee($pdo, (string)$d['vehicle_type']);
        return formatDriver($d, $fees[$type]);
    }, $stmt->fetchAll());

    ok(['drivers' => $drivers]);
}

 if (method() === 'POST' && $id === '') {
    $data     = validateDriverInput($pdo, body(), true);
    $driverId = createDriverAccount($pdo, $data);

     auditLog('Added Driver', 'DRIVER', $driverId, 'Created ' . $data['full_name']);

    ok(['driverId' => $driverId], 'Driver ' . $data['full_name'] . ' added.', 201);
}

 if (method() === 'POST') {
    $driver = findDriver($pdo, $id);
    if (!$driver) fail('Driver not found.', 404);

    $data = validateDriverInput($pdo, body(), false, (string)$driver['driver_id']);
    $status = trim((string)(body()['status'] ?? ''));
    if (in_array($status, ['Active', 'Inactive', 'Pending'], true)) $data['status'] = $status;

    try {
        $pdo->beginTransaction();
        $sets = [];
        $vals = [];
        foreach ($data as $k => $v) { $sets[] = "$k = ?"; $vals[] = $v; }
        $vals[] = $driver['driver_id'];
        $pdo->prepare('UPDATE drivers SET ' . implode(', ', $sets) . ' WHERE driver_id = ?')->execute($vals);

        if ($driver['user_id']) {
            $pdo->prepare('UPDATE users SET full_name = ? WHERE id = ?')->execute([$data['full_name'], $driver['user_id']]);
            if (isset($data['status'])) {
                $pdo->prepare('UPDATE users SET status = ? WHERE id = ?')->execute([$data['status'], $driver['user_id']]);
            }
            $newPassword = (string)(body()['password'] ?? '');
            if ($newPassword !== '') {
                if (strlen($newPassword) < 8) { $pdo->rollBack(); fail('Password must be at least 8 characters.', 422); }
                $pdo->prepare('UPDATE users SET password = ? WHERE id = ?')
                    ->execute([password_hash($newPassword, PASSWORD_DEFAULT), $driver['user_id']]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('driver update: ' . $e->getMessage());
        fail('The driver could not be updated.', 500);
    }

     auditLog('Updated Driver Information', 'DRIVER', $driver['driver_id'], 'Updated ' . $data['full_name']);

    ok(null, 'Driver ' . $data['full_name'] . ' updated.');
}

 if (method() === 'DELETE') {
    $driver = findDriver($pdo, $id);
    if (!$driver) fail('Driver not found.', 404);
    $pdo->prepare("UPDATE drivers SET status = 'Inactive' WHERE driver_id = ?")->execute([$driver['driver_id']]);
    if ($driver['user_id']) {
        $pdo->prepare("UPDATE users SET status = 'Inactive' WHERE id = ?")->execute([$driver['user_id']]);
    }

     auditLog('Deactivated Driver', 'DRIVER', $driver['driver_id'], (string)$driver['full_name']);

    ok(null, 'Driver ' . $driver['full_name'] . ' deactivated.');
}

fail('Method not allowed.', 405);