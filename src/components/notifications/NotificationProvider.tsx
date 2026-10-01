import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ContactPhoto } from '../conversations/ContactPhoto';
import { EvolutionApiService, type EvolutionRealtimeEvent } from '../../services/evolutionApi';
import type { Conversation } from '../../types';
import {
  buildConversationNavigationTarget,
  chooseNotificationPresentation,
  createCrossTabMessageNotificationDeduper,
  createMessageNotificationDeduper,
  fingerprintNotificationMessageId,
  getNotificationConversationId,
  getNotificationPreview,
  isNotifiableInboundMessage,
  notificationPermissionAllowsDesktop,
} from '../../utils/messageNotification';
import { playNotificationSound } from '../../utils/notificationSound';
import { createInstallPromptController, type DeferredInstallPrompt } from '../../utils/pwaInstall';

type NotificationPermissionState = NotificationPermission | 'unsupported';
type InstallState = 'installed' | 'available' | 'unavailable';

type NewMessageToastData = {
  id: string;
  conversationId: string;
  title: string;
  body: string;
  avatar?: string;
};

type NotificationContextValue = {
  permissionState: NotificationPermissionState;
  requestNotificationPermission: () => Promise<NotificationPermissionState>;
  installState: InstallState;
  installApp: () => Promise<void>;
  setActiveConversationId: (conversationId: string | null) => void;
  registerConversations: (conversations: Conversation[]) => void;
  openConversation: (conversationId: string) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

const safeDisplayName = (value: string | undefined, fallback = 'Nova mensagem') => {
  const name = value?.trim();
  if (!name || name.length > 120 || /@(?:lid|s\.whatsapp\.net|c\.us|g\.us)$/i.test(name) || /^\+?[\d\s().-]+$/.test(name)) {
    return fallback;
  }
  return name;
};

const getNotificationStorage = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const readPermission = (): NotificationPermissionState => {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
};

export const useNotifications = () => {
  const value = useContext(NotificationContext);
  if (!value) throw new Error('useNotifications deve ser usado dentro de NotificationProvider');
  return value;
};

export const NotificationProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [permissionState, setPermissionState] = useState<NotificationPermissionState>(readPermission);
  const [standalone, setStandalone] = useState(false);
  const [installRevision, setInstallRevision] = useState(0);
  const [toasts, setToasts] = useState<NewMessageToastData[]>([]);
  const permissionStateRef = useRef(permissionState);
  const activeConversationIdRef = useRef<string | null>(null);
  const conversationsRef = useRef(new Map<string, { name: string; avatar?: string; isGroup: boolean }>());
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null);
  const messageDeduperRef = useRef(createMessageNotificationDeduper());
  const crossTabDeduperRef = useRef(createCrossTabMessageNotificationDeduper(getNotificationStorage()));
  const installControllerRef = useRef<ReturnType<typeof createInstallPromptController> | null>(null);

  if (!installControllerRef.current) {
    installControllerRef.current = createInstallPromptController(() => setInstallRevision((revision) => revision + 1));
  }
  const installController = installControllerRef.current;
  permissionStateRef.current = permissionState;

  const openConversation = useCallback((conversationId: string) => {
    if (!conversationId.trim()) return;
    navigate(buildConversationNavigationTarget(conversationId));
  }, [navigate]);

  const setActiveConversationId = useCallback((conversationId: string | null) => {
    activeConversationIdRef.current = conversationId;
  }, []);

  const registerConversations = useCallback((conversations: Conversation[]) => {
    const directory = conversationsRef.current;
    for (const conversation of conversations) {
      directory.set(conversation.id, {
        name: conversation.isGroup
          ? conversation.groupName || conversation.contact.name
          : conversation.contact.name,
        avatar: conversation.isGroup
          ? conversation.groupAvatar || conversation.contact.avatar
          : conversation.contact.avatar,
        isGroup: Boolean(conversation.isGroup),
      });
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: NewMessageToastData) => {
    setToasts((current) => [...current.filter((item) => item.id !== toast.id), toast].slice(-3));
  }, []);

  const requestNotificationPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermissionState('unsupported');
      return 'unsupported';
    }
    try {
      const nextPermission = await window.Notification.requestPermission();
      setPermissionState(nextPermission);
      return nextPermission;
    } catch {
      const currentPermission = readPermission();
      setPermissionState(currentPermission);
      return currentPermission;
    }
  }, []);

  const installApp = useCallback(async () => {
    try {
      await installController.promptInstall();
    } catch {
      installController.clear();
    }
  }, [installController]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(display-mode: standalone)');
    const syncStandalone = (matches: boolean) => {
      setStandalone(matches);
      if (matches) installController.markInstalled();
    };
    syncStandalone(query.matches);
    const onChange = (event: MediaQueryListEvent) => syncStandalone(event.matches);
    query.addEventListener?.('change', onChange);
    if (!query.addEventListener) query.addListener(onChange);
    return () => {
      query.removeEventListener?.('change', onChange);
      if (!query.removeEventListener) query.removeListener(onChange);
    };
  }, [installController]);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      installController.capture(event as Event & DeferredInstallPrompt);
    };
    const onInstalled = () => {
      setStandalone(true);
      installController.markInstalled();
    };
    const syncPermission = () => setPermissionState(readPermission());
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('focus', syncPermission);
    document.addEventListener('visibilitychange', syncPermission);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('focus', syncPermission);
      document.removeEventListener('visibilitychange', syncPermission);
    };
  }, [installController]);

  useEffect(() => {
    if (!(import.meta.env.PROD || import.meta.env.MODE === 'qa')) return undefined;
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return undefined;
    let cancelled = false;
    void navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (!cancelled) serviceWorkerRef.current = registration;
      })
      .catch(() => {
        // SW failure must never block authentication or ordinary Hub use.
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onServiceWorkerMessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== 'object') return;
      const payload = event.data as { type?: unknown; conversationId?: unknown };
      if (payload.type === 'vitstock:open-conversation' && typeof payload.conversationId === 'string') {
        openConversation(payload.conversationId);
      }
    };
    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
  }, [openConversation]);

  useEffect(() => {
    if (!user?.id) {
      setToasts([]);
      activeConversationIdRef.current = null;
      return undefined;
    }

    const processInboundMessage = async (event: EvolutionRealtimeEvent) => {
      if (!isNotifiableInboundMessage(event) || !messageDeduperRef.current.shouldNotify(event.message)) return;

      const fingerprint = await fingerprintNotificationMessageId(event.message.id);
      if (fingerprint) {
        const locks = (navigator as Navigator & {
          locks?: { request<T>(name: string, callback: () => T | Promise<T>): Promise<T> };
        }).locks;
        const claim = () => crossTabDeduperRef.current.shouldNotify(fingerprint);
        let claimed: boolean;
        try {
          claimed = locks
            ? await locks.request('vitstock-message-notification', claim)
            : claim();
        } catch {
          // Web Locks only improves cross-tab coordination; it must not block a notification.
          claimed = claim();
        }
        if (!claimed) return;
      }

      playNotificationSound();
      const conversationId = getNotificationConversationId(event);
      if (!conversationId) return;

      const directoryEntry = conversationsRef.current.get(conversationId);
      const isGroup = directoryEntry?.isGroup ?? conversationId.endsWith('@g.us');
      const displayName = safeDisplayName(
        directoryEntry?.name || (!isGroup ? event.message.senderName : undefined),
      );
      const toast: NewMessageToastData = {
        id: event.message.id,
        conversationId,
        title: displayName,
        body: getNotificationPreview(event.message),
        avatar: directoryEntry?.avatar || undefined,
      };
      const presentation = chooseNotificationPresentation({
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
        activeConversationId: activeConversationIdRef.current,
        notificationConversationId: conversationId,
      });

      if (presentation === 'toast') {
        showToast(toast);
        return;
      }
      if (presentation !== 'desktop' || !notificationPermissionAllowsDesktop(permissionStateRef.current) || !('Notification' in window)) return;

      const options: NotificationOptions = {
        body: toast.body,
        icon: toast.avatar || '/icons/vitstock-icon-192.png',
        badge: '/icons/vitstock-icon-192.png',
        tag: fingerprint ? `vitstock-${fingerprint}` : undefined,
        data: { conversationId },
      };
      try {
        const registration = serviceWorkerRef.current;
        if (registration) {
          await registration.showNotification(toast.title, options);
        } else {
          const notification = new window.Notification(toast.title, options);
          notification.onclick = () => {
            notification.close();
            window.focus();
            openConversation(conversationId);
          };
        }
      } catch {
        // Permission or OS notification failures do not affect the inbox.
      }
    };

    return EvolutionApiService.subscribeToRealtimeEvents((event) => {
      void processInboundMessage(event);
    });
  }, [openConversation, showToast, user?.id]);

  const installState: InstallState = standalone || installController.isInstalled()
    ? 'installed'
    : installController.canInstall() ? 'available' : 'unavailable';
  // installRevision makes the controller's in-memory event state observable to React.
  void installRevision;

  const value = useMemo<NotificationContextValue>(() => ({
    permissionState,
    requestNotificationPermission,
    installState,
    installApp,
    setActiveConversationId,
    registerConversations,
    openConversation,
  }), [installApp, installState, openConversation, permissionState, registerConversations, requestNotificationPermission, setActiveConversationId]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NewMessageToast toasts={toasts} onOpen={openConversation} onDismiss={dismissToast} />
    </NotificationContext.Provider>
  );
};

