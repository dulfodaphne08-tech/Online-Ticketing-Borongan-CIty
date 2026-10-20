<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

const DUPLICATE_SCAN_SECONDS = 60;
const LOW_BALANCE_THRESHOLD  = 50;

$actor  = requireRole(...STAFF_ROLES);
$action = (string)($_GET['action'] ?? body()['action'] ?? '');

function cents(float $v): int { return (int)round($v * 100); }

function assertDriverApproved(array $driver): void {
    $approval = strtoupper(trim((string)($driver['approval_status'] ?? 'Active')));
    if (in_array($approval, ['PENDING', 'NEEDS CORRECTION', 'INACTIVE'], true)) {
        fail('This driver account is not yet approved. Transactions are blocked.', 403, ['approvalStatus' => $approval], 'DRIVER_NOT_APPROVED');
    }
    if (!isActive($driver['status'])) {
        fail('This driver account is inactive.', 403, null, 'INACTIVE');
    }
}

function currentStaffStationCode(PDO $pdo, array $actor): ?string {
    try {
        $stmt = $pdo->prepare("SELECT t.code FROM public.staff_stations ss JOIN public.terminals t ON t.id::text = ss.station_id::text WHERE ss.staff_id = ? ORDER BY ss.assigned_at DESC LIMIT 1");
        $stmt->execute([(string)$actor['id']]);
        $code = $stmt->fetchColumn();
        return $code !== false ? (string)$code : null;
    } catch (Throwable $e) {
        error_log('currentStaffStationCode: ' . $e->getMessage());
        return null;
    }
}

function staffStationIsActive(PDO $pdo, ?string $stationCode): bool {
    if ($stationCode === null || $stationCode === '') return true;
    try {
        $stmt = $pdo->prepare("SELECT lower(coalesce(status,'active')) FROM public.terminals WHERE code = ? LIMIT 1");
        $stmt->execute([$stationCode]);
        $status = $stmt->fetchColumn();
        if ($status === false) return true;
        return (string)$status === 'active';
    } catch (Throwable $e) {
        error_log('staffStationIsActive: ' . $e->getMessage());
        return true;
    }
}

