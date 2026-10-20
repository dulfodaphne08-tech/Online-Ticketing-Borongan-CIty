<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

 $actor = requireRole('staff', 'admin', 'cashier');

if (method() === 'POST') {
    $data = body();
    $driverId = trim((string)($data['driverId'] ?? ''));
    $stationId = trim((string)($data['stationId'] ?? ''));
    $type = strtoupper(trim((string)($data['type'] ?? '')));

    if ($driverId === '' || $type === '') {
        fail('Driver ID and Movement Type (ENTRY/EXIT) are required.', 422);
    }

    try {
         $checkDriver = $pdo->prepare("SELECT driver_id, full_name, status FROM public.drivers WHERE driver_id = ? LIMIT 1");
        $checkDriver->execute([$driverId]);
        $driver = $checkDriver->fetch();

        if (!$driver) {
            fail('Driver ID not found in the system. Please verify the QR code.', 404, null, 'DRIVER_NOT_FOUND');
        }

        if (!isActive($driver['status'])) {
            fail('This driver account is inactive.', 403, null, 'INACTIVE_DRIVER');
        }

         $stmt = $pdo->prepare("
            INSERT INTO public.vehicle_movements (driver_id, station_id, movement_type, processed_by)
            VALUES (?, ?, ?, ?)
        ");
        $stmt->execute([
            $driverId,
            $stationId,
            $type,
            $actor['fullName'] ?: $actor['username']
        ]);

         auditLog('Logged Vehicle ' . $type, 'MOVEMENT', $driverId, "Driver {$driver['full_name']} logged as {$type}");

        ok([
            'driverName' => $driver['full_name'],
            'type' => $type,
            'timestamp' => date('Y-m-d H:i:s')
        ], "Successfully logged {$type} for {$driver['full_name']}.");

    } catch (Throwable $e) {
        error_log('movement log error: ' . $e->getMessage());
        fail('Could not log movement to Supabase: ' . $e->getMessage(), 500);
    }
}

 if (method() === 'GET' && ($_GET['action'] ?? '') === 'list') {
    try {
        $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
        
        $stmt = $pdo->query("
            SELECT m.*, d.full_name, d.vehicle_type, d.plate_number 
            FROM public.vehicle_movements m
            LEFT JOIN public.drivers d ON d.driver_id = m.driver_id
            ORDER BY m.created_at DESC 
            LIMIT {$limit}
        ");
        
        $movements = $stmt->fetchAll();
        ok(['movements' => $movements]);
    } catch (Throwable $e) {
        error_log('Fetch movements error: ' . $e->getMessage());
        fail('Could not fetch movements.', 500);
    }
}

fail('Method not allowed.', 405);