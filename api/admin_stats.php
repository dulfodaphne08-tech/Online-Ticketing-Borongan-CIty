<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

requireRole('admin');

const ADMIN_LOW_BALANCE = 50;

 $d = $pdo->prepare("SELECT
        COUNT(*)                                                              AS total,
        COUNT(*) FILTER (WHERE upper(coalesce(status, 'ACTIVE')) = 'ACTIVE')  AS active,
        COUNT(*) FILTER (WHERE coalesce(plate_number, '') <> '')              AS vehicles,
        COUNT(*) FILTER (WHERE coalesce(plate_number, '') <> ''
                            AND upper(coalesce(status, 'ACTIVE')) = 'ACTIVE') AS active_vehicles,
        COUNT(*) FILTER (WHERE coalesce(balance, 0) < ?)                      AS low_balance,
        COUNT(*) FILTER (WHERE lower(coalesce(status, '')) = 'pending')       AS pending_drivers
    FROM drivers");
$d->execute([ADMIN_LOW_BALANCE]);
$drivers = $d->fetch(PDO::FETCH_ASSOC);

 $stationStats = ['total' => 0, 'active' => 0];
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS public.terminals (
        id text PRIMARY KEY, code text NOT NULL, name text NOT NULL,
        latitude numeric(10,6) NOT NULL, longitude numeric(10,6) NOT NULL,
        address text, operating_hours text, capacity integer,
        status text DEFAULT 'Active', assigned_staff_name text,
        assigned_staff_role text, routes_covered text, geojson_data jsonb,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    )");

    $s = $pdo->query("SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE lower(coalesce(status,'active')) = 'active') AS active
        FROM public.terminals")->fetch(PDO::FETCH_ASSOC);
    if ($s) {
        $stationStats['total']  = (int)$s['total'];
        $stationStats['active'] = (int)$s['active'];
    }
} catch (Throwable $e) {
    error_log('admin_stats stations: ' . $e->getMessage());
}

 $userStats = ['cashiers' => 0, 'staff' => 0, 'admins' => 0];
try {
    $u = $pdo->query("SELECT
            COUNT(*) FILTER (WHERE lower(role) = 'cashier'
                              AND lower(coalesce(status,'active')) = 'active') AS cashiers,
            COUNT(*) FILTER (WHERE lower(role) = 'staff'
                              AND lower(coalesce(status,'active')) = 'active') AS staff,
            COUNT(*) FILTER (WHERE lower(role) = 'admin'
                              AND lower(coalesce(status,'active')) = 'active') AS admins
        FROM public.users")->fetch(PDO::FETCH_ASSOC);
    if ($u) {
        $userStats['cashiers'] = (int)$u['cashiers'];
        $userStats['staff']    = (int)$u['staff'];
        $userStats['admins']   = (int)$u['admins'];
    }
} catch (Throwable $e) {
    error_log('admin_stats users: ' . $e->getMessage());
}

 $monthStart = (new DateTimeImmutable('first day of this month midnight'))->format(DATE_ATOM);
$t = $pdo->prepare("SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'FEE'  AND created_at >= :today), 0) AS today_fees,
        COUNT(*)              FILTER (WHERE type = 'FEE'  AND created_at >= :today)     AS today_fees_count,
        COALESCE(SUM(amount) FILTER (WHERE type = 'FEE'), 0)                            AS month_fees,
        COUNT(*)              FILTER (WHERE type = 'FEE')                               AS month_fees_count,
        COALESCE(SUM(amount) FILTER (WHERE type = 'LOAD' AND created_at >= :today), 0) AS today_loads,
        COUNT(*)              FILTER (WHERE type = 'LOAD' AND created_at >= :today)     AS today_loads_count,
        COUNT(DISTINCT driver_id) FILTER (WHERE type = 'FEE' AND created_at >= :today)  AS active_today
    FROM wallet_transactions
    WHERE created_at >= :month AND upper(coalesce(status, 'SUCCESSFUL')) = 'SUCCESSFUL'");
$t->execute([':today' => todayStart(), ':month' => $monthStart]);
$tx = $t->fetch(PDO::FETCH_ASSOC);

ok(['stats' => [
    'totalDrivers'        => (int)$drivers['total'],
    'activeDrivers'       => (int)$drivers['active'],
    'inactiveDrivers'     => (int)$drivers['total'] - (int)$drivers['active'],
    'pendingDrivers'      => (int)$drivers['pending_drivers'],
    'totalVehicles'       => (int)$drivers['vehicles'],
    'activeVehicles'      => (int)$drivers['active_vehicles'],
    'lowBalance'          => (int)$drivers['low_balance'],
    'lowBalanceThreshold' => ADMIN_LOW_BALANCE,
    'qrActive'            => (int)$drivers['active'],
    'totalStations'       => $stationStats['total'],
    'activeStations'      => $stationStats['active'],
    'activeCashiers'      => $userStats['cashiers'],
    'activeStaff'         => $userStats['staff'],
    'activeAdmins'        => $userStats['admins'],
    'todayFees'           => round((float)$tx['today_fees'], 2),
    'todayFeesCount'      => (int)$tx['today_fees_count'],
    'monthFees'           => round((float)$tx['month_fees'], 2),
    'monthFeesCount'      => (int)$tx['month_fees_count'],
    'todayLoads'          => round((float)$tx['today_loads'], 2),
    'todayLoadsCount'     => (int)$tx['today_loads_count'],
    'activeToday'         => (int)$tx['active_today'],
]]);