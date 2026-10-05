<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';

const DUPLICATE_SCAN_SECONDS = 60;
const LOW_BALANCE_THRESHOLD  = 50;

$actor  = requireRole(...STAFF_ROLES);
$action = (string)($_GET['action'] ?? body()['action'] ?? '');

function cents(float $v): int { return (int)round($v * 100); }

 if (method() === 'GET' && $action === 'verify') {
    $driver = findDriver($pdo, (string)($_GET['driverId'] ?? ''));
    if (!$driver) fail('No driver matches this QR code.', 404, null, 'NOT_FOUND');

    $fee     = getFee($pdo, (string)$driver['vehicle_type']);
    $balance = round((float)$driver['balance'], 2);

    $recent = $pdo->prepare("SELECT reference_number, created_at FROM wallet_transactions
        WHERE driver_id = ? AND type = 'FEE' AND created_at >= now() - make_interval(secs => ?)
        ORDER BY created_at DESC LIMIT 1");
    $recent->execute([$driver['driver_id'], DUPLICATE_SCAN_SECONDS]);
    $recentRow = $recent->fetch();

    ok([
        'driver'        => formatDriver($driver, $fee),
        'fee'           => $fee,
        'feeType'       => 'Terminal Fee',
        'active'        => isActive($driver['status']),
        'sufficient'    => cents($balance) >= cents($fee),
        'balanceAfter'  => round($balance - $fee, 2),
        'recentPayment' => $recentRow ? [
            'reference' => $recentRow['reference_number'],
            'createdAt' => date(DATE_ATOM, strtotime((string)$recentRow['created_at'])),
        ] : null,
    ]);
}

 if (method() === 'POST' && $action === 'collect') {
    $driverId  = trim((string)(body()['driverId'] ?? ''));
    $confirmed = !empty(body()['confirmDuplicate']);
    if ($driverId === '') fail('Scan a driver QR code first.', 422);

    $staffName = $actor['fullName'] ?: $actor['username'];

    try {
        $pdo->beginTransaction();

        $driver = findDriver($pdo, $driverId, true);    
        if (!$driver) { $pdo->rollBack(); fail('No driver matches this QR code.', 404, null, 'NOT_FOUND'); }
        if (!isActive($driver['status'])) { $pdo->rollBack(); fail('This driver account is inactive. The fee cannot be collected.', 403, null, 'INACTIVE'); }

        $fee = getFee($pdo, (string)$driver['vehicle_type']);
        if ($fee <= 0) { $pdo->rollBack(); fail('No terminal fee is set for vehicle type "' . $driver['vehicle_type'] . '". Ask the admin to set it.', 422, null, 'NO_FEE'); }

         if (!$confirmed) {
            $dup = $pdo->prepare("SELECT reference_number FROM wallet_transactions
                WHERE driver_id = ? AND type = 'FEE' AND created_at >= now() - make_interval(secs => ?)
                ORDER BY created_at DESC LIMIT 1");
            $dup->execute([$driver['driver_id'], DUPLICATE_SCAN_SECONDS]);
            if ($ref = $dup->fetchColumn()) {
                $pdo->rollBack();
                fail('This driver already paid within the last minute (' . $ref . '). Charge again?', 409, ['reference' => $ref], 'DUPLICATE_SCAN');
            }
        }

        $balance = round((float)$driver['balance'], 2);
        if (cents($balance) < cents($fee)) {
            $pdo->rollBack();
            fail('Insufficient balance. ' . $driver['full_name'] . ' has ' . peso($balance) . ' but the fee is ' . peso($fee) . '.', 402, [
                'driver'  => formatDriver($driver, $fee),
                'balance' => $balance,
                'fee'     => $fee,
                'shortBy' => round($fee - $balance, 2),
            ], 'INSUFFICIENT_BALANCE');
        }

        $upd = $pdo->prepare('UPDATE drivers SET balance = balance - ? WHERE driver_id = ? RETURNING balance');
        $upd->execute([$fee, $driver['driver_id']]);
        $newBalance = round((float)$upd->fetchColumn(), 2);

        $ref = newReference('TXN');
        $ins = $pdo->prepare("INSERT INTO wallet_transactions
            (reference_number, driver_id, type, fee_type, vehicle_type, amount, previous_balance, balance_after,
             processed_by, processed_by_name, status)
            VALUES (?, ?, 'FEE', 'Terminal Fee', ?, ?, ?, ?, ?, ?, 'SUCCESSFUL')
            RETURNING id, created_at");
        $ins->execute([$ref, $driver['driver_id'], $driver['vehicle_type'], $fee, $balance, $newBalance,
                       $actor['id'], $staffName]);
        $row = $ins->fetch();

        addNotification($pdo, (string)$driver['driver_id'], 'Terminal Fee Paid',
            peso($fee) . ' terminal fee was deducted. Remaining balance: ' . peso($newBalance) . '. Ref: ' . $ref,
            'TRANSPORT_FEE');

         auditLog('Processed Terminal Fee', 'TRANSACTION', $ref,
            peso($fee) . ' from ' . $driver['full_name']);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('fee collect: ' . $e->getMessage());
        fail('The payment could not be completed. No money was deducted. Please try again.', 500);
    }

    $receipt = formatTransaction([
        'id' => $row['id'], 'reference_number' => $ref, 'type' => 'FEE', 'fee_type' => 'Terminal Fee',
        'driver_id' => $driver['driver_id'], 'driver_name' => $driver['full_name'],
        'plate_number' => $driver['plate_number'], 'vehicle_type' => $driver['vehicle_type'],
        'amount' => $fee, 'previous_balance' => $balance, 'balance_after' => $newBalance,
        'processed_by_name' => $staffName, 'status' => 'SUCCESSFUL', 'created_at' => $row['created_at'],
    ]);
    $receipt['bodyNumber'] = (string)($driver['body_number'] ?? '');

    ok(['receipt' => $receipt], 'Payment successful.');
}

 if (method() === 'GET' && $action === 'list') {
    $type  = strtoupper((string)($_GET['type'] ?? 'ALL'));
    $from  = (string)($_GET['from'] ?? '');
    $to    = (string)($_GET['to'] ?? '');
    $q     = trim((string)($_GET['q'] ?? ''));
    $limit = max(1, min(1000, (int)($_GET['limit'] ?? 200)));

    $where = [];
    $args  = [];
    if (in_array($type, ['LOAD', 'FEE'], true)) { $where[] = 'wt.type = ?'; $args[] = $type; }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
        $where[] = 'wt.created_at >= ?';
        $args[]  = (new DateTimeImmutable($from))->format(DATE_ATOM);
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        $where[] = 'wt.created_at < ?';
        $args[]  = (new DateTimeImmutable($to))->modify('+1 day')->format(DATE_ATOM);
    }
    if ($q !== '') {
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
        $where[] = '(wt.reference_number ILIKE ? OR wt.or_number ILIKE ? OR wt.driver_id ILIKE ? OR d.full_name ILIKE ? OR d.plate_number ILIKE ?)';
        array_push($args, $like, $like, $like, $like, $like);
    }

     $sql = "SELECT
                wt.id,
                wt.reference_number,
                wt.or_number,
                wt.driver_id,
                wt.type,
                wt.fee_type,
                wt.vehicle_type,
                wt.amount,
                wt.previous_balance,
                wt.balance_after,
                wt.payment_method,
                wt.processed_by,
                wt.processed_by_name,
                wt.status,
                wt.created_at,
                d.full_name      AS driver_name,
                d.plate_number   AS plate_number,
                d.body_number    AS body_number
            FROM wallet_transactions wt
            LEFT JOIN drivers d ON d.driver_id = wt.driver_id"
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . " ORDER BY wt.created_at DESC LIMIT {$limit}";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($args);
     $rows = array_map(function (array $row): array {
        $formatted = formatTransaction($row);
         $formatted['referenceNumber'] = $row['reference_number'] ?? '';
        $formatted['orNumber']        = $row['or_number']        ?? null;
        return $formatted;
    }, $stmt->fetchAll());

    ok(['transactions' => $rows]);
}

 if (method() === 'GET' && $action === 'stats') {
    $stmt = $pdo->prepare("SELECT
            COALESCE(SUM(amount) FILTER (WHERE type = 'FEE'), 0)  AS fees_total,
            COUNT(*)              FILTER (WHERE type = 'FEE')     AS fees_count,
            COALESCE(SUM(amount) FILTER (WHERE type = 'LOAD'), 0) AS loads_total,
            COUNT(*)              FILTER (WHERE type = 'LOAD')    AS loads_count,
            COUNT(DISTINCT driver_id)                             AS drivers_served,
            COUNT(*) FILTER (WHERE processed_by_name = ?)         AS mine_count
        FROM wallet_transactions
        WHERE created_at >= ? AND upper(coalesce(status, 'SUCCESSFUL')) = 'SUCCESSFUL'");
    $stmt->execute([$actor['fullName'] ?: $actor['username'], todayStart()]);
    $s = $stmt->fetch() ?: [];

    $low = $pdo->prepare('SELECT COUNT(*) FROM drivers WHERE COALESCE(balance, 0) < ?');
    $low->execute([LOW_BALANCE_THRESHOLD]);

    ok(['stats' => [
        'feesToday'          => round((float)($s['fees_total'] ?? 0), 2),
        'feesCountToday'     => (int)($s['fees_count'] ?? 0),
        'loadsToday'         => round((float)($s['loads_total'] ?? 0), 2),
        'loadsCountToday'    => (int)($s['loads_count'] ?? 0),
        'driversServedToday' => (int)($s['drivers_served'] ?? 0),
        'myTransactionsToday'=> (int)($s['mine_count'] ?? 0),
        'lowBalanceDrivers'  => (int)$low->fetchColumn(),
        'lowBalanceThreshold'=> LOW_BALANCE_THRESHOLD,
    ]]);
}

fail('Unknown request.', 400);