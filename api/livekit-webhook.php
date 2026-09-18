<?php

require_once __DIR__ . '/_lib/FirebaseAdmin.php';
require_once __DIR__ . '/_lib/LiveKitAuth.php';

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
if (!$apiKey || !$apiSecret) {
    error_log('[livekit-webhook] Missing LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
    jsonResponse(500, ['error' => 'Webhook misconfigured']);
}

$rawBody = file_get_contents('php://input');
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

if (!verifyLiveKitWebhook($authHeader, $rawBody, $apiKey, $apiSecret)) {
    error_log('[livekit-webhook] Invalid signature');
    jsonResponse(401, ['error' => 'Invalid signature']);
}

$event = json_decode($rawBody, true);
if (json_last_error() !== JSON_ERROR_NONE || !is_array($event)) {
    jsonResponse(400, ['error' => 'Invalid JSON payload']);
}

try {
    $db = getAdminFirestore()->database();
} catch (Throwable $e) {
    error_log('[livekit-webhook] Firestore init failed: ' . $e->getMessage());
    jsonResponse(500, ['error' => 'Webhook misconfigured']);
}

$eventType = $event['event'] ?? null;
$egressInfo = $event['egressInfo'] ?? [];
$egressId = $egressInfo['egressId'] ?? null;

$webhookEventRef = $db->collection('webhook_events')->document($egressId ?: ('livekit-' . time()));
$existingEventData = snapshotData($webhookEventRef->snapshot());

// We only act on egress_ended (recording fully processed); other events
// (egress_started, egress_updated, room_started, etc.) are acknowledged
// and ignored so LiveKit doesn't keep retrying something we'll never
// process.
if ($eventType !== 'egress_ended' || !$egressId) {
    jsonResponse(200, ['received' => true, 'ignored' => $eventType]);
}

// Idempotency: LiveKit may deliver the same webhook more than once.
if (($existingEventData['processed'] ?? false) === true) {
    jsonResponse(200, ['received' => true, 'alreadyProcessed' => true]);
}

$roomName = $egressInfo['roomName'] ?? null;
$fileResults = $egressInfo['fileResults'] ?? [];
$firstFile = $fileResults[0] ?? [];
// "location" is what LiveKit's egress API returns for the finished file;
// whether it's a directly-playable URL depends on how the egress output
// storage is configured on the LiveKit Cloud project (see the note in
// .env.example). We store exactly what LiveKit gives us either way.
$recordingLocation = $firstFile['location'] ?? $firstFile['filename'] ?? null;

try {
    if ($roomName) {
        $db->collection('schedules')->document($roomName)->set([
            'recordingStatus' => 'ended',
            'recordingUrl' => $recordingLocation,
            'recordingEndedAt' => FieldValue::serverTimestamp(),
        ], ['merge' => true]);
    } else {
        error_log('[livekit-webhook] egress_ended with no roomName, egressId=' . $egressId);
    }

    $webhookEventRef->set([
        'source' => 'livekit',
        'payload' => $event,
        'processed' => true,
        'lastAttemptAt' => FieldValue::serverTimestamp(),
        'error' => null,
    ], ['merge' => true]);
} catch (Throwable $e) {
    error_log('[livekit-webhook] Failed to record egress result: ' . $e->getMessage());
    $webhookEventRef->set([
        'source' => 'livekit',
        'payload' => $event,
        'processed' => false,
        'lastAttemptAt' => FieldValue::serverTimestamp(),
        'error' => $e->getMessage(),
    ], ['merge' => true]);
    jsonResponse(500, ['error' => 'Failed to record egress result']);
}

jsonResponse(200, ['received' => true]);
