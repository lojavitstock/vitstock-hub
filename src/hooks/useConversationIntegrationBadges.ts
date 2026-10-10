import { useEffect, useState } from 'react';
import { fetchBlingContactExistence, fetchGoogleContactStatus } from '../services/contactIntegrationStatus';

export type IntegrationBadgeState = 'checking' | 'found' | 'not_found' | 'unavailable' | 'not_applicable';
export type ConversationIntegrationBadges = { google: IntegrationBadgeState; bling: IntegrationBadgeState };

export function useConversationIntegrationBadges(input: {
  companyId?: string;
  conversationId?: string;
  phone?: string;
  isGroup?: boolean;
}): ConversationIntegrationBadges {
  const [state, setState] = useState<ConversationIntegrationBadges>({ google: 'checking', bling: 'checking' });

  useEffect(() => {
    if (!input.conversationId) {
      setState({ google: 'not_applicable', bling: 'not_applicable' });
      return;
    }
    if (input.isGroup || !input.phone?.trim() || !input.companyId) {
      setState({ google: 'not_applicable', bling: 'not_applicable' });
      return;
    }
    let current = true;
    setState({ google: 'checking', bling: 'checking' });
    void Promise.allSettled([
      fetchGoogleContactStatus(input.companyId, input.phone),
      fetchBlingContactExistence(input.companyId, input.phone),
    ]).then(([googleResult, blingResult]) => {
      if (!current) return;
      const google = googleResult.status === 'fulfilled'
        ? !googleResult.value.connected ? 'unavailable' : googleResult.value.saved ? 'found' : 'not_found'
        : 'unavailable';
      const bling = blingResult.status === 'fulfilled'
        ? blingResult.value.status === 'found' ? 'found' : blingResult.value.status === 'not_found' ? 'not_found' : 'unavailable'
        : 'unavailable';
      setState({ google, bling });
    });
    return () => { current = false; };
  }, [input.companyId, input.conversationId, input.isGroup, input.phone]);

  return state;
}
