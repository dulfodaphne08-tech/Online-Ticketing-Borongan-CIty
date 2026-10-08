<?php
 header('Content-Type: application/json; charset=utf-8');
http_response_code(410);
echo json_encode([
    'success' => false,
    'message' => 'This endpoint was replaced by api/drivers.php?me=1 (QR payload is built from the driver record).',
    'error'   => 'This endpoint was replaced by api/drivers.php?me=1 (QR payload is built from the driver record).',
    'data'    => null,
], JSON_UNESCAPED_SLASHES);
