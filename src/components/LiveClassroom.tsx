import { useState } from 'react';
import { LiveKitRoom, VideoConference, RoomAudioRenderer, formatChatMessageLinks } from '@livekit/components-react';
import '@livekit/components-styles';
import { useScholaCoreUser } from '../App';
import { getAuthToken } from '../lib/firebase';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string;

interface ClassroomSession {
  token: string;
  room: string;
  canPublish: boolean;
}

export default function LiveClassroom() {
  const { uid, userRecord } = useScholaCoreUser();
  const [session, setSession] = useState<ClassroomSession | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const classId = userRecord?.classId;

  const joinClass = async () => {
    if (!uid || !classId) return;
    setStatus('connecting');
    setErrorMessage(null);

    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Your session expired — please refresh and sign in again.');

      const res = await fetch('/api/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ classId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not join classroom');

      setSession(data);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Could not join classroom');
    }
  };

  if (!classId) {
    return (
      <div className="rounded-card border border-core-100 bg-white p-4">
        <p className="text-sm text-core-600">
          You're not yet assigned to a class. This unlocks once admissions confirms your placement.
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-card border border-core-100 bg-white p-8 text-center">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-core-400">Live classroom</p>
          <h2 className="mt-1 text-lg font-bold text-core-950">Class {classId}</h2>
        </div>
        <p className="text-sm text-core-600">Join when your teacher starts the session.</p>
        <button
          onClick={joinClass}
          disabled={status === 'connecting'}
          className="rounded-card bg-core-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status === 'connecting' ? 'Connecting…' : 'Join class'}
        </button>
        {errorMessage && <p className="text-xs text-signal-danger">{errorMessage}</p>}
      </div>
    );
  }

  return (
    <div className="h-[75vh] overflow-hidden rounded-card border border-core-100">
      <LiveKitRoom
        serverUrl={LIVEKIT_URL}
        token={session.token}
        connect
        video={session.canPublish}
        audio={session.canPublish}
        data-lk-theme="default"
        onDisconnected={() => setSession(null)}
        style={{ height: '100%' }}
      >
        <VideoConference chatMessageFormatter={formatChatMessageLinks} />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
