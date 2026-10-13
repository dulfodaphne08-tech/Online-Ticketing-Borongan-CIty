<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

requireRole('admin', 'staff');

$stationId = trim((string)($_GET['stationId'] ?? ''));
$from      = trim((string)($_GET['from']      ?? ''));
$to        = trim((string)($_GET['to']        ?? ''));
$limit     = (int)($_GET['limit'] ?? 500);

if ($stationId === '') fail('Station ID is required.', 422);

try {
    try {
        $pdo->exec("ALTER TABLE public.wallet_transactions
                    ADD COLUMN IF NOT EXISTS station_id text");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_wt_station ON public.wallet_transactions(station_id)");
    } catch (Throwable $e) {
        error_log('station_transactions schema: ' . $e->getMessage());
    }

    $where  = ["wt.station_id = ?"];
    $params = [$stationId];

    if ($from !== '') { $where[] = "wt.created_at >= ?"; $params[] = $from . ' 00:00:00'; }
    if ($to   !== '') { $where[] = "wt.created_at <= ?"; $params[] = $to   . ' 23:59:59'; }

    $sql = "SELECT wt.id, wt.reference_number, wt.or_number, wt.type, wt.fee_type,
                   wt.driver_id, d.full_name AS driver_name, d.plate_number,
                   COALESCE(wt.vehicle_type, d.vehicle_type) AS vehicle_type,
                   wt.amount, wt.previous_balance, wt.balance_after,
                   wt.payment_method, wt.processed_by_name, wt.status, wt.created_at,
                   wt.station_id, t.code AS station_code, t.name AS station_name
            FROM public.wallet_transactions wt
            LEFT JOIN public.drivers   d ON d.driver_id = wt.driver_id
            LEFT JOIN public.terminals t ON t.id = wt.station_id
            WHERE " . implode(' AND ', $where) . "
            ORDER BY wt.created_at DESC
            LIMIT ?";

    $params[] = $limit;
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $totalFees = 0;
    $totalLoads = 0;
    $successCount = 0;
    $failedCount = 0;

    $list = array_map(function ($r) use (&$totalFees, &$totalLoads, &$successCount, &$failedCount) {
        $status = strtoupper((string)($r['status'] ?? 'SUCCESSFUL'));
        $isSuccess = $status === 'SUCCESSFUL';
        if ($isSuccess) $successCount++; else $failedCount++;

        $amt = (float)$r['amount'];
        if ($isSuccess && $r['type'] === 'FEE')  $totalFees  += $amt;
        if ($isSuccess && $r['type'] === 'LOAD') $totalLoads += $amt;

        return [
            'id'             => (string)$r['id'],
            'referenceNumber'=> (string)$r['reference_number'],
            'orNumber'       => $r['or_number'] ?? null,
            'type'           => (string)$r['type'],
            'driverId'       => (string)$r['driver_id'],
            'driverName'     => (string)($r['driver_name'] ?? ''),
            'plateNumber'    => (string)($r['plate_number'] ?? ''),
            'vehicleType'    => (string)($r['vehicle_type'] ?? ''),
            'amount'         => round($amt, 2),
            'previousBalance'=> round((float)$r['previous_balance'], 2),
            'balanceAfter'   => round((float)$r['balance_after'], 2),
            'paymentMethod'  => $r['payment_method'] ?? null,
            'processedBy'    => (string)($r['processed_by_name'] ?? ''),
            'status'         => $status,
            'stationId'      => (string)$r['station_id'],
            'stationCode'    => (string)($r['station_code'] ?? ''),
            'stationName'    => (string)($r['station_name'] ?? ''),
            'createdAt'      => (string)$r['created_at'],
            'date'           => date('Y-m-d', strtotime((string)$r['created_at'])),
            'time'           => date('g:i A', strtotime((string)$r['created_at'])),
        ];
    }, $rows);

    ok([
        'stationId'    => $stationId,
        'transactions' => $list,
        'summary' => [
            'totalCount'    => count($list),
            'successCount'  => $successCount,
            'failedCount'   => $failedCount,
            'totalFees'     => round($totalFees, 2),
            'totalLoads'    => round($totalLoads, 2),
        ],
    ]);
} catch (Throwable $e) {
    error_log('station_transactions: ' . $e->getMessage());
    fail('Could not load station transactions: ' . $e->getMessage(), 500);
}