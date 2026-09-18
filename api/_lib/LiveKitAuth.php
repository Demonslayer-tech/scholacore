<?php

/**
 * Minimal LiveKit JWT helper. LiveKit has no official PHP SDK, and pulling
 * in a generic JWT library for one HS256 token type isn't worth the extra
 * composer dependency -- the token shape is simple enough to build by hand
 * (matches the LiveKit AccessToken spec: HS256, iss = API key, standard
 * exp/nbf, plus a "video" grant object).
 *
 * https://docs.livekit.io/home/get-started/authentication/
 */

function base64UrlEncode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/**
 * Builds a signed LiveKit access token for a participant joining a room.
 *
 * @param string $identity Stable participant identity -- we use the
 *   Firebase uid, so LiveKit's participant identity always matches our
 *   own user records.
 * @param string $room LiveKit room name. We use the Firestore schedule
 *   document ID directly, so it's guaranteed unique with no extra
 *   bookkeeping.
 * @param array $videoGrant e.g. ['roomJoin' => true, 'room' => $room,
 *   'canPublish' => true, 'canSubscribe' => true]
 */
function buildLiveKitParticipantToken(
    string $apiKey,
    string $apiSecret,
    string $identity,
    string $name,
    array $videoGrant,
    int $ttlSeconds = 3600
): string {
    $now = time();
    $payload = [
        'iss' => $apiKey,
        'sub' => $identity,
        'name' => $name,
        'nbf' => $now - 10,
        'exp' => $now + $ttlSeconds,
        'video' => $videoGrant,
    ];
    return signLiveKitJwt($payload, $apiSecret);
}

/**
 * Builds a signed server-to-server JWT for calling LiveKit's Egress API
 * (or any other server API). Short-lived by design -- these are minted
 * fresh per request, never stored.
 */
function buildLiveKitServerToken(string $apiKey, string $apiSecret, array $videoGrant, int $ttlSeconds = 600): string
{
    $now = time();
    $payload = [
        'iss' => $apiKey,
        'sub' => $apiKey,
        'nbf' => $now - 10,
        'exp' => $now + $ttlSeconds,
        'video' => $videoGrant,
    ];
    return signLiveKitJwt($payload, $apiSecret);
}

function signLiveKitJwt(array $payload, string $secret): string
{
    $header = ['alg' => 'HS256', 'typ' => 'JWT'];
    $segments = [
        base64UrlEncode(json_encode($header)),
        base64UrlEncode(json_encode($payload)),
    ];
    $signingInput = implode('.', $segments);
    $signature = hash_hmac('sha256', $signingInput, $secret, true);
    $segments[] = base64UrlEncode($signature);
    return implode('.', $segments);
}

/**
 * Verifies a LiveKit webhook request. LiveKit signs webhooks with a JWT
 * (in the Authorization header) whose payload includes a "sha256" claim:
 * the base64-encoded SHA-256 hash of the exact raw request body. We
 * recompute that hash ourselves rather than trusting the claim, so a
 * tampered body is caught even if someone replays a previously-valid
 * token alongside different content.
 *
 * https://docs.livekit.io/home/server/webhooks/
 */
function verifyLiveKitWebhook(string $authorizationHeader, string $rawBody, string $apiKey, string $apiSecret): bool
{
    $token = preg_replace('/^Bearer\s+/i', '', trim($authorizationHeader));
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return false;
    }
    [$headerB64, $payloadB64, $sigB64] = $parts;

    $signingInput = $headerB64 . '.' . $payloadB64;
    $expectedSig = base64UrlEncode(hash_hmac('sha256', $signingInput, $apiSecret, true));
    if (!hash_equals($expectedSig, $sigB64)) {
        return false;
    }

    $payloadJson = base64_decode(strtr($payloadB64, '-_', '+/'));
    $payload = json_decode($payloadJson, true);
    if (!is_array($payload)) {
        return false;
    }

    if (($payload['iss'] ?? null) !== $apiKey) {
        return false;
    }

    if (isset($payload['exp']) && time() > $payload['exp']) {
        return false;
    }

    $expectedBodyHash = base64_encode(hash('sha256', $rawBody, true));
    if (!hash_equals($expectedBodyHash, $payload['sha256'] ?? '')) {
        return false;
    }

    return true;
}
