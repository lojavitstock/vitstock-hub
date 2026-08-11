let audioContext: AudioContext | null = null;

/** Session default; a future settings screen can replace this flag. */
export const notificationSoundEnabled = true;

/** Plays a short local tone. Autoplay/browser errors are intentionally ignored. */
export const playNotificationSound = () => {
  if (!notificationSoundEnabled || typeof window === 'undefined') return;

  try {
    const AudioContextConstructor = window.AudioContext
      || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    audioContext ||= new AudioContextConstructor();
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => undefined);

    const start = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, start);
    oscillator.frequency.exponentialRampToValueAtTime(660, start + 0.12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.14);
  } catch {
    // Audio playback is best effort and must never affect message handling.
  }
};
