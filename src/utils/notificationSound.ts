let audioContext: AudioContext | null = null;
let audioUnlockPromise: Promise<void> | null = null;
let unlockListenersAttached = false;

/** Session default; a future settings screen can replace this flag. */
export const notificationSoundEnabled = true;

const getAudioContextConstructor = () => (
  typeof window === 'undefined'
    ? undefined
    : window.AudioContext
      || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
);

const ensureAudioContext = () => {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) return null;
  try {
    audioContext ||= new AudioContextConstructor();
    return audioContext;
  } catch {
    return null;
  }
};

/** Unlocks audio after a real user gesture without playing a test sound. */
export const unlockNotificationAudio = () => {
  const context = ensureAudioContext();
  if (!context || context.state === 'closed') return;
  if (context.state === 'running') return;
  if (audioUnlockPromise) return;
  audioUnlockPromise = context.resume()
    .catch(() => undefined)
    .finally(() => {
      audioUnlockPromise = null;
    });
};

const attachUnlockListeners = () => {
  if (unlockListenersAttached || typeof window === 'undefined') return;
  unlockListenersAttached = true;
  window.addEventListener('pointerdown', unlockNotificationAudio, { passive: true });
  window.addEventListener('keydown', unlockNotificationAudio);
};

attachUnlockListeners();

/** Plays a short local tone. Autoplay/browser errors are intentionally ignored. */
export const playNotificationSound = () => {
  if (!notificationSoundEnabled || typeof window === 'undefined') return;

  try {
    attachUnlockListeners();
    const context = ensureAudioContext();
    if (!context || context.state !== 'running') {
      unlockNotificationAudio();
      return;
    }

    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, start);
    oscillator.frequency.exponentialRampToValueAtTime(660, start + 0.16);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.18);
  } catch {
    // Audio playback is best effort and must never affect message handling.
  }
};
