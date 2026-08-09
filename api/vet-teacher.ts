import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminAuth, getAdminFirestore } from './_lib/firebaseAdmin';
import { verifyCaller } from './_lib/verifyCaller';
import { getEnv } from './_lib/env';

interface VetTeacherBody {
  fullName: string;
  specialties: string[];
  essayAnswers: Record<string, string>;
}

interface VetResult {
  score: number;
  summary: string;
  recommendation: 'HIRE' | 'INTERVIEW' | 'REJECT';
}

function isValidBody(body: unknown): body is VetTeacherBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.fullName === 'string' &&
    Array.isArray(b.specialties) &&
    typeof b.essayAnswers === 'object' &&
    b.essayAnswers !== null
  );
}

const SYSTEM_INSTRUCTION = `You are ScholaCore's pedagogical screening AI, assisting the principal's
office in evaluating secondary school teacher applicants (JSS1–SSS3).

Assess essay answers for:
- Subject mastery and accuracy appropriate to secondary education.
- Pedagogical reasoning: does the applicant explain HOW they'd teach a concept, not just
  what it is?
- Classroom management and empathy for teenage learners.
- Clarity of communication (a teacher's writing reflects how they'll explain things).

Score 0-100. Calibrate roughly: 85+ HIRE-caliber, 60-84 INTERVIEW-caliber (promising but
needs a conversation), below 60 REJECT (significant gaps). Be fair and consistent — do not
inflate scores out of politeness. Provide a concise, specific summary a principal can act
on in under 30 seconds of reading.`;

interface GroqChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = getEnv('GROQ_API_KEY');
  if (!apiKey) {
    console.error('[vet-teacher] Missing GROQ_API_KEY');
    return res.status(500).json({ error: 'Vetting service misconfigured' });
  }

  // Previously `applicantId` came straight from the request body, meaning
  // anyone could overwrite a DIFFERENT applicant's score/status just by
  // sending their ID. It's now taken from the verified token instead.
  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  const applicantId = caller.telegramId;

  if (!isValidBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid payload. Required: fullName, specialties, essayAnswers.'
    });
  }

  const { fullName, specialties, essayAnswers } = req.body;

  const essayBlock = Object.entries(essayAnswers)
    .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
    .join('\n\n');

  try {
    // Groq's Structured Outputs (json_schema + strict: true) uses
    // constrained decoding, so the response is guaranteed to match this
    // schema exactly — same reliability guarantee the Gemini version had
    // via responseSchema, no retry/re-parse logic needed. Using
    // openai/gpt-oss-120b (the larger of Groq's two general-purpose
    // models) here rather than the -20b used in ai-tutor.ts, since this
    // task is a judgment call on a real hiring decision and is worth the
    // extra quality — it's not a latency-sensitive live chat.
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          {
            role: 'user',
            content:
              `Applicant: ${fullName}\n` +
              `Declared specialties: ${specialties.join(', ')}\n\n` +
              `Essay responses:\n${essayBlock}`
          }
        ],
        temperature: 0.3,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'teacher_vetting_result',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                score: { type: 'integer', minimum: 0, maximum: 100 },
                summary: { type: 'string' },
                recommendation: { type: 'string', enum: ['HIRE', 'INTERVIEW', 'REJECT'] }
              },
              required: ['score', 'summary', 'recommendation'],
              additionalProperties: false
            }
          }
        }
      })
    });

    const data = (await groqRes.json()) as GroqChatResponse;

    if (!groqRes.ok) {
      console.error('[vet-teacher] Groq rejected the request', data);
      return res.status(502).json({ error: data.error?.message || 'Vetting request failed' });
    }

    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      return res.status(502).json({ error: 'Vetting AI returned an empty response' });
    }

    let result: VetResult;
    try {
      result = JSON.parse(raw) as VetResult;
    } catch {
      console.error('[vet-teacher] Failed to parse Groq JSON output', raw);
      return res.status(502).json({ error: 'Vetting AI returned malformed output' });
    }

    // Clamp defensively even under strict schema mode — cheap insurance.
    result.score = Math.max(0, Math.min(100, Math.round(result.score)));

    const db = getAdminFirestore();
    // Previously `.update()`, which throws if this document doesn't exist
    // yet. In practice it only worked because the client (SignUp.tsx)
    // happens to create it first — a silent ordering dependency that broke
    // this endpoint (with a 500, despite the AI screening having already
    // succeeded) the moment that assumption didn't hold. `.set(..., {
    // merge: true })` writes these fields whether or not the document
    // exists yet.
    await db.collection('teacherApplications').doc(applicantId).set(
      {
        aiScore: result.score,
        aiSummary: result.summary,
        status: result.recommendation
      },
      { merge: true }
    );

    // Teacher sign-up works differently from student/parent: submitting
    // this application IS the sign-up action, gated on AI screening rather
    // than granting access immediately. Only create the account if one
    // doesn't already exist — an existing student/parent/teacher/etc.
    // hitting this endpoint should never have their role silently
    // overwritten to pending_teacher.
    const userRef = db.collection('users').doc(applicantId);
    const existingUser = await userRef.get();

    let customToken: string | undefined;
    if (!existingUser.exists) {
      await userRef.set({
        name: fullName,
        role: 'pending_teacher',
        unlockedLessons: {},
        createdAt: new Date().toISOString()
      });
      // Their current token still says role: 'unregistered' — mint a fresh
      // one so the client can move past the sign-up screen without a full
      // app restart.
      customToken = await getAdminAuth().createCustomToken(applicantId, { role: 'pending_teacher' });
    }

    return res.status(200).json({ ...result, customToken });
  } catch (err) {
    console.error('[vet-teacher] Groq request failed', err);
    return res.status(500).json({ error: 'Unable to complete AI vetting right now' });
  }
}
