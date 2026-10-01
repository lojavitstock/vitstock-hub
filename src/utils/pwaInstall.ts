export type InstallPromptChoice = { outcome: 'accepted' | 'dismissed' };

export type DeferredInstallPrompt = {
  prompt: () => Promise<void> | void;
  userChoice: Promise<InstallPromptChoice>;
};

export const createInstallPromptController = (onChange: () => void = () => undefined) => {
  let deferredPrompt: DeferredInstallPrompt | null = null;
  let installed = false;

  return {
    capture(prompt: DeferredInstallPrompt) {
      if (installed) return;
      deferredPrompt = prompt;
      onChange();
    },
    markInstalled() {
      installed = true;
      deferredPrompt = null;
      onChange();
    },
    clear() {
      deferredPrompt = null;
      onChange();
    },
    isInstalled() {
      return installed;
    },
    canInstall() {
      return !installed && deferredPrompt !== null;
    },
    async promptInstall(): Promise<InstallPromptChoice | null> {
      const prompt = deferredPrompt;
      if (!prompt || installed) return null;
      deferredPrompt = null;
      onChange();
      try {
        await prompt.prompt();
        return await prompt.userChoice;
      } finally {
        deferredPrompt = null;
        onChange();
      }
    },
  };
};

export const isStandaloneDisplayMode = (matches: boolean): boolean => matches;
