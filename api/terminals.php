<?php
 
declare(strict_types=1);
require_once __DIR__ . '/config.php';

 function getDefaultTerminals(): array {
    return [
        [
            'id' => 'TRM-TS01',
            'code' => 'TS-01',
            'name' => 'Ticketing Station for Tricycles bound to Camada & Bugas',
            'latitude' => 11.606148,
            'longitude' => 125.428801,
            'address' => 'Borongan City Transport Terminal - Borongan Public Market',
            'operating_hours' => '5:00 AM - 8:00 PM',
            'capacity' => 60,
            'status' => 'Active',
            'assigned_staff_name' => 'Staff Roberto Cruz',
            'assigned_staff_role' => 'Tricycle Ticketer',
            'routes_covered' => 'Camada & Bugas Toda Lines',
            'today_collections' => 1450.00,
            'today_tickets' => 290,
            'active_drivers_count' => 42
        ],
        [
            'id' => 'TRM-TS02',
            'code' => 'TS-02',
            'name' => 'Ticketing Station for Short Ride Tricycles',
            'latitude' => 11.606264,
            'longitude' => 125.427693,
            'address' => 'Borongan City Transport Terminal - Borongan Public Market',
            'operating_hours' => '5:00 AM - 8:30 PM',
            'capacity' => 80,
            'status' => 'Active',
            'assigned_staff_name' => 'Cashier Juan Reyes',
            'assigned_staff_role' => 'Short Ride Ticketer',
            'routes_covered' => 'Poblacion, Market, Cathedral, ESSU (Short Ride)',
            'today_collections' => 980.00,
            'today_tickets' => 196,
            'active_drivers_count' => 35
        ],
        [
            'id' => 'TRM-RS01',
            'code' => 'RS-01',
            'name' => 'Ticket Receiving Station for Tricycles bound to Bugas',
            'latitude' => 11.627110,
            'longitude' => 125.446210,
            'address' => 'Brgy. Pepelitan, Borongan City Eastern Samar',
            'operating_hours' => '5:00 AM - 7:00 PM',
            'capacity' => 40,
            'status' => 'Active',
            'assigned_staff_name' => 'Officer Ramon Vega',
            'assigned_staff_role' => 'Ticket Inspector / Receiving',
            'routes_covered' => 'Bugas Route Verification Checkpoint',
            'today_collections' => 520.00,
            'today_tickets' => 104,
            'active_drivers_count' => 18
        ],
        [
            'id' => 'TRM-RS02',
            'code' => 'RS-02',
            'name' => 'Ticket Receiving Station for Jeep/Bus/Van leaving Borongan',
            'latitude' => 11.708800,
            'longitude' => 125.470541,
            'address' => 'Brgy. Bugas, Borongan City Eastern Samar',
            'operating_hours' => '4:00 AM - 9:00 PM',
            'capacity' => 100,
            'status' => 'Active',
            'assigned_staff_name' => 'Officer Carlos Diaz',
            'assigned_staff_role' => 'North Boundary Inspector',
            'routes_covered' => 'Northbound PUV (San Julian, Sulat, Taft, Oras, Arteche)',
            'today_collections' => 1820.00,
            'today_tickets' => 140,
            'active_drivers_count' => 28
        ],
        [
            'id' => 'TRM-RS03',
            'code' => 'RS-03',
            'name' => 'Ticket Receiving Station for Tricycles bound to Camada',
            'latitude' => 11.594917,
            'longitude' => 125.440078,
            'address' => 'Brgy. Can-abong, Borongan City Eastern Samar',
            'operating_hours' => '5:00 AM - 7:00 PM',
            'capacity' => 40,
            'status' => 'Active',
            'assigned_staff_name' => 'Officer Elena Gomez',
            'assigned_staff_role' => 'Ticket Inspector / Receiving',
            'routes_covered' => 'Camada Route Verification Checkpoint',
            'today_collections' => 480.00,
            'today_tickets' => 96,
            'active_drivers_count' => 16
        ],
        [
            'id' => 'TRM-RS04',
            'code' => 'RS-04',
            'name' => 'Ticket Receiving Station for Jeep/Bus/Van leaving Borongan',
            'latitude' => 11.540820,
            'longitude' => 125.459647,
            'address' => 'Brgy. Camada, Borongan City Eastern Samar',
            'operating_hours' => '4:00 AM - 9:00 PM',
            'capacity' => 100,
            'status' => 'Active',
            'assigned_staff_name' => 'Officer Dante Morales',
            'assigned_staff_role' => 'South Boundary Inspector',
            'routes_covered' => 'Southbound PUV (Maydolong, Balangkayan, Llorente, Hernani, Guiuan, Tacloban)',
            'today_collections' => 1640.00,
            'today_tickets' => 115,
            'active_drivers_count' => 24
        ],
        [
            'id' => 'TRM-TS03',
            'code' => 'TS-03',
            'name' => 'Ticketing Station for Jeep/Bus/Van',
            'latitude' => 11.605942,
            'longitude' => 125.428028,
            'address' => 'Borongan City Transport Terminal - Borongan Public Market',
            'operating_hours' => '4:00 AM - 9:00 PM',
            'capacity' => 150,
            'status' => 'Active',
            'assigned_staff_name' => 'Staff Maria Santos',
            'assigned_staff_role' => 'PUV Terminal Cashier',
            'routes_covered' => 'Inter-City & Provincial PUV / Bus Routes',
            'today_collections' => 2450.00,
            'today_tickets' => 310,
            'active_drivers_count' => 50
        ]
    ];
}

 function ensureTerminalsTable(PDO $pdo): void {
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS public.terminals (
            id                  text PRIMARY KEY,
            code                text NOT NULL,
            name                text NOT NULL,
            latitude            numeric(10,6) NOT NULL,
            longitude           numeric(10,6) NOT NULL,
            address             text,
            operating_hours     text DEFAULT '5:00 AM - 8:00 PM',
            capacity            integer DEFAULT 50,
            status              text DEFAULT 'Active',
            assigned_staff_name text,
            assigned_staff_role text,
            routes_covered      text,
            geojson_data        jsonb,
            created_at          timestamptz DEFAULT now(),
            updated_at          timestamptz DEFAULT now()
        )");

         $pdo->exec("DELETE FROM public.terminals WHERE id IN ('TRM-CENTRAL', 'TRM-REAL', 'TRM-MARKET', 'TRM-CAMPESAO', 'TRM-TABOC', 'TRM-BAYBAY')");

         $stmt = $pdo->prepare("INSERT INTO public.terminals
            (id, code, name, latitude, longitude, address, operating_hours, capacity, status, assigned_staff_name, assigned_staff_role, routes_covered)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
                code = EXCLUDED.code,
                name = EXCLUDED.name,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                address = EXCLUDED.address,
                operating_hours = EXCLUDED.operating_hours,
                capacity = EXCLUDED.capacity,
                routes_covered = EXCLUDED.routes_covered");
        foreach (getDefaultTerminals() as $t) {
            $stmt->execute([
                $t['id'], $t['code'], $t['name'], $t['latitude'], $t['longitude'],
                $t['address'], $t['operating_hours'], $t['capacity'], $t['status'],
                $t['assigned_staff_name'], $t['assigned_staff_role'], $t['routes_covered']
            ]);
        }
    } catch (Throwable $e) {
        error_log('terminals table init error: ' . $e->getMessage());
    }
}

 function getTerminalsList(PDO $pdo): array {
    ensureTerminalsTable($pdo);
    try {
        $rows = $pdo->query("SELECT * FROM public.terminals ORDER BY code ASC")->fetchAll();
        if ($rows && count($rows) > 0) {
             $today = todayStart();
            $terminals = [];
            foreach ($rows as $r) {
                $t = [
                    'id' => (string)$r['id'],
                    'code' => (string)$r['code'],
                    'name' => (string)$r['name'],
                    'latitude' => (float)$r['latitude'],
                    'longitude' => (float)$r['longitude'],
                    'address' => (string)($r['address'] ?? ''),
                    'operating_hours' => (string)($r['operating_hours'] ?? '5:00 AM - 8:00 PM'),
                    'capacity' => (int)($r['capacity'] ?? 50),
                    'status' => (string)($r['status'] ?? 'Active'),
                    'assigned_staff_name' => (string)($r['assigned_staff_name'] ?? 'Unassigned'),
                    'assigned_staff_role' => (string)($r['assigned_staff_role'] ?? 'Ticketer'),
                    'routes_covered' => (string)($r['routes_covered'] ?? 'Borongan City Lines'),
                    'geojson_data' => $r['geojson_data'] ? json_decode((string)$r['geojson_data'], true) : null,
                    'today_collections' => 0.00,
                    'today_tickets' => 0,
                    'active_drivers_count' => 0
                ];
                $terminals[] = $t;
            }
            return $terminals;
        }
    } catch (Throwable $e) {
        error_log('Error fetching terminals from DB: ' . $e->getMessage());
    }
    return getDefaultTerminals();
}

 function convertToGeoJSON(array $terminals): array {
    $features = [];
    foreach ($terminals as $t) {
        $features[] = [
            'type' => 'Feature',
            'geometry' => [
                'type' => 'Point',
                'coordinates' => [$t['longitude'], $t['latitude']]
            ],
            'properties' => [
                'id' => $t['id'],
                'code' => $t['code'],
                'name' => $t['name'],
                'address' => $t['address'],
                'status' => $t['status'],
                'capacity' => $t['capacity'],
                'assigned_staff' => $t['assigned_staff_name'],
                'assigned_role' => $t['assigned_staff_role'],
                'operating_hours' => $t['operating_hours'],
                'routes_covered' => $t['routes_covered'],
                'city' => 'Borongan City',
                'province' => 'Eastern Samar',
                'system' => 'Borongan City Transport Terminal (BCTT)'
            ]
        ];
    }
    return [
        'type' => 'FeatureCollection',
        'name' => 'Borongan_City_Transport_Terminals',
        'crs' => [
            'type' => 'name',
            'properties' => ['name' => 'urn:ogc:def:crs:OGC:1.3:CRS84']
        ],
        'features' => $features
    ];
}

