<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/driver_account.php';

if (method() === 'GET') {
    $field = trim((string)($_GET['check'] ?? ''));
    $value = trim((string)($_GET['value'] ?? ''));
    if ($field === '' || $value === '') ok(['available' => true]);

    try {
        $available = true;
        if ($field === 'username') {
            $stmt = $pdo->prepare('SELECT 1 FROM users WHERE lower(username) = lower(?) LIMIT 1');
            $stmt->execute([$value]);
            $available = !$stmt->fetchColumn();
        } elseif ($field === 'plateNumber') {
            $stmt = $pdo->prepare('SELECT 1 FROM drivers WHERE upper(plate_number) = upper(?) LIMIT 1');
            $stmt->execute([$value]);
            $available = !$stmt->fetchColumn();
        } elseif ($field === 'licenseNo') {
            $stmt = $pdo->prepare('SELECT 1 FROM drivers WHERE upper(license_no) = upper(?) LIMIT 1');
            $stmt->execute([$value]);
            $available = !$stmt->fetchColumn();
        }
        ok(['available' => $available]);
    } catch (Throwable $e) {
        error_log('register check failed: ' . $e->getMessage());
        ok(['available' => true]);
    }
}

if (method() === 'POST') {
    $input = body();

    error_log('register.php POST received: ' . json_encode([
        'fullName' => $input['fullName'] ?? null,
        'username' => $input['username'] ?? null,
        'hasPhoto' => !empty($input['photo']),
        'photoLen' => isset($input['photo']) ? strlen((string)$input['photo']) : 0,
    ]));

    try {
        $data = validateDriverInput($pdo, $input, true);
        $driverId = createDriverAccount($pdo, $data);

        auditLog('Registered Driver Account', 'DRIVER', $driverId,
                 'Self-registration: ' . ($data['full_name'] ?? ''));

        ok([
            'driverId' => $driverId,
            'message'  => 'Driver account created. Awaiting admin verification.',
        ], 'Registration successful.', 201);

    } catch (Throwable $e) {
        error_log('register.php failed: ' . $e->getMessage());
        error_log('register.php trace: ' . $e->getTraceAsString());
        fail('Registration failed: ' . $e->getMessage(), 500);
    }
}

fail('Method not allowed.', 405);