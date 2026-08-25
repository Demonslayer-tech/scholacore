import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useScholaCoreUser } from '../App';
import { hapticError, hapticSuccess } from '../lib/telegram';

const CLASS_OPTIONS = ['JSS1', 'JSS2', 'JSS3', 'SSS1', 'SSS2', 'SSS3'] as const;
type ClassOption = (typeof CLASS_OPTIONS)[number];

interface PlacementQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}

const PLACEMENT_QUESTIONS: PlacementQuestion[] = [
  { id: 'q1', prompt: 'What is 7 × 8?', options: ['54', '56', '64', '48'], correctIndex: 1 },
  {
    id: 'q2',
    prompt: 'Choose the correctly spelled word.',
    options: ['Recieve', 'Receive', 'Receve', 'Receeve'],
    correctIndex: 1
  },
  { id: 'q3', prompt: 'Solve: 3x = 21. What is x?', options: ['6', '7', '8', '9'], correctIndex: 1 },
  {
    id: 'q4',
    prompt: 'Identify the noun in: "The bright sun rose quickly."',
    options: ['Bright', 'Sun', 'Rose', 'Quickly'],
    correctIndex: 1
  },
  { id: 'q5', prompt: 'What is the capital of Nigeria?', options: ['Lagos', 'Kano', 'Abuja', 'Ibadan'], correctIndex: 2 }
];

const TEST_DURATION_SECONDS = 300;

type Step = 'details' | 'test' | 'submitted';

export default function AdmissionForm() {
  const { uid } = useScholaCoreUser();
  const [step, setStep] = useState<Step>('details');

  const [studentFullName, setStudentFullName] = useState('');
  const [targetClass, setTargetClass] = useState<ClassOption>('JSS1');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState(TEST_DURATION_SECONDS);
  const [submitting, setSubmitting] = useState(false);
  const [placementScore, setPlacementScore] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const detailsValid =
    studentFullName.trim().length > 1 &&
    parentName.trim().length > 1 &&
    /^\+?[0-9\s-]{7,15}$/.test(parentPhone.trim()) &&
    /\S+@\S+\.\S+/.test(parentEmail.trim());

  const handleSubmitTest = useCallback(async () => {
    if (!uid || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);

    const correctCount = PLACEMENT_QUESTIONS.reduce(
      (count, q) => (answers[q.id] === q.correctIndex ? count + 1 : count),
      0
    );
    const score = Math.round((correctCount / PLACEMENT_QUESTIONS.length) * 100);

    try {
      await addDoc(collection(db, 'applications'), {
        studentFullName: studentFullName.trim(),
        targetClass,
        parentContact: {
          uid,
          name: parentName.trim(),
          phone: parentPhone.trim(),
          email: parentEmail.trim()
        },
        placementScore: score,
        status: 'PENDING_FEE',
        submittedAt: serverTimestamp()
      });

      setPlacementScore(score);
      setStep('submitted');
      hapticSuccess();
    } catch (err) {
      hapticError();
      setErrorMessage(err instanceof Error ? err.message : 'Could not submit application');
      setSubmitting(false);
    }
  }, [answers, parentEmail, parentName, parentPhone, studentFullName, targetClass, uid, submitting]);

  useEffect(() => {
    if (step !== 'test') return;
    if (secondsLeft <= 0) {
      handleSubmitTest();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [step, secondsLeft, handleSubmitTest]);

  const timeLabel = useMemo(() => {
    const m = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
    const s = (secondsLeft % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, [secondsLeft]);

  if (step === 'submitted') {
    return (
      <div className="rounded-card border border-core-100 bg-white p-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-brand-600">Application received</p>
        <h2 className="mt-2 text-xl font-bold text-core-950">Thank you, {parentName.split(' ')[0]}</h2>
        <p className="mt-2 text-sm text-core-600">
          {studentFullName}'s placement score was <span className="font-semibold">{placementScore}/100</span>. The
          bursary team will review the application and follow up with subscription details for {targetClass}.
        </p>
      </div>
    );
  }

  if (step === 'test') {
    const answeredCount = Object.keys(answers).length;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-card bg-core-950 px-4 py-3 text-white">
          <span className="text-sm">Placement test — {targetClass}</span>
          <span className="font-mono text-sm text-brand-400">{timeLabel}</span>
        </div>

        <div className="space-y-4">
          {PLACEMENT_QUESTIONS.map((q, idx) => (
            <div key={q.id} className="rounded-card border border-core-100 bg-white p-4">
              <p className="mb-3 text-sm font-medium text-core-950">
                {idx + 1}. {q.prompt}
              </p>
              <div className="space-y-2">
                {q.options.map((opt, optIdx) => (
                  <label
                    key={opt}
                    className={`flex cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-sm transition-colors ${
                      answers[q.id] === optIdx
                        ? 'border-brand-500 bg-brand-50 text-core-950'
                        : 'border-core-100 text-core-600 hover:bg-core-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      className="accent-brand-500"
                      checked={answers[q.id] === optIdx}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: optIdx }))}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={handleSubmitTest}
          disabled={submitting || answeredCount < PLACEMENT_QUESTIONS.length}
          className="w-full rounded-card bg-core-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting
            ? 'Submitting…'
            : answeredCount < PLACEMENT_QUESTIONS.length
              ? `Answer all questions (${answeredCount}/${PLACEMENT_QUESTIONS.length})`
              : 'Submit test'}
        </button>
        {errorMessage && <p className="text-xs text-signal-danger">{errorMessage}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-core-950">Admissions</h2>
        <p className="text-sm text-core-600">Register a student for the upcoming term.</p>
      </div>

      <div className="space-y-3 rounded-card border border-core-100 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-core-600">Student's full name</label>
          <input
            value={studentFullName}
            onChange={(e) => setStudentFullName(e.target.value)}
            className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
            placeholder="e.g. Amara Chukwu"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-core-600">Target class</label>
          <select
            value={targetClass}
            onChange={(e) => setTargetClass(e.target.value as ClassOption)}
            className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
          >
            {CLASS_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-core-600">Parent / guardian name</label>
          <input
            value={parentName}
            onChange={(e) => setParentName(e.target.value)}
            className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
            placeholder="e.g. Mrs. Ifeoma Chukwu"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-core-600">Parent phone</label>
          <input
            value={parentPhone}
            onChange={(e) => setParentPhone(e.target.value)}
            className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
            placeholder="e.g. 08012345678"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-core-600">Parent email</label>
          <input
            type="email"
            value={parentEmail}
            onChange={(e) => setParentEmail(e.target.value)}
            className="w-full rounded-card border border-core-200 px-3 py-2 text-sm focus:border-brand-500"
            placeholder="e.g. ifeoma@email.com"
          />
        </div>
      </div>

      <button
        onClick={() => setStep('test')}
        disabled={!detailsValid}
        className="w-full rounded-card bg-brand-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        Continue to placement test
      </button>
    </div>
  );
}
