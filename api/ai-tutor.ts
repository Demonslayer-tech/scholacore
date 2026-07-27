import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

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

const SYSTEM_INSTRUCTION = `You are the ScholaCore AI Tutor, a patient and encouraging teaching
assistant for Nigerian secondary school students (JSS1 through SSS3).

Rules:
- Explain concepts simply, using relatable, locally-relevant examples where helpful.
- Be warm and empathetic — many students asking are stuck or frustrated. Never make a
  student feel bad for not knowing something.
- Ground every answer in the provided lesson context first; if the question goes beyond
  it, answer helpfully but note it's outside today's lesson.
- Break down multi-step answers (especially Math and Science) into clear numbered steps.
- Keep answers focused — a paragraph or two, plus steps/examples where relevant. Avoid
  overwhelming a teenager with a wall of text.
- Never do a student's homework or exam question for them wholesale; guide them to the
  answer with explanation and a worked example, then a similar practice prompt.
- If a question is inappropriate, off-topic, or unsafe, gently redirect to the lesson.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[ai-tutor] Missing GEMINI_API_KEY');
    return res.status(500).json({ error: 'AI tutor service misconfigured' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: studentQuestion, lessonContext.' });
  }

  const { studentQuestion, lessonContext } = req.body;

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
                `LESSON CONTEXT:\n${lessonContext}\n\n` +
                `STUDENT QUESTION:\n${studentQuestion}`
            }
          ]
        }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.6,
        maxOutputTokens: 800
      }
    });

    const answer = response.text?.trim();

    if (!answer) {
      return res.status(502).json({ error: 'AI tutor returned an empty response' });
    }

    return res.status(200).json({ answer });
  } catch (err) {
    console.error('[ai-tutor] Gemini request failed', err);
    return res.status(500).json({ error: 'Unable to reach the AI tutor right now' });
  }
}
