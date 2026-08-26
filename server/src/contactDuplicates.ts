export type DuplicateEvidenceKind = 'phone' | 'email';

export type DuplicateEvidence = {
  kind: DuplicateEvidenceKind;
  key: string;
  value?: string;
};

export type DuplicateSource = {
  contactId: string;
  kind: DuplicateEvidenceKind;
  key: string;
  value?: string;
};

export type DuplicateDecision = {
  contactAId: string;
  contactBId: string;
  decision: 'different' | 'merged';
};

export type DuplicateGroup<T extends { id: string }> = {
  id: string;
  key: string;
  kind: DuplicateEvidenceKind | 'multiple';
  reason: string;
  evidence: DuplicateEvidence[];
  contacts: T[];
  differentPairs: Array<[string, string]>;
  unresolvedPairCount: number;
};

function pairKey(a: string, b: string) {
  return [a, b].sort().join(':');
}

type ContactIdentityMetadata = {
  source?: string | null;
  google_resource_name?: string | null;
  google_saved?: boolean;
  whatsapp_linked?: boolean;
};

function isGoogleContact(contact: ContactIdentityMetadata | undefined) {
  return Boolean(contact?.google_saved || contact?.google_resource_name || contact?.source === 'google');
}

function isWhatsappPrincipal(contact: ContactIdentityMetadata | undefined) {
  return Boolean(
    contact
    && !isGoogleContact(contact)
    && (contact.source === 'hub' || contact.source === 'whatsapp')
    && contact.whatsapp_linked,
  );
}

/** Hub and Google rows with the same evidence are one identity, not a review duplicate. */
export function isHubGoogleSameIdentity(first: ContactIdentityMetadata | undefined, second: ContactIdentityMetadata | undefined) {
  return (isGoogleContact(first) && isWhatsappPrincipal(second))
    || (isGoogleContact(second) && isWhatsappPrincipal(first));
}

/** Builds review groups without deciding or merging contacts. */
export function buildDuplicateGroups<T extends { id: string }>(
  contacts: T[],
  sources: DuplicateSource[],
  decisions: DuplicateDecision[] = [],
): DuplicateGroup<T>[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id);
    if (!current) {
      parent.set(id, id);
      return id;
    }
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (const contact of contacts) find(contact.id);
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const sourceGroups = new Map<string, string[]>();
  for (const source of sources) {
    if (!source.key || !parent.has(source.contactId)) continue;
    const key = `${source.kind}:${source.key}`;
    const ids = sourceGroups.get(key) || [];
    if (!ids.includes(source.contactId)) ids.push(source.contactId);
    sourceGroups.set(key, ids);
  }
  for (const ids of sourceGroups.values()) {
    for (let index = 0; index < ids.length; index += 1) {
      for (let next = index + 1; next < ids.length; next += 1) {
        if (!isHubGoogleSameIdentity(contactsById.get(ids[index]!) as ContactIdentityMetadata, contactsById.get(ids[next]!) as ContactIdentityMetadata)) {
          union(ids[index]!, ids[next]!);
        }
      }
    }
  }

  const groups = new Map<string, { ids: Set<string>; evidence: Map<string, DuplicateEvidence> }>();
  for (const [sourceKey, ids] of sourceGroups.entries()) {
    const [kind, ...keyParts] = sourceKey.split(':');
    const key = keyParts.join(':');
    for (const id of ids) {
      const root = find(id);
      const group = groups.get(root) || { ids: new Set<string>(), evidence: new Map<string, DuplicateEvidence>() };
      group.ids.add(id);
      const source = sources.find((item) => item.kind === kind && item.key === key && item.contactId === id)
        || sources.find((item) => item.kind === kind && item.key === key);
      group.evidence.set(sourceKey, { kind: kind as DuplicateEvidenceKind, key, value: source?.value });
      groups.set(root, group);
    }
  }

  const decisionMap = new Map<string, DuplicateDecision['decision']>();
  for (const decision of decisions) decisionMap.set(pairKey(decision.contactAId, decision.contactBId), decision.decision);
  const result: DuplicateGroup<T>[] = [];

  for (const group of groups.values()) {
    const ids = Array.from(group.ids).sort();
    if (ids.length < 2) continue;
    const differentPairs: Array<[string, string]> = [];
    let unresolvedPairCount = 0;
    for (let index = 0; index < ids.length; index += 1) {
      for (let next = index + 1; next < ids.length; next += 1) {
        const a = ids[index]!;
        const b = ids[next]!;
        if (decisionMap.get(pairKey(a, b)) === 'different') differentPairs.push([a, b]);
        else unresolvedPairCount += 1;
      }
    }
    if (!unresolvedPairCount) continue;
    const evidence = Array.from(group.evidence.values());
    const kinds = new Set(evidence.map((item) => item.kind));
    const kind = kinds.size > 1 ? 'multiple' : (evidence[0]?.kind || 'phone');
    const reason = kinds.size > 1 ? 'Múltiplas evidências' : kind === 'email' ? 'Mesmo e-mail' : 'Mesmo telefone';
    result.push({
      id: `duplicate-${ids.join('-')}`,
      key: evidence[0]?.key || ids.join('-'),
      kind,
      reason,
      evidence,
      contacts: ids.map((id) => contactsById.get(id)).filter((contact): contact is T => Boolean(contact)),
      differentPairs,
      unresolvedPairCount,
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
