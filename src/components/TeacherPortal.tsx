import { useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, getAuthToken } from '../lib/firebase';
import { useScholaCoreUser } from '../App';
import { hapticError, hapticSuccess } from '../lib/telegram';

const SUBJECTS = [
  'Mathematics',
  'English Language',
  'Biology',
  'Chemistry',
  'Physics',
  'Economics',
  'Government',
  'Literature in English',
  'Geography',
  'Further Mathematics',
  'Computer Studies',
  'Agricultural Science'
];

const ESSAY_QUESTIONS = [
  'Pick one of your specialties. How would you explain a concept students commonly struggle with to a JSS student who is lost?',
  "A student is falling behind and seems disengaged in class. What's your approach in the first two weeks?",
  'How do you check that students have genuinely understood a topic, beyond a quiz score?'
];

interface VetResult {
  score: number;
  summary: string;
  recommendation: 'HIRE' | 'INTERVIEW' | 'REJECT';
}

const RECOMMENDATION_STYLE: Record<VetResult['recommendation'], string> = {
  HIRE: 'bg-signal-success/10 text-signal-success',
  INTERVIEW: 'bg-signal-pending/10 text-signal-pending',
  REJECT: 'bg-signal-danger/10 text-signal-danger'
};

export default function TeacherPortal() {
  const { telegramUser } = useScholaCoreUser();
  const [fullName, setFullName] = useState('');
  const [cvUrl, setCvUrl] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [essayAnswers, setEssayAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'form' | 'submitting' | 'result'>('form');
  const [result, setResult] = useState<VetResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggleSpecialty = (subject: string) => {
    setSpecialties((prev) => (prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]));
  };

  const isValid =
    fullName.trim().length > 1 &&
    /^https?:\/\/\S+$/.test(cvUrl.trim()) &&
    specialties.length > 0 &&
    ESSAY_QUESTIONS.every((q) => (essayAnswers[q] ?? '').trim().length >= 40);

  const handleSubmit = async () => {
    if (!telegramUser || !isValid) return;
    setStatus('submitting');
    setErrorMessage(null);

    const applicantId = telegramUser.telegramId;

    try {
      // The client writes the raw application — allowed because it's
      // self-created, contains no aiScore/aiSummary, and status is
      // SUBMITTED (see firestore.rules). The score gets filled in
      // immediately after via the Admin SDK in /api/vet-teacher, which a
      // client can never write to directly.
      await setDoc(doc(db, 'teacherApplications', applicantId), {
        fullName: fullName.trim(),
        cvUrl: cvUrl.trim(),
        specialties,
        essayAnswers,
        status: 'SUBMITTED',
        submittedAt: serverTimestamp()
      });

      const token = await getAuthToken();
      if (!token) {
        throw new Error('Your session expired — please close and reopen the app.');
      }

      const res = await fetch('/api/vet-teacher', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ fullName: fullName.trim(), specialties, essayAnswers })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI screening failed');
      }

      setResult(data as VetResult);
      setStatus('result');
      hapticSuccess();
    } catch (err) {
      hapticError();
      setErrorMessage(err instanceof Error ? err.message : 'Could not submit application');
      setStatus('form');
    }
  };

  if (status === 'result' && result) {
    return (
      <div className="space-y-4">
        <div className="rounded-card border border-core-100 bg-white p-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-widest text-core-500">AI screening result</p>
          <p className="mt-2 font-display text-4xl text-core-900">{result.score}</p>
          <p className="text-xs text-core-500">out of 100</p>
          <span
            className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${RECOMMENDATION_STYLE[result.recommendation]}`}
          >
            {result.recommendation}
          </span>
          <p className="mt-4 text-left text-sm text-core-700">{result.summary}</p>
        </div>
        <p className="text-center text-xs text-core-500">
          The principal's office will follow up with next steps based on this recommendation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl text-core-900">Teacher recruitment</h2>
        <p className="text-sm text-core-600">Apply to teach at ScholaCore Academy.</p>
      </div>

      <div className="space-y-3 rounded-card border border-core-100 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-core-700">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-card border border-core-100 px-3 py-2 text-sm focus:border-seal-500"
            placeholder="e.g. Mr. Tunde Bakare"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-core-700">CV link</label>
          <input
            value={cvUrl}
            onChange={(e) => setCvUrl(e.target.value)}
            className="w-full rounded-card border border-core-100 px-3 py-2 text-sm focus:border-seal-500"
            placeholder="Link to your CV (Google Drive, Dropbox, etc.)"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-core-700">Specialties</label>
          <div className="flex flex-wrap gap-2">
            {SUBJECTS.map((subject) => (
              <button
                type="button"
                key={subject}
                onClick={() => toggleSpecialty(subject)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  specialties.includes(subject)
                    ? 'border-seal-500 bg-seal-500/10 text-core-900'
                    : 'border-core-100 text-core-600 hover:bg-core-50'
                }`}
              >
                {subject}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {ESSAY_QUESTIONS.map((q) => (
          <div key={q} className="rounded-card border border-core-100 bg-white p-4">
            <label className="mb-2 block text-xs font-medium text-core-700">{q}</label>
            <textarea
              value={essayAnswers[q] ?? ''}
              onChange={(e) => setEssayAnswers((prev) => ({ ...prev, [q]: e.target.value }))}
              rows={4}
              className="w-full rounded-card border border-core-100 px-3 py-2 text-sm focus:border-seal-500"
              placeholder="At least a few sentences…"
            />
          </div>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!isValid || status === 'submitting'}
        className="w-full rounded-card bg-core-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {status === 'submitting' ? 'Submitting for AI screening…' : 'Submit application'}
      </button>
      {errorMessage && <p className="text-xs text-signal-danger">{errorMessage}</p>}
    </div>
  );
}
