const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The Evolution payload retains the human-readable sender signature. */
export const formatHubOutboundText = (authorName: string, content: string) => {
  const author = authorName.trim();
  return author ? `*${author}*\n${content}` : content;
};

/** Removes only the server-generated leading signature from a Hub message. */
export const removeHubAgentPrefix = (content: string, authorName?: string) => {
  const author = authorName?.trim();
  if (!author) return content;
  return content.replace(new RegExp(`^\\*${escapeRegExp(author)}\\*\\r?\\n`), '');
};
