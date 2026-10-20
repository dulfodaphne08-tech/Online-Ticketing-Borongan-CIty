<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? '';

function ensureStaffStationsTable(PDO $pdo): void {
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
        error_log('staff_stations init error: ' . $e->getMessage());
    }
}

if (method() === 'GET' && $action === 'get-assigned') {
    $user = requireRole('staff', 'admin');
    ensureStaffStationsTable($pdo);

    try {
        $stmt = $pdo->prepare("
            SELECT t.id, t.code, t.name, t.address, t.status,
                   t.latitude, t.longitude, t.operating_hours,
                   t.routes_covered
            FROM public.staff_stations ss
            INNER JOIN public.terminals t ON t.id = ss.station_id
            WHERE ss.staff_id = ?
              AND lower(t.status) = 'active'
            LIMIT 1
        ");
        $stmt->execute([(string)$user['id']]);
        $station = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$station && normalizeRole((string)$user['role']) === 'admin') {
            $fallback = $pdo->query("
                SELECT id, code, name, address, status,
                       latitude, longitude, operating_hours,
                       routes_covered
                FROM public.terminals
                WHERE lower(status) = 'active'
                ORDER BY code ASC
                LIMIT 1
            ")->fetch(PDO::FETCH_ASSOC);
            if ($fallback) $station = $fallback;
        }

        if (!$station) {
            ok([
                'station' => null,
                'message' => 'No active station is assigned to your account. Please contact the Administrator.'
            ]);
        }

        $stats = ['todayTransactions' => 0, 'todayFees' => 0.0];
        try {
            try {
                $pdo->exec("ALTER TABLE public.wallet_transactions
                            ADD COLUMN IF NOT EXISTS station_id text");
            } catch (Throwable $e) {  }

            $q = $pdo->prepare("SELECT
                    COUNT(*) FILTER (WHERE type = 'FEE'
                                     AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL') AS txn_count,
                    COALESCE(SUM(amount) FILTER (WHERE type = 'FEE'
                                     AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'), 0) AS fees_total
                FROM public.wallet_transactions
                WHERE station_id = ?
                  AND created_at >= ?");
            $q->execute([(string)$station['id'], todayStart()]);
            $row = $q->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                $stats['todayTransactions'] = (int)$row['txn_count'];
                $stats['todayFees']         = round((float)$row['fees_total'], 2);
            }
        } catch (Throwable $e) {
            error_log('staff_station today stats: ' . $e->getMessage());
        }

         $roleName = match(normalizeRole((string)$user['role'])) {
            'admin'   => 'Administrator',
            'cashier' => 'Cashier',
            default   => 'Terminal Staff',
        };

        ok([
            'station' => [
                'id'                => (string)$station['id'],
                'code'              => (string)$station['code'],
                'name'              => (string)$station['name'],
                'address'           => (string)($station['address'] ?? 'Borongan City'),
                'status'            => (string)($station['status'] ?? 'Active'),
                'latitude'          => (float)$station['latitude'],
                'longitude'         => (float)$station['longitude'],
                 'operatingHours'    => '7:00 AM - 5:00 PM',
                'routesCovered'     => (string)($station['routes_covered'] ?? 'Borongan Lines'),
                 'assignedStaff'     => (string)($user['fullName'] ?: $user['username']),
                'assignedRole'      => $roleName,
                'todayTransactions' => $stats['todayTransactions'],
                'todayFees'         => $stats['todayFees'],
            ]
        ]);
    } catch (Throwable $e) {
        error_log('staff_station get-assigned: ' . $e->getMessage());
        fail('Could not load your station assignment.', 500);
    }
}

if (method() === 'POST' && $action === 'assign') {
    requireRole('admin');
    ensureStaffStationsTable($pdo);

    $data      = body();
    $staffId   = trim((string)($data['staffId']   ?? ''));
    $stationId = trim((string)($data['stationId'] ?? ''));

    if ($staffId === '' || $stationId === '') {
        fail('Staff ID and Station ID are required.', 422);
    }

    try {
        $pdo->prepare("
            INSERT INTO public.staff_stations (staff_id, station_id)
            VALUES (?, ?)
            ON CONFLICT (staff_id, station_id) DO NOTHING
        ")->execute([$staffId, $stationId]);

        auditLog('Assigned Staff to Station', 'STATION', $stationId,
                 "Assigned staff $staffId to station $stationId");

        ok(null, 'Staff assigned to station successfully.');
    } catch (Throwable $e) {
        error_log('staff_station assign: ' . $e->getMessage());
        fail('Could not assign staff to station.', 500);
    }
}

if (method() === 'DELETE' && $action === 'unassign') {
    requireRole('admin');

    $staffId   = trim((string)($_GET['staffId']   ?? ''));
    $stationId = trim((string)($_GET['stationId'] ?? ''));

    if ($staffId === '' || $stationId === '') {
        fail('Staff ID and Station ID are required.', 422);
    }

    try {
        $pdo->prepare("DELETE FROM public.staff_stations WHERE staff_id = ? AND station_id = ?")
            ->execute([$staffId, $stationId]);
        auditLog('Unassigned Staff from Station', 'STATION', $stationId, "Removed staff $staffId");
        ok(null, 'Assignment removed.');
    } catch (Throwable $e) {
        error_log('staff_station unassign: ' . $e->getMessage());
        fail('Could not remove assignment.', 500);
    }
}

fail('Unknown action.', 405);