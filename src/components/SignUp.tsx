import { useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth, getAuthToken, signInWithTelegramToken } from '../lib/firebase';
import { type ScholaCoreUserRecord } from '../App';
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

type Path = 'choose' | 'student' | 'parent' | 'teacher' | 'teacher-result';

interface SignUpProps {
  onSignedUp: (user: ScholaCoreUserRecord) => void;
}

export default function SignUp({ onSignedUp }: SignUpProps) {
  const [path, setPath] = useState<Path>('choose');

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [cvUrl, setCvUrl] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [essayAnswers, setEssayAnswers] = useState<Record<string, string>>({});
  const [teacherResult, setTeacherResult] = useState<VetResult | null>(null);

  const toggleSpecialty = (subject: string) => {
    setSpecialties((prev) => (prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]));
  };

  const teacherFormValid =
    name.trim().length > 1 &&
    /^https?:\/\/\S+$/.test(cvUrl.trim()) &&
    specialties.length > 0 &&
    ESSAY_QUESTIONS.every((q) => (essayAnswers[q] ?? '').trim().length >= 40);

  const submitStudentOrParent = async (role: 'student' | 'parent') => {
    if (name.trim().length < 2) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Your session expired — please refresh and sign in again.');

      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), role })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not complete sign-up');

      await signInWithTelegramToken(data.customToken);
      hapticSuccess();
      onSignedUp(data.user);
    } catch (err) {
      hapticError();
      setErrorMessage(err instanceof Error ? err.message : 'Could not complete sign-up');
    } finally {
      setSubmitting(false);
    }
  };

  const submitTeacher = async () => {
    if (!teacherFormValid || !auth.currentUser) return;
    setSubmitting(true);
    setErrorMessage(null);

    const applicantId = auth.currentUser.uid;

    try {
      await setDoc(doc(db, 'teacherApplications', applicantId), {
        fullName: name.trim(),
        cvUrl: cvUrl.trim(),
        specialties,
        essayAnswers,
        status: 'SUBMITTED',
        submittedAt: serverTimestamp()
      });

      const token = await getAuthToken();
      if (!token) throw new Error('Your session expired — please refresh and sign in again.');

      const res = await fetch('/api/vet-teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fullName: name.trim(), specialties, essayAnswers })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI screening failed');

      if (data.customToken) {
        await signInWithTelegramToken(data.customToken);
      }

      setTeacherResult(data as VetResult);
      setPath('teacher-result');
      hapticSuccess();
    } catch (err) {
      hapticError();
      setErrorMessage(err instanceof Error ? err.message : 'Could not submit application');
    } finally {
      setSubmitting(false);
    }
  };

  if (path === 'teacher-result' && teacherResult) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-core-50 p-6">
        <div className="w-full space-y-4">
          <div className="rounded-card border border-core-100 bg-white p-6 text-center">
            <p className="font-mono text-[10px] uppercase tracking-widest text-core-400">AI screening result</p>
            <p className="mt-2 text-4xl font-bold text-core-950">{teacherResult.score}</p>
            <p className="text-xs text-core-400">out of 100</p>
            <span
              className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${RECOMMENDATION_STYLE[teacherResult.recommendation]}`}
            >
              {teacherResult.recommendation}
            </span>
            <p className="mt-4 text-left text-sm text-core-600">{teacherResult.summary}</p>
          </div>
          <p className="text-center text-xs text-core-400">
            Thanks for applying. You'll be contacted with next steps — you can close this now.
          </p>
        </div>
      </div>
    );
  }

  if (path === 'teacher') {
    return (
      <div className="min-h-screen bg-core-50 px-4 py-6">
        <div className="mx-auto max-w-lg space-y-4">
          <div>
            <h2 className="text-xl font-bold text-core-950">Teacher application</h2>
            <p className="text-sm text-core-600">
              This is your interview — an AI screening reviews your answers, then you'll be contacted.
            </p>
          </div>

          <div className="space-y-3 rounded-card border border-core-100 bg-white p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-core-600">Full name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
                placeholder="e.g. Mr. Tunde Bakare"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-core-600">CV link</label>
              <input
                value={cvUrl}
                onChange={(e) => setCvUrl(e.target.value)}
                className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
                placeholder="Link to your CV (Google Drive, Dropbox, etc.)"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-core-600">Specialties</label>
              <div className="flex flex-wrap gap-2">
                {SUBJECTS.map((subject) => (
                  <button
                    type="button"
                    key={subject}
                    onClick={() => toggleSpecialty(subject)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      specialties.includes(subject)
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-core-200 text-core-600 hover:bg-core-50'
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
                <label className="mb-2 block text-xs font-medium text-core-600">{q}</label>
                <textarea
                  value={essayAnswers[q] ?? ''}
                  onChange={(e) => setEssayAnswers((prev) => ({ ...prev, [q]: e.target.value }))}
                  rows={4}
                  className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
                  placeholder="At least a few sentences…"
                />
              </div>
            ))}
          </div>

          <button
            onClick={submitTeacher}
            disabled={!teacherFormValid || submitting}
            className="w-full rounded-card bg-core-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {submitting ? 'Submitting for AI screening…' : 'Submit application'}
          </button>
          {errorMessage && <p className="text-xs text-signal-danger">{errorMessage}</p>}
          <button onClick={() => setPath('choose')} className="w-full text-center text-xs text-core-400">
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (path === 'student' || path === 'parent') {
    const role = path;
    return (
      <div className="flex min-h-screen items-center justify-center bg-core-50 p-6">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center">
            <h2 className="text-xl font-bold text-core-950">{role === 'student' ? "You're a student" : "You're a parent"}</h2>
            <p className="text-sm text-core-600">Just your name to get started.</p>
          </div>

          <div className="rounded-card border border-core-100 bg-white p-4">
            <label className="mb-1 block text-xs font-medium text-core-600">Full name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
              placeholder={role === 'student' ? 'e.g. Amara Chukwu' : 'e.g. Mrs. Ifeoma Chukwu'}
              autoFocus
            />
          </div>

          <button
            onClick={() => submitStudentOrParent(role)}
            disabled={name.trim().length < 2 || submitting}
            className="w-full rounded-card bg-brand-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {submitting ? 'Setting up your account…' : 'Continue'}
          </button>
          {errorMessage && <p className="text-center text-xs text-signal-danger">{errorMessage}</p>}
          <button onClick={() => setPath('choose')} className="w-full text-center text-xs text-core-400">
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-core-50 p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <p className="text-2xl font-bold text-core-950">Welcome to ScholaCore</p>
          <p className="mt-1 text-sm text-core-600">Let's get you set up. Which are you?</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setPath('student')}
            className="w-full rounded-card border border-core-100 bg-white px-4 py-4 text-left transition-colors hover:border-brand-500"
          >
            <p className="text-sm font-semibold text-core-950">Student</p>
            <p className="text-xs text-core-400">Access your classes, study library, and subscription</p>
          </button>
          <button
            onClick={() => setPath('parent')}
            className="w-full rounded-card border border-core-100 bg-white px-4 py-4 text-left transition-colors hover:border-brand-500"
          >
            <p className="text-sm font-semibold text-core-950">Parent / Guardian</p>
            <p className="text-xs text-core-400">Manage your child's subscription and progress</p>
          </button>
          <button
            onClick={() => setPath('teacher')}
            className="w-full rounded-card border border-core-100 bg-white px-4 py-4 text-left transition-colors hover:border-brand-500"
          >
            <p className="text-sm font-semibold text-core-950">Teacher</p>
            <p className="text-xs text-core-400">Apply to teach — AI-screened application</p>
          </button>
        </div>
      </div>
    </div>
  );
}
