<?php
// Paystack's public key is not secret, but we still serve it from a real
// environment variable rather than hardcoding it into a static JS file,
// for the same reason as api/firebase-config.php.

header('Content-Type: application/javascript');

$publicKey = getenv('PAYSTACK_PUBLIC_KEY') ?: '';
$publicKeyJson = json_encode($publicKey);
?>
export const PAYSTACK_PUBLIC_KEY = <?php echo $publicKeyJson; ?>;
