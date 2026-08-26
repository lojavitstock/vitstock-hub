export type ContactListState = {
  archived_at?: string | Date | null;
  merged_into_contact_id?: string | null;
};

/** Contacts hidden from the default list remain available when archived is explicit. */
export function isContactVisibleInList(contact: ContactListState, includeArchived: boolean) {
  return includeArchived || (!contact.archived_at && !contact.merged_into_contact_id);
}

/** SQL predicate shared by count and data queries for the default list. */
export function contactArchiveWhereClause(includeArchived: boolean) {
  return includeArchived ? '' : 'c.archived_at IS NULL AND c.merged_into_contact_id IS NULL';
}
