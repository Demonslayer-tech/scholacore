import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyCaller } from './_lib/verifyCaller';

interface AiTutorBody {
  studentQuestion: string;
  lessonContext: string;
}

function isValidBody(body: unknown): body is AiTutorBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.studentQuestion === 'string' &&
    b.studentQuestion.trim().length > 0 &&
    typeof b.lessonContext === 'string'
  );
}

const SYSTEM_INSTRUCTION = `You are the ScholaCore Study Library AI, a patient and encouraging teaching
assistant for Nigerian secondary school students (JSS1 through SSS3).

Rules:
- Explain concepts simply, using relatable, locally-relevant examples where helpful.
- Be warm and empathetic — many students asking are stuck or frustrated. Never make a
  student feel bad for not knowing something.
- Ground every answer in the provided lesson context first; if the question goes beyond
  it, answer helpfully but note it's outside today's lesson.
- Break down multi-step answers (especially Math and Science) into clear numbered steps.
- Keep answers focused — a paragraph or two, plus steps/examples where relevant.
- Never do a student's homework or exam question for them wholesale; guide them to the
  answer with explanation and a worked example, then a similar practice prompt.
- If a question is inappropriate, off-topic, or unsafe, gently redirect to the lesson.`;

interface GroqChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[ai-tutor] Missing GROQ_API_KEY');
    return res.status(500).json({ error: 'Study library service misconfigured' });
  }

  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: studentQuestion, lessonContext.' });
  }

  const { studentQuestion, lessonContext } = req.body;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          {
            role: 'user',
            content: `LESSON CONTEXT:\n${lessonContext}\n\nSTUDENT QUESTION:\n${studentQuestion}`
          }
        ],
        temperature: 0.6,
        max_completion_tokens: 800
      })
    });

    const data = (await groqRes.json()) as GroqChatResponse;

    if (!groqRes.ok) {
      console.error('[ai-tutor] Groq rejected the request', data);
      return res.status(502).json({ error: data.error?.message || 'Study library request failed' });
    }

    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      return res.status(502).json({ error: 'Study library returned an empty response' });
    }

    return res.status(200).json({ answer });
  } catch (err) {
    console.error('[ai-tutor] Groq request failed', err);
    return res.status(500).json({ error: 'Unable to reach the study library right now' });
  }
}
