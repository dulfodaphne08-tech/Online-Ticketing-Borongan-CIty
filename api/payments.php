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
        fail(
            'This driver account is not yet approved. Loading and terminal transactions are blocked.',
            403,
            ['approvalStatus' => $approval],
            'DRIVER_NOT_APPROVED'
        );
    }
    if (!isActive($driver['status'])) {
        fail('This driver account is inactive.', 403, null, 'INACTIVE');
    }
}

function currentStaffStationCode(PDO $pdo, array $actor): ?string {
    try {
        $stmt = $pdo->prepare(
            "SELECT t.code
             FROM public.staff_stations ss
             JOIN public.terminals t ON t.id::text = ss.station_id::text
             WHERE ss.staff_id = ?
             ORDER BY ss.assigned_at DESC
             LIMIT 1"
        );
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
        $stmt = $pdo->prepare(
            "SELECT lower(coalesce(status,'active'))
             FROM public.terminals
             WHERE code = ?
             LIMIT 1"
        );
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

    $fee     = getFee($pdo, (string)$driver['vehicle_type']);
    $balance = round((float)$driver['balance'], 2);

    $dupWindow = DUPLICATE_SCAN_SECONDS;
    $lowThresh = LOW_BALANCE_THRESHOLD;
    try {
        $s = $pdo->prepare("SELECT setting_key, setting_value FROM system_settings
                            WHERE setting_key IN ('duplicate_scan_seconds','low_balance_threshold')");
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
        WHERE driver_id = ? AND type = 'FEE'
          AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'
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
    $driverId  = trim((string)(body()['driverId'] ?? ''));
    $confirmed = !empty(body()['confirmDuplicate']);
    if ($driverId === '') fail('Scan a driver QR code first.', 422);

    $staffName   = $actor['fullName'] ?: $actor['username'];
    $stationCode = currentStaffStationCode($pdo, $actor);

    if (!staffStationIsActive($pdo, $stationCode)) {
        pushStaffNotification($pdo, [
            'staff_id'     => (string)$actor['id'],
            'station_code' => $stationCode,
            'type'         => 'station_inactive',
            'title'        => 'Station Unavailable',
            'message'      => "Your assigned station is inactive. Transaction processing is currently unavailable. Please contact the Administrator.",
        ]);
        fail('Your assigned station is inactive. Transaction processing is currently unavailable. Please contact the Administrator.', 403, null, 'STATION_INACTIVE');
    }

    try {
        $pdo->beginTransaction();

        $driver = findDriver($pdo, $driverId, true);
        if (!$driver) {
            $pdo->rollBack();
            pushStaffNotification($pdo, [
                'staff_id'     => (string)$actor['id'],
                'station_code' => $stationCode,
                'type'         => 'qr_invalid',
                'title'        => 'QR Validation Failed',
                'message'      => "The scanned QR code could not be verified. Please check the driver's QR code and try again.",
            ]);
            fail('No driver matches this QR code.', 404, null, 'NOT_FOUND');
        }

        assertDriverApproved($driver);

        $fee = getFee($pdo, (string)$driver['vehicle_type']);
        if ($fee <= 0) { $pdo->rollBack(); fail('No terminal fee is set for vehicle type "' . $driver['vehicle_type'] . '". Ask the admin to set it.', 422, null, 'NO_FEE'); }

        if (!$confirmed) {
            $dupWindow = DUPLICATE_SCAN_SECONDS;
            try {
                $s = $pdo->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'duplicate_scan_seconds'");
                $s->execute();
                $v = $s->fetchColumn();
                if ($v !== false && is_numeric($v)) $dupWindow = max(10, (int)$v);
            } catch (Throwable $e) { }

            $dup = $pdo->prepare("SELECT reference_number, created_at, amount FROM wallet_transactions
                WHERE driver_id = ? AND type = 'FEE'
                  AND upper(coalesce(status,'SUCCESSFUL')) = 'SUCCESSFUL'
                  AND created_at >= now() - make_interval(secs => ?)
                ORDER BY created_at DESC LIMIT 1");
            $dup->execute([$driver['driver_id'], $dupWindow]);
            $dupRow = $dup->fetch();
            if ($dupRow) {
                $pdo->rollBack();
                fail(
                    'This driver already paid within the last minute (' . $dupRow['reference_number'] . '). Charge again?',
                    409,
                    [
                        'reference'      => (string)$dupRow['reference_number'],
                        'previousTime'   => date(DATE_ATOM, strtotime((string)$dupRow['created_at'])),
                        'previousFee'    => round((float)$dupRow['amount'], 2),
                    ],
                    'DUPLICATE_SCAN'
                );
            }
        }

        $balance = round((float)$driver['balance'], 2);
        if (cents($balance) < cents($fee)) {
            $pdo->rollBack();
            pushStaffNotification($pdo, [
                'staff_id'     => (string)$actor['id'],
                'station_code' => $stationCode,
                'type'         => 'insufficient',
                'title'        => 'Insufficient Balance',
                'message'      => "Driver {$driver['full_name']} has insufficient balance. No fee was deducted. Please direct the driver to the Cashier.",
                'reference_id' => (string)$driver['driver_id'],
            ]);
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

        pushStaffNotification($pdo, [
            'staff_id'     => (string)$actor['id'],
            'station_code' => $stationCode,
            'type'         => 'transaction',
            'title'        => 'Transaction Successful',
            'message'      => "Driver {$driver['full_name']}'s transaction was completed. " . peso($fee) . " was deducted at " . ($stationCode ?? 'your station') . ".",
            'reference_id' => $ref,
        ]);

        $lowThreshold = LOW_BALANCE_THRESHOLD;
        try {
            $s = $pdo->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'low_balance_threshold'");
            $s->execute();
            $v = $s->fetchColumn();
            if ($v !== false && is_numeric($v)) $lowThreshold = (float)$v;
        } catch (Throwable $e) { }

        if ($newBalance < $lowThreshold) {
            pushStaffNotification($pdo, [
                'staff_id'     => (string)$actor['id'],
                'station_code' => $stationCode,
                'type'         => 'low_balance',
                'title'        => 'Low Driver Balance',
                'message'      => "Driver {$driver['full_name']} has a remaining balance of " . peso($newBalance) . ".",
                'reference_id' => (string)$driver['driver_id'],
            ]);
        }

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
    $receipt['feeType']    = 'Terminal Fee';

    $lowThresh = LOW_BALANCE_THRESHOLD;
    try {
        $s = $pdo->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'low_balance_threshold'");
        $s->execute();
        $v = $s->fetchColumn();
        if ($v !== false && is_numeric($v)) $lowThresh = (float)$v;
    } catch (Throwable $e) { }

    ok([
        'receipt'             => $receipt,
        'lowBalance'          => ($newBalance <= $lowThresh),
        'lowBalanceThreshold' => $lowThresh,
    ], 'Payment successful.');
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

    try {
        $pdo->beginTransaction();

        $driver = findDriver($pdo, $driverId, true);
        if (!$driver) { $pdo->rollBack(); fail('Driver not found.', 404, null, 'NOT_FOUND'); }

        assertDriverApproved($driver);

        $previous = round((float)$driver['balance'], 2);
        $new      = round($previous + $amount, 2);
        $ref      = newReference('LOAD');

        $ins = $pdo->prepare("INSERT INTO wallet_transactions
            (reference_number, or_number, driver_id, type, amount,
             previous_balance, balance_after, payment_method,
             processed_by, processed_by_name, status, created_at)
            VALUES (?, ?, ?, 'LOAD', ?, ?, ?, ?, ?, ?, 'SUCCESSFUL', now())
            RETURNING id, created_at");
        $ins->execute([
            $ref, $orNumber, $driverId, $amount,
            $previous, $new, $method_,
            $actor['id'], $cashierName
        ]);
        $row = $ins->fetch();

        $pdo->prepare("UPDATE drivers SET balance = ? WHERE driver_id = ?")
            ->execute([$new, $driverId]);

        addNotification($pdo, $driverId, 'Prepaid Load Successful',
            peso($amount) . ' loaded. New balance: ' . peso($new) . '. Ref: ' . $ref,
            'LOAD_SUCCESS');

        pushStaffNotification($pdo, [
            'staff_id'     => (string)$actor['id'],
            'station_code' => $stationCode,
            'type'         => 'transaction',
            'title'        => 'Prepaid Load Successful',
            'message'      => "Driver {$driver['full_name']} loaded " . peso($amount) . ". New balance: " . peso($new) . ".",
            'reference_id' => $ref,
        ]);

        auditLog('Processed Prepaid Load', 'LOAD', $ref,
            peso($amount) . ' to ' . $driver['full_name'] . ' · New balance ' . peso($new));

        $pdo->commit();

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
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('load process: ' . $e->getMessage());
        fail('The load could not be processed. No balance was added.', 500);
    }
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
        $formatted['bodyNumber']      = $row['body_number']      ?? null;
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