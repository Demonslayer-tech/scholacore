<?php

require_once __DIR__ . '/_lib/FirebaseAdmin.php';
require_once __DIR__ . '/_lib/LiveKitAuth.php';

use Kreait\Firebase\Factory;
use Google\Cloud\Firestore\FieldValue;

header('Content-Type: application/json');

function jsonResponse(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

function snapshotData($snapshot): array
{
    return $snapshot->exists() ? $snapshot->data() : [];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    jsonResponse(405, ['error' => 'Method not allowed']);
}

$apiKey = getenv('LIVEKIT_API_KEY');
$apiSecret = getenv('LIVEKIT_API_SECRET');
$wsUrl = getenv('LIVEKIT_WS_URL');
if (!$apiKey || !$apiSecret || !$wsUrl) {
    error_log('[livekit-egress] Missing LiveKit env vars');
    jsonResponse(500, ['error' => 'Live classroom is not configured yet']);
}
// LiveKit's HTTP/Egress API lives on the same host as the WebSocket URL.
$httpHost = preg_replace('/^wss:/', 'https:', preg_replace('/^ws:/', 'http:', $wsUrl));

$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    jsonResponse(401, ['error' => 'Missing bearer token']);
}

try {
    $raw = getenv('FIREBASE_SERVICE_ACCOUNT_KEY');
    $serviceAccount = json_decode($raw, true);
    $auth = (new Factory())->withServiceAccount($serviceAccount)->createAuth();
    $verifiedIdToken = $auth->verifyIdToken($m[1]);
    $uid = $verifiedIdToken->claims()->get('sub');
} catch (Throwable $e) {
    error_log('[livekit-egress] Invalid ID token: ' . $e->getMessage());
    jsonResponse(401, ['error' => 'Invalid or expired session, please log in again']);
}

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$scheduleId = trim((string) ($body['scheduleId'] ?? ''));
$action = $body['action'] ?? '';
if ($scheduleId === '' || !in_array($action, ['start', 'stop'], true)) {
    jsonResponse(400, ['error' => 'Missing scheduleId or invalid action']);
}

try {
    $db = getAdminFirestore()->database();
} catch (Throwable $e) {
    error_log('[livekit-egress] Firestore init failed: ' . $e->getMessage());
    jsonResponse(500, ['error' => 'Server misconfigured']);
}

$userData = snapshotData($db->collection('users')->document($uid)->snapshot());
$scheduleRef = $db->collection('schedules')->document($scheduleId);
$scheduleData = snapshotData($scheduleRef->snapshot());
if (empty($scheduleData)) {
    jsonResponse(404, ['error' => 'Class not found']);
}

$isTeacherOwner = ($userData['role'] ?? null) === 'teacher' && ($scheduleData['teacherId'] ?? null) === $uid;
$isAdmin = ($userData['role'] ?? null) === 'admin';
if (!$isTeacherOwner && !$isAdmin) {
    jsonResponse(403, ['error' => 'Only the class teacher or an admin can control recording']);
}

function livekitTwirpCall(string $httpHost, string $path, array $payload, string $serverToken): array
{
    $ch = curl_init($httpHost . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $serverToken,
        ],
        CURLOPT_TIMEOUT => 15,
    ]);
    $responseBody = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        throw new RuntimeException('LiveKit request failed: ' . $curlError);
    }
    $decoded = json_decode($responseBody, true);
    if ($httpCode >= 300) {
        throw new RuntimeException(
            'LiveKit returned HTTP ' . $httpCode . ': ' . ($responseBody ?: 'no body')
        );
    }
    return is_array($decoded) ? $decoded : [];
}

$serverToken = buildLiveKitServerToken($apiKey, $apiSecret, ['roomRecord' => true]);

if ($action === 'start') {
    if (($scheduleData['recordingStatus'] ?? null) === 'recording') {
        jsonResponse(200, ['status' => 'already_recording', 'egressId' => $scheduleData['egressId'] ?? null]);
    }

    // No explicit file_outputs/storage config here on purpose: this
    // relies on a default egress output being configured in the LiveKit
    // Cloud project dashboard. If Martin's project doesn't have one set
    // up, this call will fail with a clear LiveKit error rather than
    // silently doing the wrong thing -- see the note in .env.example.
    try {
        $result = livekitTwirpCall($httpHost, '/twirp/livekit.Egress/StartRoomCompositeEgress', [
            'room_name' => $scheduleId,
            'layout' => 'grid',
        ], $serverToken);
    } catch (Throwable $e) {
        error_log('[livekit-egress] start failed: ' . $e->getMessage());
        jsonResponse(502, ['error' => 'Could not start recording: ' . $e->getMessage()]);
    }

    $egressId = $result['egressId'] ?? null;
    $scheduleRef->set([
        'egressId' => $egressId,
        'recordingStatus' => 'recording',
        'recordingStartedAt' => FieldValue::serverTimestamp(),
    ], ['merge' => true]);

    jsonResponse(200, ['status' => 'recording', 'egressId' => $egressId]);
}

// action === 'stop'
$egressId = $scheduleData['egressId'] ?? null;
if (!$egressId) {
    jsonResponse(400, ['error' => 'No active recording for this class']);
}

try {
    livekitTwirpCall($httpHost, '/twirp/livekit.Egress/StopEgress', [
        'egress_id' => $egressId,
    ], $serverToken);
} catch (Throwable $e) {
    error_log('[livekit-egress] stop failed: ' . $e->getMessage());
    jsonResponse(502, ['error' => 'Could not stop recording: ' . $e->getMessage()]);
}

// The final file URL arrives asynchronously via api/livekit-webhook.php
// (egress_ended event) once LiveKit finishes muxing the file.
$scheduleRef->set([
    'recordingStatus' => 'processing',
], ['merge' => true]);

jsonResponse(200, ['status' => 'processing', 'egressId' => $egressId]);
