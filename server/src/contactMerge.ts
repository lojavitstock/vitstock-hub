type MergeableContact = { merged_into_contact_id?: string | null };

export function canMergeContacts(source: MergeableContact | undefined, target: MergeableContact | undefined): boolean {
  return Boolean(source && target && !source.merged_into_contact_id && !target.merged_into_contact_id);
}
