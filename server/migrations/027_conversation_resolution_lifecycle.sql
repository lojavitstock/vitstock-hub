ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

UPDATE conversations AS c
SET status = cs.status,
    resolved_at = CASE WHEN cs.status = 'resolved' THEN COALESCE(cs.updated_at, now()) ELSE NULL END
FROM conversation_statuses AS cs
WHERE cs.company_id = c.company_id
  AND cs.evolution_remote_jid = c.evolution_remote_jid
  AND (c.status IS DISTINCT FROM cs.status OR (cs.status = 'resolved' AND c.resolved_at IS NULL));

UPDATE conversations
SET resolved_at = now()
WHERE status = 'resolved' AND resolved_at IS NULL;
