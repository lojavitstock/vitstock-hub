export type InstallPromptChoice = { outcome: 'accepted' | 'dismissed' };

export type DeferredInstallPrompt = {
  prompt: () => Promise<void> | void;
  userChoice: Promise<InstallPromptChoice>;
};

export const createInstallPromptController = (onChange: () => void = () => undefined) => {
  let deferredPrompt: DeferredInstallPrompt | null = null;
  let installed = false;
  let promptCaptured = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    onChange();
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    capture(prompt: DeferredInstallPrompt) {
      if (installed) return;
      deferredPrompt = prompt;
      promptCaptured = true;
      notify();
    },
    markInstalled() {
      installed = true;
      deferredPrompt = null;
      notify();
    },
    clear() {
      deferredPrompt = null;
      notify();
    },
    isInstalled() {
      return installed;
    },
    hasCapturedPrompt() {
      return promptCaptured;
    },
    canInstall() {
      return !installed && deferredPrompt !== null;
    },
    async promptInstall(): Promise<InstallPromptChoice | null> {
      const prompt = deferredPrompt;
      if (!prompt || installed) return null;
      deferredPrompt = null;
      notify();
      try {
        await prompt.prompt();
        return await prompt.userChoice;
      } finally {
        deferredPrompt = null;
        notify();
      }
    },
  };
};

export const installPromptController = createInstallPromptController();

const attachedTargets = new WeakSet<object>();

/** Attach before React mounts so an early browser prompt is retained. */
export const attachInstallPromptListeners = (
  target: Pick<Window, 'addEventListener'>,
  controller = installPromptController,
): void => {
  if (attachedTargets.has(target)) return;
  attachedTargets.add(target);

  target.addEventListener('beforeinstallprompt', ((event: Event) => {
    const promptEvent = event as Event & DeferredInstallPrompt;
    if (typeof promptEvent.prompt !== 'function' || !promptEvent.userChoice) return;
    event.preventDefault();
    controller.capture(promptEvent);
  }) as EventListener);
  target.addEventListener('appinstalled', (() => controller.markInstalled()) as EventListener);
};

export const isStandaloneDisplayMode = (matches: boolean): boolean => matches;
