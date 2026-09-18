import { auth, db } from '/api/firebase-config.php';
import { initTelegramWebApp } from '/assets/js/telegram.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

initTelegramWebApp();

const { Room, RoomEvent, Track } = window.LivekitClient;

function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing element #' + id);
  return found;
}

const scheduleId = new URLSearchParams(window.location.search).get('schedule');

const loginRequiredCard = el('login-required-card');
const errorCard = el('error-card');
const errorMessage = el('error-message');
const roomView = el('room-view');
const videoGrid = el('video-grid');
const classTitle = el('class-title');
const micBtn = el('toggle-mic');
const camBtn = el('toggle-cam');
const recordBtn = el('toggle-record');
const recordStatus = el('record-status');
const leaveBtn = el('leave-room');

function showError(message) {
  roomView.classList.add('hidden');
  errorCard.classList.remove('hidden');
  errorMessage.textContent = message;
}

if (!scheduleId) {
  showError('No class was specified. Go back to your portal and click "Start Class" or "Join Class" again.');
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      loginRequiredCard.classList.remove('hidden');
      return;
    }
    await joinClass(user);
  });
}

let room = null;
let micEnabled = true;
let camEnabled = true;
let isRecording = false;
let canRecord = false;

async function joinClass(user) {
  let tokenData;
  try {
    const idToken = await user.getIdToken();
    const response = await fetch('/api/livekit-token.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify({ scheduleId }),
    });
    tokenData = await response.json();
    if (!response.ok) {
      showError(tokenData.error || 'Could not join this class.');
      return;
    }
  } catch (err) {
    showError('Network error while joining the class. Please try again.');
    return;
  }

  canRecord = !!tokenData.canRecord;
  if (tokenData.subjectName) {
    classTitle.textContent = tokenData.subjectName;
  }

  room = new Room({ adaptiveStream: true, dynacast: true });

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    attachTrack(track, participant.identity, participant.name || participant.identity);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el.remove());
  });
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    const tile = document.getElementById('tile-' + participant.identity);
    if (tile) tile.remove();
  });
  room.on(RoomEvent.Disconnected, () => {
    roomView.classList.add('hidden');
  });

  try {
    await room.connect(tokenData.url, tokenData.token);
  } catch (err) {
    showError('Could not connect to the live classroom. Please check your connection and try again.');
    return;
  }

  loginRequiredCard.classList.add('hidden');
  roomView.classList.remove('hidden');

  if (tokenData.role === 'teacher' || tokenData.role === 'student') {
    await room.localParticipant.setMicrophoneEnabled(true);
    await room.localParticipant.setCameraEnabled(true);
    attachLocalTracks();
  } else {
    micBtn.classList.add('hidden');
    camBtn.classList.add('hidden');
  }

  if (canRecord) {
    recordBtn.classList.remove('hidden');
  }

  // Mark the class live the moment the teacher joins, so students see an
  // accurate status if we ever surface one on the portal pages.
  if (tokenData.role === 'teacher') {
    try {
      await updateDoc(doc(db, 'schedules', scheduleId), {
        status: 'live',
        startedAt: serverTimestamp(),
      });
    } catch (err) {
      // Non-fatal -- the class can proceed even if this write fails.
      console.warn('Could not mark class as live:', err);
    }
  }
}

function attachLocalTracks() {
  const identity = room.localParticipant.identity;
  room.localParticipant.videoTrackPublications.forEach((pub) => {
    if (pub.track) attachTrack(pub.track, identity, 'You', true);
  });
}

function attachTrack(track, identity, name, isLocal) {
  if (track.kind !== Track.Kind.Video && track.kind !== Track.Kind.Audio) return;

  let tile = document.getElementById('tile-' + identity);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'classroom-tile';
    tile.id = 'tile-' + identity;
    const label = document.createElement('span');
    label.className = 'classroom-tile__label';
    label.textContent = name;
    tile.appendChild(label);
    videoGrid.appendChild(tile);
  }

  const mediaEl = track.attach();
  if (isLocal && track.kind === Track.Kind.Video) {
    mediaEl.muted = true;
  }
  tile.insertBefore(mediaEl, tile.firstChild);
}

micBtn.addEventListener('click', async () => {
  if (!room) return;
  micEnabled = !micEnabled;
  await room.localParticipant.setMicrophoneEnabled(micEnabled);
  micBtn.textContent = micEnabled ? 'Mute' : 'Unmute';
});

camBtn.addEventListener('click', async () => {
  if (!room) return;
  camEnabled = !camEnabled;
  await room.localParticipant.setCameraEnabled(camEnabled);
  camBtn.textContent = camEnabled ? 'Stop Video' : 'Start Video';
});

recordBtn.addEventListener('click', async () => {
  if (!room || !auth.currentUser) return;
  recordBtn.disabled = true;
  try {
    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch('/api/livekit-egress.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify({ scheduleId, action: isRecording ? 'stop' : 'start' }),
    });
    const result = await response.json();
    if (!response.ok) {
      recordStatus.textContent = result.error || 'Recording error';
      recordStatus.className = 'sc-badge sc-badge--rejected';
      recordStatus.classList.remove('hidden');
      return;
    }
    isRecording = result.status === 'recording';
    recordBtn.textContent = isRecording ? 'Stop Recording' : 'Start Recording';
    recordStatus.textContent = result.status === 'recording' ? 'Recording' : 'Processing recording...';
    recordStatus.className = 'sc-badge ' + (result.status === 'recording' ? 'sc-badge--approved' : 'sc-badge--pending');
    recordStatus.classList.remove('hidden');
  } finally {
    recordBtn.disabled = false;
  }
});

leaveBtn.addEventListener('click', async () => {
  if (room) {
    if (canRecord) {
      try {
        await updateDoc(doc(db, 'schedules', scheduleId), { status: 'ended' });
      } catch (err) {
        console.warn('Could not mark class as ended:', err);
      }
    }
    await room.disconnect();
  }
  window.location.href = canRecord ? '/teacher-portal.html' : '/index.html';
});
