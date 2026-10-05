<?php
 header('Content-Type: application/json; charset=utf-8');
http_response_code(410);
echo json_encode([
    'success' => false,
    'message' => 'This endpoint was replaced by api/wallet.php?action=history&type=LOAD.',
    'error'   => 'This endpoint was replaced by api/wallet.php?action=history&type=LOAD.',
    'data'    => null,
], JSON_UNESCAPED_SLASHES);
