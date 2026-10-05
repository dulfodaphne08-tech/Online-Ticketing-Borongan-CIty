<?php
 declare(strict_types=1);
require_once __DIR__ . '/config.php';

function allFees(PDO $pdo): array {
    $fees = ['Tricycle' => 5.0, 'Jeepney' => 60.0, 'Multicab' => 60.0, 'Bus' => 100.0];
    foreach ($pdo->query('SELECT vehicle_type, amount FROM fees ORDER BY vehicle_type')->fetchAll() as $r) {
        $fees[(string)$r['vehicle_type']] = round((float)$r['amount'], 2);
    }
    return $fees;
}

if (method() === 'GET') {
    requireRole();
    ok(['fees' => allFees($pdo)]);
}

if (method() === 'POST') {
    requireRole('admin');
    $input = body();
    if (!$input) fail('No fee rates were sent.', 422);

    try {
        $pdo->beginTransaction();
        foreach ($input as $type => $amount) {
            $type = trim((string)$type);
            if ($type === '' || !is_numeric($amount) || (float)$amount < 0 || (float)$amount > 10000) {
                $pdo->rollBack();
                fail('Invalid fee for "' . $type . '". Enter an amount between ₱0 and ₱10,000.', 422);
            }
            $upd = $pdo->prepare('UPDATE fees SET amount = ?, updated_at = now() WHERE lower(vehicle_type) = lower(?)');
            $upd->execute([round((float)$amount, 2), $type]);
            if ($upd->rowCount() === 0) {
                $pdo->prepare('INSERT INTO fees (vehicle_type, amount) VALUES (?, ?)')->execute([$type, round((float)$amount, 2)]);
            }
        }

         auditLog('Updated Fee Rates', 'SETTINGS', null, json_encode($input));

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('fees save: ' . $e->getMessage());
        fail('Fee rates could not be saved.', 500);
    }
    ok(['fees' => allFees($pdo)], 'Fee rates saved.');
}

fail('Method not allowed.', 405);