<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

requireRole('admin');

function ensureStaffStations(PDO $pdo): void {
    try {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS public.staff_stations (
                id          serial PRIMARY KEY,
                staff_id    text NOT NULL,
                station_id  text NOT NULL,
                assigned_at timestamptz DEFAULT now(),
                UNIQUE (staff_id, station_id)
            )
        ");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_staff_stations_staff ON public.staff_stations(staff_id)");
    } catch (Throwable $e) {
        error_log('staff_stations init: ' . $e->getMessage());
    }
}

$action = $_GET['action'] ?? '';

 if (method() === 'GET') {
    ensureStaffStations($pdo);

    try {
        $staff = $pdo->query("
            SELECT id, full_name, username, role
            FROM public.users
            WHERE lower(role) IN ('staff','cashier')
              AND lower(coalesce(status,'active')) = 'active'
            ORDER BY role, full_name
        ")->fetchAll(PDO::FETCH_ASSOC);

        $stations = $pdo->query("
            SELECT id, code, name, address, status
            FROM public.terminals
            WHERE lower(coalesce(status,'active')) = 'active'
            ORDER BY code
        ")->fetchAll(PDO::FETCH_ASSOC);

        $assignments = $pdo->query("
            SELECT ss.id, ss.staff_id, ss.station_id, ss.assigned_at,
                   u.full_name AS staff_name, u.username, u.role,
                   t.code AS station_code, t.name AS station_name
            FROM public.staff_stations ss
            LEFT JOIN public.users u     ON u.id::text = ss.staff_id
            LEFT JOIN public.terminals t ON t.id = ss.station_id
            ORDER BY ss.assigned_at DESC
        ")->fetchAll(PDO::FETCH_ASSOC);

        ok([
            'staff'       => array_map(fn($r) => [
                'id'       => (string)$r['id'],
                'fullName' => (string)$r['full_name'],
                'username' => (string)$r['username'],
                'role'     => (string)$r['role'],
            ], $staff),
            'stations'    => array_map(fn($r) => [
                'id'      => (string)$r['id'],
                'code'    => (string)$r['code'],
                'name'    => (string)$r['name'],
                'address' => (string)($r['address'] ?? ''),
            ], $stations),
            'assignments' => array_map(fn($r) => [
                'id'           => (int)$r['id'],
                'staffId'      => (string)$r['staff_id'],
                'staffName'    => (string)($r['staff_name'] ?? 'Unknown'),
                'username'     => (string)($r['username'] ?? ''),
                'role'         => (string)($r['role'] ?? ''),
                'stationId'    => (string)$r['station_id'],
                'stationCode'  => (string)($r['station_code'] ?? '—'),
                'stationName'  => (string)($r['station_name'] ?? '—'),
                'assignedAt'   => (string)$r['assigned_at'],
            ], $assignments),
        ]);
    } catch (Throwable $e) {
        error_log('station_assignments list: ' . $e->getMessage());
        fail('Could not load station assignments.', 500);
    }
}

 if (method() === 'POST') {
    ensureStaffStations($pdo);
    $data      = body();
    $staffId   = trim((string)($data['staffId'] ?? ''));
    $stationId = trim((string)($data['stationId'] ?? ''));

    if ($staffId === '' || $stationId === '') {
        fail('Staff and Station are required.', 422);
    }

    try {
        $check = $pdo->prepare("SELECT id, full_name FROM public.users
                                WHERE id::text = ? AND lower(role) IN ('staff','cashier') LIMIT 1");
        $check->execute([$staffId]);
        $staffRow = $check->fetch(PDO::FETCH_ASSOC);
        if (!$staffRow) fail('Staff member not found.', 404);

        $checkSt = $pdo->prepare("SELECT id, code, name FROM public.terminals
                                  WHERE id = ? AND lower(coalesce(status,'active')) = 'active' LIMIT 1");
        $checkSt->execute([$stationId]);
        $stRow = $checkSt->fetch(PDO::FETCH_ASSOC);
        if (!$stRow) fail('Station not found or inactive.', 404);

        $pdo->prepare("
            INSERT INTO public.staff_stations (staff_id, station_id)
            VALUES (?, ?)
            ON CONFLICT (staff_id, station_id) DO NOTHING
        ")->execute([$staffId, $stationId]);

        auditLog('Assigned Staff to Station', 'STATION', $stationId,
                 "Assigned {$staffRow['full_name']} to {$stRow['code']}");

        ok(null, "{$staffRow['full_name']} assigned to {$stRow['code']}.");
    } catch (Throwable $e) {
        error_log('station_assignments assign: ' . $e->getMessage());
        fail('Could not assign staff.', 500);
    }
}

 if (method() === 'DELETE') {
    $id = trim((string)($_GET['id'] ?? ''));
    if ($id === '') {
        $data = body();
        $id = trim((string)($data['id'] ?? ''));
    }
    if ($id === '') fail('Assignment ID required.', 422);

    try {
        $pdo->prepare("DELETE FROM public.staff_stations WHERE id = ?")->execute([$id]);
        auditLog('Unassigned Staff from Station', 'STATION', $id, "Removed assignment");
        ok(null, 'Assignment removed.');
    } catch (Throwable $e) {
        error_log('station_assignments delete: ' . $e->getMessage());
        fail('Could not remove assignment.', 500);
    }
}

fail('Method not allowed.', 405);