$m = method();
$action = $_GET['action'] ?? '';

 if ($m === 'GET' && $action === 'staff_list') {
    requireRole('admin');
    try {
        $rows = $pdo->query(
            "SELECT id, full_name, username, role FROM public.users
             WHERE role IN ('staff','cashier') AND status = 'Active'
             ORDER BY role ASC, full_name ASC"
        )->fetchAll();
        $list = array_map(fn($r) => [
            'id'       => (string)$r['id'],
            'fullName' => (string)$r['full_name'],
            'username' => (string)$r['username'],
            'role'     => (string)$r['role'],
            'roleLabel'=> $r['role'] === 'cashier' ? 'Cashier' : 'Terminal Staff',
        ], $rows);
        ok(['staff' => $list]);
    } catch (Throwable $e) {
        error_log('staff_list error: ' . $e->getMessage());
        ok(['staff' => []]);
    }
}

 if ($m === 'GET') {
    $terminals = getTerminalsList($pdo);

     if (isset($_GET['export']) && $_GET['export'] === 'geojson') {
        $geojson = convertToGeoJSON($terminals);
        header('Content-Type: application/geo+json; charset=utf-8');
        header('Content-Disposition: attachment; filename="borongan_terminals_' . date('Ymd_His') . '.geojson"');
        echo json_encode($geojson, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        exit;
    }

    ok([
        'terminals' => $terminals,
        'cityCenter' => [
            'lat' => 11.6080,
            'lng' => 125.4316,
            'city' => 'Borongan City',
            'province' => 'Eastern Samar',
            'zoom' => 14
        ],
        'geojson' => convertToGeoJSON($terminals)
    ]);
}

 if ($m === 'POST') {
    requireRole('admin');
    ensureTerminalsTable($pdo);
    $data = body();

     if ($action === 'import_geojson') {
        $rawGeojson = $data['geojson'] ?? null;
        if (!$rawGeojson || !isset($rawGeojson['features']) || !is_array($rawGeojson['features'])) {
            fail('Invalid GeoJSON format. Please provide a standard GeoJSON FeatureCollection.', 422);
        }

        $imported = 0;
        $stmt = $pdo->prepare("INSERT INTO public.terminals
            (id, code, name, latitude, longitude, address, operating_hours, capacity, status, assigned_staff_name, assigned_staff_role, routes_covered, geojson_data, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, now())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                address = COALESCE(EXCLUDED.address, public.terminals.address),
                geojson_data = EXCLUDED.geojson_data,
                updated_at = now()");

        foreach ($rawGeojson['features'] as $index => $feat) {
            $geom = $feat['geometry'] ?? null;
            $props = $feat['properties'] ?? [];
            if (!$geom || !isset($geom['coordinates'])) continue;

            $coords = $geom['coordinates'];
            $lng = (float)($coords[0] ?? 125.4316);
            $lat = (float)($coords[1] ?? 11.6080);
            $id = (string)($props['id'] ?? ('TRM-QGIS-' . ($index + 1)));
            $code = (string)($props['code'] ?? ('QGIS-' . ($index + 1)));
            $name = (string)($props['name'] ?? ('Terminal ' . ($index + 1)));
            $addr = (string)($props['address'] ?? 'Borongan City');
            $hours = (string)($props['operating_hours'] ?? '5:00 AM - 8:00 PM');
            $cap = (int)($props['capacity'] ?? 50);
            $status = (string)($props['status'] ?? 'Active');
            $staff = (string)($props['assigned_staff'] ?? 'Unassigned');
            $role = (string)($props['assigned_role'] ?? 'Ticketer');
            $routes = (string)($props['routes_covered'] ?? 'Borongan TODA Route');

            $stmt->execute([
                $id, $code, $name, $lat, $lng, $addr, $hours, $cap, $status,
                $staff, $role, $routes, json_encode($feat)
            ]);
            $imported++;
        }

        auditLog('Imported QGIS GeoJSON', 'TERMINALS', null, "Imported $imported terminal features");
        ok(['imported' => $imported, 'terminals' => getTerminalsList($pdo)], "Successfully imported $imported terminals from QGIS GeoJSON!");
    }

     if ($action === 'delete') {
        $id = trim((string)($data['id'] ?? ''));
        if ($id === '') fail('Terminal ID is required.', 422);

        $del = $pdo->prepare("DELETE FROM public.terminals WHERE id = ?");
        $del->execute([$id]);

        auditLog('Deleted Terminal', 'TERMINALS', $id, "Deleted terminal $id");
        ok(['terminals' => getTerminalsList($pdo)], 'Terminal deleted successfully.');
    }

     $id = trim((string)($data['id'] ?? ''));
    $name = trim((string)($data['name'] ?? ''));
    $code = trim((string)($data['code'] ?? ''));
    $lat = (float)($data['latitude'] ?? 0);
    $lng = (float)($data['longitude'] ?? 0);
    $address = trim((string)($data['address'] ?? ''));
    $hours = trim((string)($data['operating_hours'] ?? '5:00 AM - 8:00 PM'));
    $capacity = (int)($data['capacity'] ?? 50);
    $status = trim((string)($data['status'] ?? 'Active'));
    $staff = trim((string)($data['assigned_staff_name'] ?? 'Unassigned'));
    $role = trim((string)($data['assigned_staff_role'] ?? 'Ticketer'));
    $routes = trim((string)($data['routes_covered'] ?? 'Borongan City Routes'));

    if ($name === '') fail('Terminal Name is required.', 422);
    if ($lat === 0.0 || $lng === 0.0) fail('Valid GPS Coordinates (Latitude & Longitude) are required.', 422);

    if ($id === '') {
        $id = 'TRM-' . strtoupper(substr(md5(uniqid('', true)), 0, 6));
    }
    if ($code === '') {
        $code = 'BCTT-' . rand(10, 99);
    }

    $save = $pdo->prepare("INSERT INTO public.terminals
        (id, code, name, latitude, longitude, address, operating_hours, capacity, status, assigned_staff_name, assigned_staff_role, routes_covered, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
        ON CONFLICT (id) DO UPDATE SET
            code = EXCLUDED.code,
            name = EXCLUDED.name,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            address = EXCLUDED.address,
            operating_hours = EXCLUDED.operating_hours,
            capacity = EXCLUDED.capacity,
            status = EXCLUDED.status,
            assigned_staff_name = EXCLUDED.assigned_staff_name,
            assigned_staff_role = EXCLUDED.assigned_staff_role,
            routes_covered = EXCLUDED.routes_covered,
            updated_at = now()");

    $save->execute([$id, $code, $name, $lat, $lng, $address, $hours, $capacity, $status, $staff, $role, $routes]);

    auditLog('Saved Terminal', 'TERMINALS', $id, "Saved terminal $name ($code)");
    ok(['terminal_id' => $id, 'terminals' => getTerminalsList($pdo)], 'Terminal saved successfully.');
}

fail('Method not allowed.', 405);
