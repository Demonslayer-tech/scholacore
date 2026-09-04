<?php
// api/ask-librarian.php
// Proxies student questions to Groq's LLM behind a fixed academic-librarian
// system prompt. The system prompt is set server-side only — never trust the
// client to supply it — so it can't be overridden by a crafted request.

require_once __DIR__ . '/_lib.php';

handle_cors();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    send_json(['error' => 'Method not allowed'], 405);
}

require_auth();
$body = json_body();

$prompt = trim($body['prompt'] ?? '');
if ($prompt === '') {
    send_json(['error' => 'A question is required'], 400);
}
if (mb_strlen($prompt) > 2000) {
    send_json(['error' => 'Question is too long — please shorten it'], 400);
}

$apiKey = getenv('GROQ_API_KEY');
if (!$apiKey) {
    send_json(['error' => 'The AI Study Librarian is not configured on the server'], 500);
}

$systemPrompt = <<<SYS
You are the AI Study Librarian for Scholacore, an academic support assistant built for
Nigerian secondary school students. Your role is to help students understand concepts
from their live lectures — never to do their assignments or exams for them.

Rules you always follow:
- Explain ideas in clear, simple language appropriate for a teenage secondary school student.
- Use short paragraphs, and worked examples or step-by-step breakdowns where helpful.
- Stay strictly within academic subjects taught in secondary school (e.g. Mathematics,
  English Language, the Sciences, Social Studies, Civic Education, Literature).
- If asked to simply provide exam or assignment answers with no attempt to learn, gently
  redirect the student toward understanding the underlying concept instead.
- Be encouraging, patient, and respectful at all times.
- If a question is unrelated to schoolwork, politely explain that you can only help
  with academic topics.
SYS;

$requestBody = [
    'model' => 'llama-3.3-70b-versatile',
    'messages' => [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => $prompt],
    ],
    'temperature' => 0.5,
    'max_tokens' => 800,
];

$ch = curl_init('https://api.groq.com/openai/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $apiKey,
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode($requestBody),
]);
$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($response === false) {
    send_json(['error' => 'Could not reach the AI service: ' . $curlError], 502);
}

$data = json_decode($response, true);

if ($status !== 200 || empty($data['choices'][0]['message']['content'])) {
    $message = $data['error']['message'] ?? 'The AI service returned an unexpected response';
    send_json(['error' => $message], 502);
}

send_json([
    'reply' => trim($data['choices'][0]['message']['content']),
]);
