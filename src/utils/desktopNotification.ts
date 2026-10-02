export type DesktopNotificationFailureReason =
  | 'unsupported'
  | 'permission'
  | 'service-worker-not-ready'
  | 'show-notification-failed';

export type DesktopNotificationResult =
  | { ok: true; method: 'service-worker'; serviceWorkerReady: true }
  | {
    ok: false;
    reason: DesktopNotificationFailureReason;
    serviceWorkerReady: boolean;
    errorName?: string;
    errorMessage?: string;
  };

export type DesktopNotificationRegistration = Pick<ServiceWorkerRegistration, 'active' | 'showNotification'>;

export type DesktopNotificationRuntime = {
  notificationSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  secureContext: boolean;
  serviceWorkerSupported: boolean;
  getRegistration: () => Promise<DesktopNotificationRegistration | undefined>;
  ready: () => Promise<DesktopNotificationRegistration | undefined>;
};

const READY_TIMEOUT_MS = 5_000;

const getBrowserRuntime = (): DesktopNotificationRuntime => {
  const browserWindow = typeof window === 'undefined' ? undefined : window;
  const serviceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : undefined;
  const notificationSupported = Boolean(browserWindow && 'Notification' in browserWindow);

  return {
    notificationSupported,
    permission: notificationSupported ? browserWindow!.Notification.permission : 'unsupported',
    secureContext: Boolean(browserWindow?.isSecureContext),
    serviceWorkerSupported: Boolean(serviceWorker),
    getRegistration: async () => serviceWorker?.getRegistration(),
    ready: async () => serviceWorker?.ready,
  };
};

const sanitizedErrorDetails = (error: unknown): { errorName: string; errorMessage: string } => {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  const errorName = name.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80) || 'Error';
  const errorMessage = message
    .replace(/(\b(?:authorization|token|secret)\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/[^\s@]+@(?:lid|s\.whatsapp\.net|g\.us|c\.us)\b/gi, '[identity]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 200);
  return { errorName, errorMessage };
};

const waitForReadyRegistration = async (
  ready: Promise<DesktopNotificationRegistration | undefined>,
  timeoutMs: number,
): Promise<DesktopNotificationRegistration | undefined> => new Promise((resolve) => {
  let settled = false;
  const finish = (registration: DesktopNotificationRegistration | undefined) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolve(registration);
  };
  const timeout = setTimeout(() => finish(undefined), timeoutMs);
  void ready.then(finish, () => finish(undefined));
});

export const showDesktopNotification = async (
  title: string,
  options: NotificationOptions,
  runtime: DesktopNotificationRuntime = getBrowserRuntime(),
  readyTimeoutMs = READY_TIMEOUT_MS,
): Promise<DesktopNotificationResult> => {
  if (!runtime.notificationSupported || !runtime.secureContext || !runtime.serviceWorkerSupported) {
    return { ok: false, reason: 'unsupported', serviceWorkerReady: false };
  }
  if (runtime.permission !== 'granted') {
    return { ok: false, reason: 'permission', serviceWorkerReady: false };
  }

  let registration: DesktopNotificationRegistration | undefined;
  try {
    registration = await runtime.getRegistration();
  } catch (error) {
    return {
      ok: false,
      reason: 'service-worker-not-ready',
      serviceWorkerReady: false,
      ...sanitizedErrorDetails(error),
    };
  }
  if (!registration?.active) {
    return { ok: false, reason: 'service-worker-not-ready', serviceWorkerReady: false };
  }

  let readyRegistration: DesktopNotificationRegistration | undefined;
  try {
    readyRegistration = await waitForReadyRegistration(runtime.ready(), readyTimeoutMs);
  } catch (error) {
    return {
      ok: false,
      reason: 'service-worker-not-ready',
      serviceWorkerReady: false,
      ...sanitizedErrorDetails(error),
    };
  }
  if (!readyRegistration?.active) {
    return { ok: false, reason: 'service-worker-not-ready', serviceWorkerReady: false };
  }

  try {
    await readyRegistration.showNotification(title, options);
    return { ok: true, method: 'service-worker', serviceWorkerReady: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'show-notification-failed',
      serviceWorkerReady: true,
      ...sanitizedErrorDetails(error),
    };
  }
};