if (method() === 'GET' && $action === 'verify') {
    $driver = findDriver($pdo, (string)($_GET['driverId'] ?? ''));
    if (!$driver) {
        $stationCode = currentStaffStationCode($pdo, $actor);
        pushStaffNotification($pdo, [
            'staff_id'     => (string)$actor['id'],
            'station_code' => $stationCode,
            'type'         => 'qr_invalid',
            'title'        => 'QR Validation Failed',
            'message'      => "The scanned QR code could not be verified. Please check the driver's QR code and try again.",
        ]);
        fail('No driver matches this QR code.', 404, null, 'NOT_FOUND');
    }

    $stationCode = currentStaffStationCode($pdo, $actor);
    $isReceivingStation = (strpos((string)$stationCode, 'RS') === 0);

    if ($isReceivingStation) {
        $stmt = $pdo->prepare("SELECT reference_number, created_at FROM wallet_transactions 
                               WHERE driver_id = ? 
                               AND type = 'FEE' 
                               AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'
                               AND created_at >= CURRENT_DATE
                               ORDER BY created_at DESC LIMIT 1");
        $stmt->execute([$driver['driver_id']]);
        $existingTrip = $stmt->fetch();

        if ($existingTrip) {
            try {
                $pdo->prepare("INSERT INTO public.vehicle_movements (driver_id, station_id, movement_type, processed_by) VALUES (?, ?, 'EXIT', ?)")
                    ->execute([$driver['driver_id'], $stationCode, $actor['fullName'] ?: $actor['username']]);
            } catch (Throwable $e) { error_log('Movement Exit Error: ' . $e->getMessage()); }

            ok([
                'driver' => formatDriver($driver, 0), 
                'fee' => 0.00,
                'active' => isActive($driver['status']),
                'approved' => true,
                'isReceivingVerification' => true,
                'tripReference' => $existingTrip['reference_number'],
                'tripTime' => date(DATE_ATOM, strtotime((string)$existingTrip['created_at']))
            ]);
        } else {
            fail('Driver has not paid the terminal fee today. Please direct them to the Ticketing Station.', 402, null, 'UNPAID_TRIP');
        }
    }

    $fee     = getFee($pdo, (string)$driver['vehicle_type']);
    $balance = round((float)$driver['balance'], 2);

    $dupWindow = DUPLICATE_SCAN_SECONDS;
    $lowThresh = LOW_BALANCE_THRESHOLD;
    
    try {
        $s = $pdo->prepare("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('duplicate_scan_seconds','low_balance_threshold')");
        $s->execute();
        foreach ($s->fetchAll() as $row) {
            if ($row['setting_key'] === 'duplicate_scan_seconds' && is_numeric($row['setting_value'])) {
                $dupWindow = max(10, (int)$row['setting_value']);
            }
            if ($row['setting_key'] === 'low_balance_threshold' && is_numeric($row['setting_value'])) {
                $lowThresh = (float)$row['setting_value'];
            }
        }
    } catch (Throwable $e) { }

    $recent = $pdo->prepare("SELECT reference_number, created_at, amount FROM wallet_transactions
        WHERE driver_id = ? AND type = 'FEE' AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'
          AND created_at >= now() - make_interval(secs => ?)
        ORDER BY created_at DESC LIMIT 1");
    $recent->execute([$driver['driver_id'], $dupWindow]);
    $recentRow = $recent->fetch();

    $missing = [];
    if (trim((string)$driver['full_name'])    === '') $missing[] = 'driver name';
    if (trim((string)$driver['vehicle_type']) === '') $missing[] = 'vehicle type';
    if (trim((string)$driver['driver_id'])    === '') $missing[] = 'driver ID';

    $approvalStatus = strtoupper(trim((string)($driver['approval_status'] ?? 'Active')));
    $isApproved     = !in_array($approvalStatus, ['PENDING', 'NEEDS CORRECTION', 'INACTIVE'], true);

    ok([
        'driver'              => formatDriver($driver, $fee),
        'fee'                 => $fee,
        'feeType'             => 'Terminal Fee',
        'active'              => isActive($driver['status']),
        'approved'            => $isApproved,
        'approvalStatus'      => $approvalStatus,
        'sufficient'          => cents($balance) >= cents($fee),
        'balanceAfter'        => round($balance - $fee, 2),
        'lowBalanceThreshold' => $lowThresh,
        'duplicateWindow'     => $dupWindow,
        'missingInfo'         => $missing,
        'recentPayment'       => $recentRow ? [
            'reference' => (string)$recentRow['reference_number'],
            'amount'    => round((float)$recentRow['amount'], 2),
            'createdAt' => date(DATE_ATOM, strtotime((string)$recentRow['created_at'])),
        ] : null,
    ]);
}

if (method() === 'POST' && $action === 'collect') {
    $driverId     = trim((string)(body()['driverId'] ?? ''));
    $clientTxnId  = trim((string)(body()['clientTxnId'] ?? ''));
    $routeId      = trim((string)(body()['routeId'] ?? 'Default'));
    
    if ($driverId === '') fail('Scan a driver QR code first.', 422);
    if ($clientTxnId === '') fail('Transaction ID is missing. Please refresh the page.', 422);

    $staffName   = $actor['fullName'] ?: $actor['username'];
    $stationCode = currentStaffStationCode($pdo, $actor);

    if (!staffStationIsActive($pdo, $stationCode)) {
        pushStaffNotification($pdo, [
            'staff_id'     => (string)$actor['id'],
            'station_code' => $stationCode,
            'type'         => 'station_inactive',
            'title'        => 'Station Unavailable',
            'message'      => "Your assigned station is inactive.",
        ]);
        fail('Your assigned station is inactive.', 403, null, 'STATION_INACTIVE');
    }

    $driver = null; $fee = 0.0; $balance = 0.0; $newBalance = 0.0; $ref = ''; $row = null;

    try {
        $pdo->beginTransaction();

        $checkIdempotency = $pdo->prepare("SELECT * FROM wallet_transactions WHERE client_txn_id = ? LIMIT 1");
        $checkIdempotency->execute([$clientTxnId]);
        $existingTxn = $checkIdempotency->fetch(PDO::FETCH_ASSOC);
        
        if ($existingTxn) {
            $pdo->commit();
            $receipt = formatTransaction($existingTxn);
            $receipt['bodyNumber'] = $existingTxn['body_number'] ?? '';
            $receipt['feeType']    = 'Terminal Fee';
            $receipt['stationId']  = $existingTxn['station_id'];
            $receipt['stationName']= $existingTxn['station_id'];
            ok(['receipt' => $receipt, 'lowBalance' => false], 'Transaction already processed successfully.');
        }

        $lockStmt = $pdo->prepare("SELECT * FROM drivers WHERE driver_id = ? FOR UPDATE");
        $lockStmt->execute([$driverId]);
        $driver = $lockStmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$driver) {
            $pdo->rollBack();
            fail('No driver matches this QR code.', 404, null, 'NOT_FOUND');
        }

        assertDriverApproved($driver);

        $fee = getFee($pdo, (string)$driver['vehicle_type']);
        if ($fee <= 0) {
            $pdo->rollBack();
            fail('No terminal fee is set for vehicle type "' . $driver['vehicle_type'] . '".', 422, null, 'NO_FEE');
        }

        $balance = round((float)$driver['balance'], 2);
        if (cents($balance) < cents($fee)) {
            $pdo->rollBack();
            fail('Insufficient balance.', 402, [
                'balance' => $balance,
                'fee'     => $fee,
                'shortBy' => round($fee - $balance, 2),
            ], 'INSUFFICIENT_BALANCE');
        }

        $upd = $pdo->prepare('UPDATE drivers SET balance = balance - ? WHERE driver_id = ? RETURNING balance');
        $upd->execute([$fee, $driverId]);
        $newBalance = round((float)$upd->fetchColumn(), 2);

        $ref = newReference('TXN');

        $ins = $pdo->prepare("INSERT INTO wallet_transactions
            (reference_number, client_txn_id, driver_id, type, fee_type, vehicle_type,
             amount, previous_balance, balance_after,
             processed_by, processed_by_name, status, station_id, route_id, created_at)
            VALUES (?, ?, ?, 'FEE', 'Terminal Fee', ?,
                    ?, ?, ?,
                    ?, ?, 'SUCCESSFUL', ?, ?, now())
            RETURNING id, created_at");
        $ins->execute([
            $ref, $clientTxnId, $driverId, $driver['vehicle_type'],
            $fee, $balance, $newBalance,
            $actor['id'], $staffName, $stationCode, $routeId
        ]);
        $row = $ins->fetch();

        $pdo->commit();

        try {
            $pdo->prepare("INSERT INTO public.vehicle_movements (driver_id, station_id, movement_type, processed_by) VALUES (?, ?, 'ENTRY', ?)")
                ->execute([$driverId, $stationCode, $staffName]);
        } catch (Throwable $e) { error_log('Movement Entry Error: ' . $e->getMessage()); }

    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('fee collect: ' . $e->getMessage());
        fail('The payment could not be completed. Please try again.', 500);
    }

    try {
        addNotification($pdo, (string)$driver['driver_id'], 'Terminal Fee Paid',
            peso($fee) . ' terminal fee was deducted. Remaining balance: ' . peso($newBalance) . '. Ref: ' . $ref,
            'TRANSPORT_FEE');
    } catch (Throwable $e) { error_log('post-commit notif1: ' . $e->getMessage()); }

    $receipt = formatTransaction([
        'id' => $row['id'], 'reference_number' => $ref, 'type' => 'FEE',
        'fee_type' => 'Terminal Fee', 'driver_id' => $driverId, 'driver_name' => $driver['full_name'],
        'plate_number' => $driver['plate_number'], 'vehicle_type' => $driver['vehicle_type'],
        'body_number' => (string)($driver['body_number'] ?? ''), 'amount' => $fee,
        'previous_balance' => $balance, 'balance_after' => $newBalance,
        'processed_by_name' => $staffName, 'status' => 'SUCCESSFUL',
        'created_at' => $row['created_at'], 'station_id' => $stationCode,
    ]);
    $receipt['bodyNumber'] = (string)($driver['body_number'] ?? '');
    $receipt['feeType']    = 'Terminal Fee';
    $receipt['stationId']  = $stationCode;

    ok([
        'receipt'             => $receipt,
        'lowBalance'          => ($newBalance <= LOW_BALANCE_THRESHOLD),
        'lowBalanceThreshold' => LOW_BALANCE_THRESHOLD,
    ], 'Payment successful & Entry logged.');
}

if (method() === 'POST' && $action === 'load') {
    $role = strtolower((string)($actor['role'] ?? ''));
    if ($role === 'staff') {
        fail('Only cashiers and admins can process prepaid loads.', 403);
    }

    $data     = body();
    $driverId = trim((string)($data['driverId'] ?? ''));
    $amount   = (float)($data['amount'] ?? 0);
    $orNumber = trim((string)($data['orNumber'] ?? '')) ?: null;
    $method_  = trim((string)($data['paymentMethod'] ?? 'Cash')) ?: 'Cash';

    if ($driverId === '') fail('Driver ID is required.', 422);
    if ($amount <= 0) fail('Load amount must be greater than zero.', 422);
    if ($amount > 100000) fail('Load amount is too large.', 422);

    $cashierName = $actor['fullName'] ?: $actor['username'];
    $stationCode = currentStaffStationCode($pdo, $actor);

    $ref = '';
    $row = null;
    $driver = null;
    $previous = 0.0;
    $new = 0.0;

    try {
        $pdo->beginTransaction();

        $lockStmt = $pdo->prepare("SELECT * FROM drivers WHERE driver_id = ? FOR UPDATE");
        $lockStmt->execute([$driverId]);
        $driver = $lockStmt->fetch(PDO::FETCH_ASSOC);

        if (!$driver) { $pdo->rollBack(); fail('Driver not found.', 404, null, 'NOT_FOUND'); }

        assertDriverApproved($driver);

        $previous = round((float)$driver['balance'], 2);
        $new      = round($previous + $amount, 2);
        $ref      = newReference('LOAD');

        $ins = $pdo->prepare("INSERT INTO wallet_transactions
            (reference_number, or_number, driver_id, type, amount,
             previous_balance, balance_after, payment_method,
             processed_by, processed_by_name, status, station_id, created_at)
            VALUES (?, ?, ?, 'LOAD', ?, ?, ?, ?, ?, ?, 'SUCCESSFUL', ?, now())
            RETURNING id, created_at");
        $ins->execute([
            $ref, $orNumber, $driverId, $amount,
            $previous, $new, $method_,
            $actor['id'], $cashierName, $stationCode,
        ]);
        $row = $ins->fetch();

        $pdo->prepare("UPDATE drivers SET balance = ? WHERE driver_id = ?")
            ->execute([$new, $driverId]);

        $pdo->commit();

    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('load process: ' . $e->getMessage());
        fail('The load could not be processed. No balance was added.', 500);
    }

    try {
        addNotification($pdo, $driverId, 'Prepaid Load Successful',
            peso($amount) . ' loaded. New balance: ' . peso($new) . '. Ref: ' . $ref,
            'LOAD_SUCCESS');
    } catch (Throwable $e) { error_log('post-commit load notif1: ' . $e->getMessage()); }

    ok([
        'reference'       => $ref,
        'id'              => $row['id'],
        'amount'          => $amount,
        'previousBalance' => $previous,
        'balanceAfter'    => $new,
        'driverId'        => $driverId,
        'driverName'      => $driver['full_name'],
        'orNumber'        => $orNumber,
        'paymentMethod'   => $method_,
        'processedBy'     => $cashierName,
        'createdAt'       => $row['created_at'],
    ], 'Load processed successfully.', 201);
}

if (method() === 'GET' && $action === 'print') {
    requireRole('admin', 'cashier');

    $ref = trim((string)($_GET['reference'] ?? ''));
    if ($ref === '') fail('Reference number is required.', 422);

    $stmt = $pdo->prepare("SELECT
            wt.id, wt.reference_number, wt.or_number, wt.type, wt.fee_type,
            wt.driver_id, d.full_name AS driver_name,
            d.vehicle_type, d.body_number, d.plate_number,
            wt.amount, wt.previous_balance, wt.balance_after,
            wt.payment_method, wt.processed_by_name, wt.status, wt.created_at
        FROM wallet_transactions wt
        LEFT JOIN drivers d ON d.driver_id = wt.driver_id
        WHERE wt.reference_number = :ref
        LIMIT 1");
    $stmt->execute([':ref' => $ref]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) fail('Transaction not found.', 404);

    $ts = strtotime((string)$row['created_at']);

    ok(['load' => [
        'reference'       => (string)$row['reference_number'],
        'orNumber'        => $row['or_number'],
        'type'            => strtoupper((string)$row['type']),
        'feeType'         => $row['fee_type'],
        'driverId'        => (string)$row['driver_id'],
        'driverName'      => (string)($row['driver_name'] ?? '—'),
        'vehicleType'     => (string)($row['vehicle_type'] ?? '—'),
        'bodyNumber'      => (string)($row['body_number'] ?? '—'),
        'plateNumber'     => (string)($row['plate_number'] ?? '—'),
        'amount'          => (float)$row['amount'],
        'previousBalance' => $row['previous_balance'] !== null ? (float)$row['previous_balance'] : null,
        'balanceAfter'    => $row['balance_after']    !== null ? (float)$row['balance_after']    : null,
        'paymentMethod'   => (string)($row['payment_method'] ?? 'Cash'),
        'processedBy'     => (string)($row['processed_by_name'] ?? 'Cashier'),
        'status'          => strtoupper((string)$row['status']),
        'createdAt'       => $ts ? date(DATE_ATOM, $ts) : null,
        'date'            => $ts ? date('Y-m-d', $ts) : null,
        'time'            => $ts ? date('g:i A', $ts) : null,
    ]]);
}

if (method() === 'GET' && $action === 'list') {
    $type  = strtoupper((string)($_GET['type'] ?? 'ALL'));
    $from  = (string)($_GET['from'] ?? '');
    $to    = (string)($_GET['to'] ?? '');
    $q     = trim((string)($_GET['q'] ?? ''));
    $limit = max(1, min(1000, (int)($_GET['limit'] ?? 200)));

    $allTransactions = [];

    try {
         if (in_array($type, ['ALL', 'FEE', 'LOAD'], true)) {
            $where = [];
            $args  = [];
            
            if (in_array($type, ['FEE', 'LOAD'], true)) { $where[] = 'wt.type = ?'; $args[] = $type; }
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) { $where[] = 'wt.created_at >= ?::timestamptz'; $args[] = $from . ' 00:00:00+08:00'; }
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) { $where[] = 'wt.created_at < ?::timestamptz'; $args[] = (new DateTimeImmutable($to))->modify('+1 day')->format('Y-m-d') . ' 00:00:00+08:00'; }
            if ($q !== '') {
                $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
                $where[] = '(wt.reference_number ILIKE ? OR wt.driver_id ILIKE ? OR d.full_name ILIKE ? OR d.plate_number ILIKE ?)';
                array_push($args, $like, $like, $like, $like);
            }

            $sql = "SELECT wt.id, wt.reference_number, wt.client_txn_id, wt.or_number, wt.driver_id,
                           wt.type, wt.fee_type, COALESCE(wt.vehicle_type, d.vehicle_type) AS vehicle_type,
                           d.body_number, wt.amount, wt.previous_balance, wt.balance_after,
                           wt.payment_method, wt.processed_by, wt.processed_by_name, wt.status,
                           wt.station_id, wt.route_id, wt.created_at, d.full_name AS driver_name, d.plate_number
                    FROM wallet_transactions wt
                    LEFT JOIN drivers d ON d.driver_id = wt.driver_id"
                 . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
                 . " ORDER BY wt.created_at DESC LIMIT {$limit}";
                 
            $stmt = $pdo->prepare($sql);
            $stmt->execute($args);
            foreach ($stmt->fetchAll() as $row) {
                $formatted = formatTransaction($row);
                $formatted['referenceNumber'] = $row['reference_number'] ?? '';
                $formatted['clientTxnId']     = $row['client_txn_id'] ?? null;
                $allTransactions[] = $formatted;
            }
        }

         if (in_array($type, ['ALL', 'VERIFY'], true)) {
            $vmWhere = [];
            $vmArgs  = [];
            
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) { $vmWhere[] = 'vm.created_at >= ?::timestamptz'; $vmArgs[] = $from . ' 00:00:00+08:00'; }
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) { $vmWhere[] = 'vm.created_at < ?::timestamptz'; $vmArgs[] = (new DateTimeImmutable($to))->modify('+1 day')->format('Y-m-d') . ' 00:00:00+08:00'; }
            if ($q !== '') {
                $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
                $vmWhere[] = '(vm.driver_id ILIKE ? OR d.full_name ILIKE ? OR d.plate_number ILIKE ? OR vm.station_id ILIKE ?)';
                array_push($vmArgs, $like, $like, $like, $like);
            }

            $vmSql = "SELECT vm.id, vm.driver_id, vm.station_id, vm.movement_type, vm.processed_by, vm.created_at,
                             d.full_name AS driver_name, d.vehicle_type, d.plate_number, t.name AS station_name
                      FROM vehicle_movements vm
                      LEFT JOIN drivers d ON d.driver_id = vm.driver_id
                      LEFT JOIN terminals t ON t.code = vm.station_id"
                   . ($vmWhere ? ' WHERE ' . implode(' AND ', $vmWhere) : '')
                   . " ORDER BY vm.created_at DESC LIMIT {$limit}";
            
            $stmtVm = $pdo->prepare($vmSql);
            $stmtVm->execute($vmArgs);
            
            foreach ($stmtVm->fetchAll() as $row) {
                $ts = strtotime((string)$row['created_at']);
                $allTransactions[] = [
                    'id'              => 'VM-' . $row['id'],
                    'referenceNumber' => 'VM-' . str_pad((string)$row['id'], 6, '0', STR_PAD_LEFT),
                    'type'            => 'VERIFY', 
                    'movementType'    => strtoupper((string)$row['movement_type']), 
                    'driverId'        => (string)$row['driver_id'],
                    'driverName'      => (string)($row['driver_name'] ?? 'Unknown'),
                    'vehicleType'     => (string)($row['vehicle_type'] ?? '—'),
                    'plateNumber'     => (string)($row['plate_number'] ?? '—'),
                    'amount'          => 0.00, 
                    'status'          => 'SUCCESSFUL',
                    'processedBy'     => (string)($row['processed_by'] ?? 'System'),
                    'stationId'       => (string)$row['station_id'],
                    'stationName'     => (string)($row['station_name'] ?? $row['station_id']),
                    'createdAt'       => $ts ? date(DATE_ATOM, $ts) : null,
                    'date'            => $ts ? date('Y-m-d', $ts) : null,
                    'time'            => $ts ? date('g:i A', $ts) : null,
                ];
            }
        }

         usort($allTransactions, function($a, $b) {
            return strtotime((string)$b['createdAt']) - strtotime((string)$a['createdAt']);
        });

         $allTransactions = array_slice($allTransactions, 0, $limit);

    } catch (Throwable $e) {
        error_log('list failed: ' . $e->getMessage());
        fail('Could not load transactions: ' . $e->getMessage(), 500);
    }

    ok(['transactions' => $allTransactions]);
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
        WHERE created_at >= ?::timestamptz AND upper(coalesce(status, 'SUCCESSFUL')) = 'SUCCESSFUL'");
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

if (method() === 'GET' && $action === 'admin_overview') {
    requireRole('admin');

    $todayStart = todayStart();
    $yesterdayStart = date('Y-m-d 00:00:00+08:00', strtotime('-1 day'));
    $yesterdayEnd = date('Y-m-d 00:00:00+08:00');

    $stmt = $pdo->prepare("SELECT
            COALESCE(SUM(amount) FILTER (WHERE type = 'FEE' AND created_at >= ?::timestamptz AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'), 0) AS today_fees,
            COUNT(*) FILTER (WHERE type = 'FEE' AND created_at >= ?::timestamptz AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL') AS today_fee_count,
            COALESCE(SUM(amount) FILTER (WHERE type = 'FEE' AND created_at >= ?::timestamptz AND created_at < ?::timestamptz AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'), 0) AS yesterday_fees,
            COUNT(*) FILTER (WHERE type = 'FEE' AND created_at >= ?::timestamptz AND created_at < ?::timestamptz AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL') AS yesterday_fee_count,
            COALESCE(SUM(amount) FILTER (WHERE type = 'LOAD' AND created_at >= ?::timestamptz AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'), 0) AS today_loads,
            COUNT(*) FILTER (WHERE type = 'LOAD' AND created_at >= ?::timestamptz AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL') AS today_load_count
        FROM wallet_transactions
        WHERE upper(coalesce(status, 'SUCCESSFUL')) = 'SUCCESSFUL'");
    
    $stmt->execute([
        $todayStart, $todayStart,
        $yesterdayStart, $yesterdayEnd,
        $yesterdayStart, $yesterdayEnd,
        $todayStart, $todayStart
    ]);
    $txStats = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

    $driverStmt = $pdo->prepare("SELECT
            COUNT(*) FILTER (WHERE upper(coalesce(status,'ACTIVE')) = 'ACTIVE') AS active_drivers,
            COUNT(*) FILTER (WHERE upper(coalesce(approval_status,'ACTIVE')) = 'PENDING') AS pending_drivers,
            COUNT(*) FILTER (WHERE COALESCE(balance, 0) < ?) AS low_balance_drivers,
            COUNT(*) AS total_drivers
        FROM drivers");
    $driverStmt->execute([LOW_BALANCE_THRESHOLD]);
    $driverStats = $driverStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    $stationStmt = $pdo->prepare("SELECT
            COUNT(*) FILTER (WHERE lower(coalesce(status,'active')) = 'active') AS active_stations,
            COUNT(*) AS total_stations
        FROM terminals");
    $stationStmt->execute();
    $stationStats = $stationStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    $movementStmt = $pdo->prepare("SELECT
            COUNT(*) FILTER (WHERE movement_type = 'ENTRY' AND created_at >= ?::timestamptz) AS today_entries,
            COUNT(*) FILTER (WHERE movement_type = 'EXIT' AND created_at >= ?::timestamptz) AS today_exits
        FROM vehicle_movements");
    $movementStmt->execute([$todayStart, $todayStart]);
    $movementStats = $movementStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    $staffStmt = $pdo->prepare("SELECT
            COUNT(DISTINCT processed_by) FILTER (WHERE created_at >= ?::timestamptz AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL') AS active_staff_today
        FROM wallet_transactions");
    $staffStmt->execute([$todayStart]);
    $staffStats = $staffStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    ok([
        'today' => [
            'fees'      => round((float)($txStats['today_fees'] ?? 0), 2),
            'feeCount'  => (int)($txStats['today_fee_count'] ?? 0),
            'loads'     => round((float)($txStats['today_loads'] ?? 0), 2),
            'loadCount' => (int)($txStats['today_load_count'] ?? 0),
            'entries'   => (int)($movementStats['today_entries'] ?? 0),
            'exits'     => (int)($movementStats['today_exits'] ?? 0),
            'activeStaff' => (int)($staffStats['active_staff_today'] ?? 0),
        ],
        'yesterday' => [
            'fees'      => round((float)($txStats['yesterday_fees'] ?? 0), 2),
            'feeCount'  => (int)($txStats['yesterday_fee_count'] ?? 0),
        ],
        'drivers' => [
            'active'     => (int)($driverStats['active_drivers'] ?? 0),
            'pending'    => (int)($driverStats['pending_drivers'] ?? 0),
            'lowBalance' => (int)($driverStats['low_balance_drivers'] ?? 0),
            'total'      => (int)($driverStats['total_drivers'] ?? 0),
        ],
        'stations' => [
            'active' => (int)($stationStats['active_stations'] ?? 0),
            'total'  => (int)($stationStats['total_stations'] ?? 0),
        ],
        'movements' => [
            'entries' => (int)($movementStats['today_entries'] ?? 0),
            'exits'   => (int)($movementStats['today_exits'] ?? 0),
            'active'  => (int)($movementStats['today_entries'] ?? 0) - (int)($movementStats['today_exits'] ?? 0),
        ],
    ]);
}

if (method() === 'GET' && $action === 'station_activity') {
    requireRole('admin');

    $hours = max(1, min(168, (int)($_GET['hours'] ?? 24)));
    $since = date('Y-m-d H:i:s+08:00', strtotime("-{$hours} hours"));

    $stmt = $pdo->prepare("SELECT
            t.code,
            t.name,
            t.status,
            COALESCE(fee.fee_count, 0) AS fee_count,
            COALESCE(fee.fee_total, 0) AS fee_total,
            COALESCE(fee.staff_count, 0) AS fee_staff_count,
            fee.last_fee_activity,
            COALESCE(loads.load_count, 0) AS load_count,
            COALESCE(loads.load_total, 0) AS load_total,
            COALESCE(loads.load_staff_count, 0) AS load_staff_count,
            loads.last_load_activity
        FROM terminals t
        LEFT JOIN (
            SELECT station_id,
                   COUNT(*) AS fee_count,
                   COALESCE(SUM(amount), 0) AS fee_total,
                   COUNT(DISTINCT processed_by) AS staff_count,
                   MAX(created_at) AS last_fee_activity
            FROM wallet_transactions
            WHERE type = 'FEE'
              AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'
              AND created_at >= ?::timestamptz
            GROUP BY station_id
        ) fee ON fee.station_id = t.code
        LEFT JOIN (
            SELECT station_id,
                   COUNT(*) AS load_count,
                   COALESCE(SUM(amount), 0) AS load_total,
                   COUNT(DISTINCT processed_by) AS load_staff_count,
                   MAX(created_at) AS last_load_activity
            FROM wallet_transactions
            WHERE type = 'LOAD'
              AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'
              AND created_at >= ?::timestamptz
            GROUP BY station_id
        ) loads ON loads.station_id = t.code
        ORDER BY fee_total DESC, load_total DESC, t.code ASC");
    $stmt->execute([$since, $since]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stations = array_map(function ($r) {
         $lastFee = $r['last_fee_activity'] ? strtotime((string)$r['last_fee_activity']) : 0;
        $lastLoad = $r['last_load_activity'] ? strtotime((string)$r['last_load_activity']) : 0;
        $lastActivity = max($lastFee, $lastLoad);

        return [
            'code'           => (string)$r['code'],
            'name'           => (string)$r['name'],
            'status'         => strtolower((string)($r['status'] ?? 'active')),
            'feeCount'       => (int)$r['fee_count'],
            'feeTotal'       => round((float)$r['fee_total'], 2),
            'feeStaffCount'  => (int)$r['fee_staff_count'],
            'loadCount'      => (int)$r['load_count'],
            'loadTotal'      => round((float)$r['load_total'], 2),
            'loadStaffCount' => (int)$r['load_staff_count'],
            'lastActivity'   => $lastActivity ? date(DATE_ATOM, $lastActivity) : null,
        ];
    }, $rows);

    ok(['stations' => $stations, 'hours' => $hours]);
}

if (method() === 'GET' && $action === 'recent_movements') {
    requireRole('admin');

    $limit = max(1, min(200, (int)($_GET['limit'] ?? 50)));

    $stmt = $pdo->prepare("SELECT
            vm.id,
            vm.driver_id,
            vm.station_id,
            vm.movement_type,
            vm.processed_by,
            vm.created_at,
            d.full_name AS driver_name,
            d.vehicle_type,
            d.plate_number,
            t.name AS station_name
        FROM vehicle_movements vm
        LEFT JOIN drivers d ON d.driver_id = vm.driver_id
        LEFT JOIN terminals t ON t.code = vm.station_id
        ORDER BY vm.created_at DESC
        LIMIT ?");
    $stmt->execute([$limit]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $movements = array_map(function ($r) {
        return [
            'id'           => (int)$r['id'],
            'driverId'     => (string)$r['driver_id'],
            'driverName'   => (string)($r['driver_name'] ?? 'Unknown'),
            'vehicleType'  => (string)($r['vehicle_type'] ?? '—'),
            'plateNumber'  => (string)($r['plate_number'] ?? '—'),
            'stationCode'  => (string)$r['station_id'],
            'stationName'  => (string)($r['station_name'] ?? $r['station_id']),
            'movementType' => strtoupper((string)$r['movement_type']),
            'processedBy'  => (string)($r['processed_by'] ?? 'System'),
            'createdAt'    => date(DATE_ATOM, strtotime((string)$r['created_at'])),
        ];
    }, $rows);

    ok(['movements' => $movements]);
}

if (method() === 'GET' && $action === 'live_status') {
    requireRole('admin');

    $window = "15 minutes";

    $txStaff = $pdo->prepare("
        SELECT DISTINCT processed_by, processed_by_name, station_id, MAX(created_at) AS last_seen
        FROM wallet_transactions
        WHERE created_at >= now() - interval '{$window}'
          AND processed_by IS NOT NULL
        GROUP BY processed_by, processed_by_name, station_id
        ORDER BY last_seen DESC
    ");
    $txStaff->execute();
    $txStaffRows = $txStaff->fetchAll(PDO::FETCH_ASSOC);

    $vmStaff = $pdo->prepare("
        SELECT DISTINCT processed_by, station_id, MAX(created_at) AS last_seen
        FROM vehicle_movements
        WHERE created_at >= now() - interval '{$window}'
          AND processed_by IS NOT NULL
        GROUP BY processed_by, station_id
    ");
    $vmStaff->execute();
    $vmStaffRows = $vmStaff->fetchAll(PDO::FETCH_ASSOC);

    $merged = [];
    foreach ($txStaffRows as $r) {
        $key = (string)$r['processed_by'];
        if (!isset($merged[$key])) {
            $merged[$key] = [
                'id'       => $key,
                'name'     => (string)($r['processed_by_name'] ?? 'Staff'),
                'station'  => (string)($r['station_id'] ?? '—'),
                'lastSeen' => $r['last_seen'],
            ];
        } else {
            if (strtotime((string)$r['last_seen']) > strtotime((string)$merged[$key]['lastSeen'])) {
                $merged[$key]['lastSeen'] = $r['last_seen'];
                $merged[$key]['station']  = (string)($r['station_id'] ?? $merged[$key]['station']);
            }
        }
    }
    foreach ($vmStaffRows as $r) {
        $key = (string)$r['processed_by'];
        if (!isset($merged[$key])) {
            $merged[$key] = [
                'id'       => $key,
                'name'     => 'Staff',
                'station'  => (string)($r['station_id'] ?? '—'),
                'lastSeen' => $r['last_seen'],
            ];
        } elseif (strtotime((string)$r['last_seen']) > strtotime((string)$merged[$key]['lastSeen'])) {
            $merged[$key]['lastSeen'] = $r['last_seen'];
        }
    }

    $ids = array_keys($merged);
    if (!empty($ids)) {
        try {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $nameStmt = $pdo->prepare("SELECT id, full_name, username, role FROM users WHERE id::text IN ($placeholders)");
            $nameStmt->execute(array_map('strval', $ids));
            foreach ($nameStmt->fetchAll(PDO::FETCH_ASSOC) as $u) {
                $uid = (string)$u['id'];
                if (isset($merged[$uid])) {
                    $merged[$uid]['name'] = (string)($u['full_name'] ?: $u['username'] ?: $merged[$uid]['name']);
                }
            }
        } catch (Throwable $e) {
            error_log('live_status name lookup: ' . $e->getMessage());
        }
    }

    $staffList = array_values($merged);
    usort($staffList, fn($a, $b) => strtotime((string)$b['lastSeen']) - strtotime((string)$a['lastSeen']));

    $activeStations = [];
    foreach ($staffList as $s) {
        if (!empty($s['station']) && $s['station'] !== '—') {
            $activeStations[$s['station']] = true;
        }
    }

    $entryStmt = $pdo->prepare("SELECT COUNT(*) FROM vehicle_movements WHERE movement_type = 'ENTRY' AND created_at >= now() - interval '{$window}'");
    $entryStmt->execute();
    $recentEntries = (int)$entryStmt->fetchColumn();

    $exitStmt = $pdo->prepare("SELECT COUNT(*) FROM vehicle_movements WHERE movement_type = 'EXIT' AND created_at >= now() - interval '{$window}'");
    $exitStmt->execute();
    $recentExits = (int)$exitStmt->fetchColumn();

    $formattedStaff = array_map(function ($s) {
        return [
            'id'        => (string)$s['id'],
            'name'      => (string)$s['name'],
            'station'   => (string)$s['station'],
            'lastSeen'  => $s['lastSeen'] ? date(DATE_ATOM, strtotime((string)$s['lastSeen'])) : null,
        ];
    }, $staffList);

    ok([
        'onlineStaff'     => count($staffList),
        'activeStations'  => count($activeStations),
        'recentEntries'   => $recentEntries,
        'recentExits'     => $recentExits,
        'staffList'       => $formattedStaff,
    ]);
}

if (method() === 'GET' && $action === 'cashier_activity') {
    requireRole('admin');
    
    $todayStart = todayStart();
    
    $stmt = $pdo->prepare("SELECT 
            processed_by,
            processed_by_name,
            COUNT(*) as load_count,
            SUM(amount) as total_loaded,
            MAX(created_at) as last_active
        FROM wallet_transactions
        WHERE type = 'LOAD' 
          AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'
          AND created_at >= ?::timestamptz
        GROUP BY processed_by, processed_by_name
        ORDER BY total_loaded DESC");
    $stmt->execute([$todayStart]);
    
    $cashiers = array_map(function($r) {
        return [
            'id' => $r['processed_by'],
            'name' => $r['processed_by_name'] ?? 'Cashier',
            'loadCount' => (int)$r['load_count'],
            'totalLoaded' => round((float)$r['total_loaded'], 2),
            'lastActive' => date(DATE_ATOM, strtotime($r['last_active']))
        ];
    }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    
    ok(['cashiers' => $cashiers]);
}

if (method() === 'GET' && $action === 'station_activity') {
    requireRole('admin');

    $hours = max(1, min(168, (int)($_GET['hours'] ?? 24)));
    $since = date('Y-m-d H:i:s+08:00', strtotime("-{$hours} hours"));

    $stmt = $pdo->prepare("SELECT
            t.code,
            t.name,
            t.status,
            COALESCE(fee.fee_count, 0) AS fee_count,
            COALESCE(fee.fee_total, 0) AS fee_total,
            COALESCE(fee.staff_count, 0) AS fee_staff_count,
            fee.last_activity
        FROM terminals t
        LEFT JOIN (
            SELECT station_id,
                   COUNT(*) AS fee_count,
                   COALESCE(SUM(amount), 0) AS fee_total,
                   COUNT(DISTINCT processed_by) AS staff_count,
                   MAX(created_at) AS last_activity
            FROM wallet_transactions
            WHERE type = 'FEE'
              AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'
              AND created_at >= ?::timestamptz
            GROUP BY station_id
        ) fee ON fee.station_id = t.code
        ORDER BY fee_total DESC, t.code ASC");
    $stmt->execute([$since]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stations = array_map(function ($r) {
        return [
            'code'           => (string)$r['code'],
            'name'           => (string)$r['name'],
            'dbStatus'       => strtolower((string)($r['status'] ?? 'active')),
            'feeCount'       => (int)$r['fee_count'],
            'feeTotal'       => round((float)$r['fee_total'], 2),
            'feeStaffCount'  => (int)$r['fee_staff_count'],
            'lastActivity'   => $r['last_activity'] ? date(DATE_ATOM, strtotime((string)$r['last_activity'])) : null,
        ];
    }, $rows);

    ok(['stations' => $stations, 'hours' => $hours]);
}

if (method() === 'GET' && $action === 'recent_movements') {
    requireRole('admin');

    $limit = max(1, min(200, (int)($_GET['limit'] ?? 50)));

    $stmt = $pdo->prepare("SELECT
            vm.id,
            vm.driver_id,
            vm.station_id,
            vm.movement_type,
            vm.processed_by,
            vm.created_at,
            d.full_name AS driver_name,
            d.vehicle_type,
            d.plate_number,
            t.name AS station_name
        FROM vehicle_movements vm
        LEFT JOIN drivers d ON d.driver_id = vm.driver_id
        LEFT JOIN terminals t ON t.code = vm.station_id
        ORDER BY vm.created_at DESC
        LIMIT ?");
    $stmt->execute([$limit]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $movements = array_map(function ($r) {
        return [
            'id'           => (int)$r['id'],
            'driverId'     => (string)$r['driver_id'],
            'driverName'   => (string)($r['driver_name'] ?? 'Unknown'),
            'vehicleType'  => (string)($r['vehicle_type'] ?? '—'),
            'plateNumber'  => (string)($r['plate_number'] ?? '—'),
            'stationCode'  => (string)$r['station_id'],
            'stationName'  => (string)($r['station_name'] ?? $r['station_id']),
            'movementType' => strtoupper((string)$r['movement_type']),
            'processedBy'  => (string)($r['processed_by'] ?? 'System'),
            'createdAt'    => date(DATE_ATOM, strtotime((string)$r['created_at'])),
        ];
    }, $rows);

    ok(['movements' => $movements]);
}

if (method() === 'GET' && $action === 'live_status') {
    requireRole('admin');

    $stmt = $pdo->prepare("SELECT
            COUNT(DISTINCT wt.processed_by) FILTER (WHERE wt.created_at >= now() - interval '15 minutes') AS online_staff,
            COUNT(DISTINCT wt.station_id) FILTER (WHERE wt.created_at >= now() - interval '15 minutes') AS active_stations,
            COUNT(*) FILTER (WHERE vm.created_at >= now() - interval '15 minutes' AND vm.movement_type = 'ENTRY') AS recent_entries,
            COUNT(*) FILTER (WHERE vm.created_at >= now() - interval '15 minutes' AND vm.movement_type = 'EXIT') AS recent_exits
        FROM wallet_transactions wt
        LEFT JOIN vehicle_movements vm ON true");
    $stmt->execute();
    $live = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

    $staffStmt = $pdo->prepare("SELECT DISTINCT processed_by, processed_by_name, station_id, MAX(created_at) as last_seen
        FROM wallet_transactions
        WHERE created_at >= now() - interval '15 minutes'
        GROUP BY processed_by, processed_by_name, station_id
        ORDER BY last_seen DESC");
    $staffStmt->execute();
    $activeStaff = $staffStmt->fetchAll(PDO::FETCH_ASSOC);

    ok([
        'onlineStaff'     => (int)($live['online_staff'] ?? 0),
        'activeStations'  => (int)($live['active_stations'] ?? 0),
        'recentEntries'   => (int)($live['recent_entries'] ?? 0),
        'recentExits'     => (int)($live['recent_exits'] ?? 0),
        'staffList'       => array_map(function ($s) {
            return [
                'id'        => (string)($s['processed_by'] ?? ''),
                'name'      => (string)($s['processed_by_name'] ?? 'Staff'),
                'station'   => (string)($s['station_id'] ?? '—'),
                'lastSeen'  => $s['last_seen'] ? date(DATE_ATOM, strtotime((string)$s['last_seen'])) : null,
            ];
        }, $activeStaff),
    ]);
}

fail('Unknown request.', 400);