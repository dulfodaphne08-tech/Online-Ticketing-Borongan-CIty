<?php
 header('Content-Type: application/json; charset=utf-8');
http_response_code(410);
echo json_encode([
    'success' => false,
    'message' => 'This endpoint was replaced by api/drivers.php (vehicle details are stored on each driver).',
    'error'   => 'This endpoint was replaced by api/drivers.php (vehicle details are stored on each driver).',
    'data'    => null,
], JSON_UNESCAPED_SLASHES);
