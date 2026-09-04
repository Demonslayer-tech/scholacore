<?php
// api/generate-livekit-token.php
// Issues a LiveKit room-access JWT for the authenticated student or teacher.
// Publish rights are driven by a "role" custom claim on the Firebase ID token
// (set server-side via the Firebase Admin SDK, e.g. from a Cloud Function when
// a teacher account is approved). Students default to subscribe-only access.

require_once __DIR__ . '/_lib.php';

use Firebase\JWT\JWT;

handle_cors();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    send_json(['error' => 'Method not allowed'], 405);
}

$claims = require_auth();
$body = json_body();

$roomName = trim($body['room'] ?? '');
if ($roomName === '') {
    send_json(['error' => 'A room name is required'], 400);
}

$apiKey = getenv('LIVEKIT_API_KEY');
$apiSecret = getenv('LIVEKIT_API_SECRET');
$livekitUrl = getenv('LIVEKIT_URL'); // e.g. wss://your-project.livekit.cloud

if (!$apiKey || !$apiSecret || !$livekitUrl) {
    send_json(['error' => 'LiveKit is not configured on the server'], 500);
}

$uid = $claims['sub'];
$name = $claims['name'] ?? ($claims['email'] ?? 'Student');
$role = $claims['role'] ?? 'student';
$canPublish = ($role === 'teacher' || $role === 'admin');

$now = time();
$payload = [
    'iss' => $apiKey,
    'sub' => $uid,
    'jti' => $uid . '-' . $now,
    'nbf' => $now - 5,
    'exp' => $now + 60 * 60 * 4, // 4-hour token
    'name' => $name,
    'video' => [
        'room' => $roomName,
        'roomJoin' => true,
        'canPublish' => $canPublish,
        'canPublishData' => true,
        'canSubscribe' => true,
    ],
];

$token = JWT::encode($payload, $apiSecret, 'HS256');

send_json([
    'token' => $token,
    'url' => $livekitUrl,
    'room' => $roomName,
    'identity' => $uid,
]);
