export type GoogleSidebarState = 'not_connected' | 'connected' | 'reconnect_required' | 'syncing' | 'error';

export const GOOGLE_INTEGRATION_SETTINGS_PATH = '/configuracoes?tab=integracoes';

export function googleSidebarIndicator(state: GoogleSidebarState) {
  if (state === 'connected') return { label: 'Google Contacts conectado', icon: 'cloud' as const, tone: 'connected' as const };
  if (state === 'syncing') return { label: 'Google Contacts sincronizando', icon: 'sync' as const, tone: 'syncing' as const };
  if (state === 'reconnect_required') return { label: 'Reconexão do Google Contacts necessária', icon: 'offline' as const, tone: 'error' as const };
  if (state === 'error') return { label: 'Erro no Google Contacts', icon: 'offline' as const, tone: 'error' as const };
  return { label: 'Google Contacts não conectado', icon: 'offline' as const, tone: 'idle' as const };
}