const NewMessageToast: React.FC<{
  toasts: NewMessageToastData[];
  onOpen: (conversationId: string) => void;
  onDismiss: (id: string) => void;
}> = ({ toasts, onOpen, onDismiss }) => (
  <div className="fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite" aria-relevant="additions text">
    {toasts.map((toast) => (
      <NewMessageToastItem key={toast.id} toast={toast} onOpen={onOpen} onDismiss={onDismiss} />
    ))}
  </div>
);

const NewMessageToastItem: React.FC<{
  toast: NewMessageToastData;
  onOpen: (conversationId: string) => void;
  onDismiss: (id: string) => void;
}> = ({ toast, onOpen, onDismiss }) => {
  useEffect(() => {
    const timeout = window.setTimeout(() => onDismiss(toast.id), 6500);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast.id]);

  return (
    <div className="flex items-start gap-2 rounded-xl border border-zinc-700 bg-[#11181d] p-3 shadow-2xl shadow-black/50 ring-1 ring-amber-400/15">
      <button
        type="button"
        aria-label={`Abrir conversa: ${toast.title}`}
        onClick={() => {
          onDismiss(toast.id);
          onOpen(toast.conversationId);
        }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        <ContactPhoto name={toast.title} avatar={toast.avatar} size="small" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-zinc-100">{toast.title}</span>
          <span className="mt-0.5 block line-clamp-2 break-words text-xs text-zinc-300">{toast.body}</span>
        </span>
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Fechar notificação"
        onClick={() => onDismiss(toast.id)}
        className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
};
