import { phoneIdentityKeys } from './contactDomain.js';

export type GoogleContactCandidate = {
  id: string;
  source?: string | null;
  manualOverride?: Record<string, unknown> | null;
  hasWhatsappIdentity: boolean;
  hasWhatsappPhone: boolean;
  googleResourceName?: string | null;
  conversationCount?: number;
};

export type GooglePhoneMatchDecision = 'linked' | 'safe_reconcile' | 'safe_reconcile_linked' | 'create' | 'ambiguous';

/**
 * Decides whether a Google person can reuse a local WhatsApp contact.
 * Phone equality is only an eligibility signal; it never authorizes a merge
 * when provenance or cardinality is ambiguous.
 */
export function classifyGooglePhoneMatch(input: {
  candidates: GoogleContactCandidate[];
  googlePersonCount: number;
  resourceName?: string;
}): GooglePhoneMatchDecision {
  const linked = input.candidates.filter((candidate) => (
    Boolean(input.resourceName)
    && candidate.googleResourceName === input.resourceName
  ));
  if (linked.length > 1) return 'ambiguous';
  if (input.googlePersonCount !== 1) return 'ambiguous';
  if (linked.length === 1) {
    const additional = input.candidates.filter((candidate) => candidate.id !== linked[0]!.id);
    const provisional = additional.filter(isProvisionalWhatsapp);
    // A linked Google row can be a duplicate created before WhatsApp identity
    // reconciliation existed. Only the exact one-Google-only + one-provisional
    // shape is safe to consolidate automatically. A row that already carries
    // Hub/WhatsApp provenance must never be archived implicitly.
    const linkedIsGoogleOnly = linked[0]!.source === 'google'
      && !linked[0]!.hasWhatsappIdentity
      && !linked[0]!.hasWhatsappPhone;
    if (additional.length === 1 && provisional.length === 1 && linkedIsGoogleOnly) return 'safe_reconcile_linked';
    return additional.length ? 'ambiguous' : 'linked';
  }
  if (input.candidates.length === 0) return 'create';
  if (input.candidates.length !== 1) return 'ambiguous';

  const candidate = input.candidates[0]!;
  return isProvisionalWhatsapp(candidate) ? 'safe_reconcile' : 'ambiguous';
}

export function isProvisionalWhatsapp(candidate: GoogleContactCandidate) {
  const hasManualOverride = Boolean(candidate.manualOverride && Object.keys(candidate.manualOverride).length);
  // Evolution-created contacts historically used both the contacts.source
  // default ('hub') and the explicit 'whatsapp' value. Older rows were
  // backfilled as 'system'; they are eligible only with explicit WhatsApp
  // evidence and a persisted conversation, never by source alone.
  const legacySystemWhatsapp = candidate.source === 'system'
    && (candidate.conversationCount || 0) > 0;
  return (candidate.source === 'hub' || candidate.source === 'whatsapp' || legacySystemWhatsapp)
    && (candidate.hasWhatsappIdentity || candidate.hasWhatsappPhone)
    && !hasManualOverride
    && !candidate.googleResourceName;
}

export function googlePhoneKey(value: string) {
  return phoneIdentityKeys(value, { defaultCountry: 'BR' })
    .find((key) => key.startsWith('+'))
    || phoneIdentityKeys(value, { defaultCountry: 'BR' })[0]
    || '';
}
