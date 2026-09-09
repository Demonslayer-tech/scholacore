<?php

require_once __DIR__ . '/../../vendor/autoload.php';

use Kreait\Firebase\Factory;
use Kreait\Firebase\Contract\Firestore;

/**
 * Returns a configured Firestore client, built from the service account
 * JSON in the FIREBASE_SERVICE_ACCOUNT_KEY environment variable.
 *
 * Throws RuntimeException with a clear message if the env var is missing
 * or not valid JSON, so callers can turn that into a proper error
 * response instead of a raw fatal error.
 */
function getAdminFirestore(): Firestore
{
    static $firestore = null;
    if ($firestore !== null) {
        return $firestore;
    }

    $raw = getenv('FIREBASE_SERVICE_ACCOUNT_KEY');
    if (!$raw) {
        throw new RuntimeException('Missing FIREBASE_SERVICE_ACCOUNT_KEY environment variable');
    }

    $serviceAccount = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new RuntimeException('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON');
    }

    $factory = (new Factory())->withServiceAccount($serviceAccount);
    $firestore = $factory->createFirestore();
    return $firestore;
}
