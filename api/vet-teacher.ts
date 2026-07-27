import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import { getAdminFirestore } from './_lib/firebaseAdmin';

interface VetTeacherBody {
  applicantId: string;
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
    typeof b.applicantId === 'string' &&
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[vet-teacher] Missing GEMINI_API_KEY');
    return res.status(500).json({ error: 'Vetting service misconfigured' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid payload. Required: applicantId, fullName, specialties, essayAnswers.'
    });
  }

  const { applicantId, fullName, specialties, essayAnswers } = req.body;

  const essayBlock = Object.entries(essayAnswers)
    .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
    .join('\n\n');

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Applicant: ${fullName}\n` +
                `Declared specialties: ${specialties.join(', ')}\n\n` +
                `Essay responses:\n${essayBlock}`
            }
          ]
        }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            summary: { type: Type.STRING },
            recommendation: {
              type: Type.STRING,
              enum: ['HIRE', 'INTERVIEW', 'REJECT']
            }
          },
          required: ['score', 'summary', 'recommendation']
        }
      }
    });

    const raw = response.text?.trim();
    if (!raw) {
      return res.status(502).json({ error: 'Vetting AI returned an empty response' });
    }

    let result: VetResult;
    try {
      result = JSON.parse(raw) as VetResult;
    } catch {
      console.error('[vet-teacher] Failed to parse Gemini JSON output', raw);
      return res.status(502).json({ error: 'Vetting AI returned malformed output' });
    }

    // Clamp defensively even though we asked for a strict schema — models
    // occasionally drift outside requested bounds.
    result.score = Math.max(0, Math.min(100, Math.round(result.score)));

    const db = getAdminFirestore();
    await db.collection('teacherApplications').doc(applicantId).update({
      aiScore: result.score,
      aiSummary: result.summary,
      status: result.recommendation
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[vet-teacher] Gemini request failed', err);
    return res.status(500).json({ error: 'Unable to complete AI vetting right now' });
  }
}
