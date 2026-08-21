import { phoneIdentityKeys } from './contactDomain.js';

export type GoogleContactCandidate = {
  id: string;
  source?: string | null;
  manualOverride?: Record<string, unknown> | null;
  hasWhatsappIdentity: boolean;
  hasWhatsappPhone: boolean;
  googleResourceName?: string | null;
};

export type GooglePhoneMatchDecision = 'linked' | 'safe_reconcile' | 'create' | 'ambiguous';

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
  if (linked.length === 1) return 'linked';
  if (linked.length > 1) return 'ambiguous';
  if (input.googlePersonCount !== 1) return 'ambiguous';
  if (input.candidates.length === 0) return 'create';
  if (input.candidates.length !== 1) return 'ambiguous';

  const candidate = input.candidates[0]!;
  const hasManualOverride = Boolean(candidate.manualOverride && Object.keys(candidate.manualOverride).length);
  const isProvisionalWhatsapp = candidate.source === 'hub'
    && (candidate.hasWhatsappIdentity || candidate.hasWhatsappPhone)
    && !hasManualOverride
    && !candidate.googleResourceName;
  return isProvisionalWhatsapp ? 'safe_reconcile' : 'ambiguous';
}

export function googlePhoneKey(value: string) {
  return phoneIdentityKeys(value, { defaultCountry: 'BR' })
    .find((key) => key.startsWith('+'))
    || phoneIdentityKeys(value, { defaultCountry: 'BR' })[0]
    || '';
}
