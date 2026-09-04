<?php
// api/_lib.php
// Shared helpers for Scholacore's PHP API routes.
// Files prefixed with "_" are not exposed as routes by the Vercel PHP runtime —
// this file is only ever require'd by the actual endpoint scripts.

require_once __DIR__ . '/../vendor/autoload.php';

use Firebase\JWT\JWT;
use Firebase\JWT\JWK;

/** Send a JSON response and terminate the request. */
function send_json(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
    exit;
}

/** Apply CORS headers and short-circuit OPTIONS preflight requests. */
function handle_cors(): void
{
    $allowed = getenv('ALLOWED_ORIGIN') ?: '*';
    header("Access-Control-Allow-Origin: {$allowed}");
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

/** Decode the JSON request body into an associative array. */
function json_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/** Read the bearer token from the Authorization header, if present. */
function bearer_token(): ?string
{
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $auth = $headers['Authorization']
        ?? $headers['authorization']
        ?? ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/Bearer\s+(.+)/i', $auth, $matches)) {
        return trim($matches[1]);
    }
    return null;
}

/**
 * Verify a Firebase Authentication ID token without the Admin SDK by checking
 * its signature against Google's published public keys for Identity Platform.
 * Returns the decoded claims on success; throws on any failure.
 */
function verify_firebase_id_token(string $idToken): array
{
    $projectId = getenv('FIREBASE_PROJECT_ID');
    if (!$projectId) {
        throw new Exception('FIREBASE_PROJECT_ID is not configured');
    }

    $jwksUrl = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
    $cacheFile = sys_get_temp_dir() . '/scholacore_firebase_jwks.json';

    $jwksRaw = null;
    if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < 3600)) {
        $jwksRaw = file_get_contents($cacheFile);
    }
    if (!$jwksRaw) {
        $jwksRaw = @file_get_contents($jwksUrl);
        if ($jwksRaw === false) {
            throw new Exception('Unable to fetch Firebase public keys');
        }
        @file_put_contents($cacheFile, $jwksRaw);
    }

    $jwks = json_decode($jwksRaw, true);
    $keys = JWK::parseKeySet($jwks, 'RS256');

    $decoded = JWT::decode($idToken, $keys);
    $claims = (array) $decoded;

    if (($claims['aud'] ?? null) !== $projectId) {
        throw new Exception('Token audience mismatch');
    }
    if (($claims['iss'] ?? null) !== "https://securetoken.google.com/{$projectId}") {
        throw new Exception('Token issuer mismatch');
    }
    if (empty($claims['sub'])) {
        throw new Exception('Token missing subject');
    }

    return $claims;
}

/** Verify the request's bearer token and return the decoded claims, or send a 401. */
function require_auth(): array
{
    $token = bearer_token();
    if (!$token) {
        send_json(['error' => 'Missing Authorization header'], 401);
    }
    try {
        return verify_firebase_id_token($token);
    } catch (Exception $e) {
        send_json(['error' => 'Invalid or expired session: ' . $e->getMessage()], 401);
    }
}

/** Exchange a Google service-account key for a short-lived OAuth2 access token. */
function google_access_token(string $scope = 'https://www.googleapis.com/auth/datastore'): string
{
    $json = getenv('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!$json) {
        throw new Exception('GOOGLE_SERVICE_ACCOUNT_JSON is not configured');
    }
    $account = json_decode($json, true);
    if (!$account || empty($account['private_key']) || empty($account['client_email'])) {
        throw new Exception('Malformed GOOGLE_SERVICE_ACCOUNT_JSON');
    }

    $now = time();
    $assertion = JWT::encode([
        'iss' => $account['client_email'],
        'scope' => $scope,
        'aud' => 'https://oauth2.googleapis.com/token',
        'iat' => $now,
        'exp' => $now + 3600,
    ], $account['private_key'], 'RS256');

    $ch = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS => http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $assertion,
        ]),
    ]);
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode((string) $response, true);
    if ($status !== 200 || empty($data['access_token'])) {
        throw new Exception('Failed to obtain Google access token: ' . ($response ?: 'no response'));
    }
    return $data['access_token'];
}

/** PATCH a Firestore document via the REST API. $fields is a flat [name => scalar] map. */
function firestore_update_document(string $collection, string $docId, array $fields): void
{
    $projectId = getenv('FIREBASE_PROJECT_ID');
    $accessToken = google_access_token();

    $firestoreFields = [];
    $maskQuery = [];
    foreach ($fields as $key => $value) {
        $firestoreFields[$key] = to_firestore_value($value);
        $maskQuery[] = 'updateMask.fieldPaths=' . urlencode($key);
    }

    $url = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/"
        . "{$collection}/{$docId}?" . implode('&', $maskQuery);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => 'PATCH',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $accessToken,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode(['fields' => $firestoreFields]),
    ]);
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($status < 200 || $status >= 300) {
        throw new Exception('Firestore update failed: ' . $response);
    }
}

/** Convert a PHP scalar into a Firestore REST API typed value. */
function to_firestore_value($value): array
{
    if (is_bool($value)) {
        return ['booleanValue' => $value];
    }
    if (is_int($value)) {
        return ['integerValue' => (string) $value];
    }
    if (is_float($value)) {
        return ['doubleValue' => $value];
    }
    if ($value === null) {
        return ['nullValue' => null];
    }
    if ($value instanceof DateTimeInterface) {
        return ['timestampValue' => $value->format('Y-m-d\TH:i:s\Z')];
    }
    return ['stringValue' => (string) $value];
}
