<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

const DATA_FILE = __DIR__ . '/data.json';
const MIN_SETUP_SECRET_LENGTH = 32;
const MIN_TOKEN_LENGTH = 64;

$requestId = bin2hex(random_bytes(16));

function failRequest(int $status, string $code, string $message, string $requestId): never
{
    http_response_code($status);
    echo json_encode([
        'ok' => false,
        'code' => $code,
        'error' => $message,
        'requestId' => $requestId,
    ]);
    exit;
}

$secretFile = getenv('ISHIKU_SETUP_SECRET_FILE') ?: '/run/secrets/ishiku_setup_secret';
$secret = '';
if (is_readable($secretFile)) {
    $secret = trim((string) file_get_contents($secretFile));
}
if ($secret === '') {
    $secret = trim((string) (getenv('ISHIKU_SETUP_SECRET') ?: getenv('DV2_SHARED_SECRET') ?: ''));
}
$provided = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    failRequest(405, 'METHOD_NOT_ALLOWED', 'Request could not be processed.', $requestId);
}

if (strlen($secret) < MIN_SETUP_SECRET_LENGTH || !is_string($provided) || !hash_equals($secret, $provided)) {
    failRequest(403, 'AUTHORIZATION_FAILED', 'Request could not be authorized.', $requestId);
}

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 1024 * 1024) {
    failRequest(400, 'INVALID_REQUEST', 'Request could not be processed.', $requestId);
}

try {
    $payload = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
} catch (JsonException) {
    failRequest(400, 'INVALID_REQUEST', 'Request could not be processed.', $requestId);
}
$token = $payload['token'] ?? '';
if (!is_string($token) || strlen($token) < MIN_TOKEN_LENGTH || !preg_match('/^[A-Za-z0-9+\/=._:-]+$/', $token)) {
    failRequest(422, 'INVALID_TOKEN', 'Token is missing or invalid.', $requestId);
}

$out = json_encode([
    'token' => $token,
    'updated' => gmdate('c'),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

$tmp = tempnam(__DIR__, '.data.json.');
if ($tmp === false) {
    failRequest(500, 'WRITE_FAILED', 'Token could not be written.', $requestId);
}
if (file_put_contents($tmp, $out, LOCK_EX) === false || !rename($tmp, DATA_FILE)) {
    @unlink($tmp);
    failRequest(500, 'WRITE_FAILED', 'Token could not be written.', $requestId);
}

http_response_code(200);
echo json_encode(['ok' => true, 'updated' => gmdate('c')]);
