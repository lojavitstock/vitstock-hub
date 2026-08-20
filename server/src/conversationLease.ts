import type { PoolClient } from 'pg';

export const CONVERSATION_LEASE_SECONDS = 5 * 60;

type LeaseQueryClient = Pick<PoolClient, 'query'>;

type LeaseRow = {
  acquired: boolean;
  owner_user_id: string;
  owner_name: string;
  expires_at: Date | string;
};

export type ConversationLease = {
  ownerUserId: string;
  ownerName: string;
  expiresAt: string;
};

export type LeaseAcquisition = {
  acquired: boolean;
  lease: ConversationLease;
};

export const isLeaseActive = (lease: Pick<ConversationLease, 'expiresAt'>, now = Date.now()) => (
  Date.parse(lease.expiresAt) > now
);

/**
 * The conditional UPSERT is the concurrency boundary: PostgreSQL serializes
 * competing writes for the same (company, conversation) primary key.
 */
export async function acquireConversationLease(
  client: LeaseQueryClient,
  input: {
    companyId: string;
    conversationId: string;
    userId: string;
    force?: boolean;
  },
): Promise<LeaseAcquisition> {
  const result = await client.query<LeaseRow>(
    `WITH attempted AS (
       INSERT INTO conversation_leases (company_id, conversation_id, owner_user_id, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, now() + ($4::integer * interval '1 second'))
       ON CONFLICT (company_id, conversation_id) DO UPDATE
       SET owner_user_id = EXCLUDED.owner_user_id,
           expires_at = now() + ($4::integer * interval '1 second'),
           updated_at = now()
       WHERE conversation_leases.expires_at <= now()
          OR conversation_leases.owner_user_id = EXCLUDED.owner_user_id
          OR $5::boolean
       RETURNING true AS acquired, owner_user_id, expires_at
     ), outcome AS (
       SELECT acquired, owner_user_id, expires_at FROM attempted
       UNION ALL
       SELECT false AS acquired, lease.owner_user_id, lease.expires_at
       FROM conversation_leases lease
       WHERE lease.company_id = $1::uuid
         AND lease.conversation_id = $2::uuid
         AND NOT EXISTS (SELECT 1 FROM attempted)
     )
     SELECT outcome.acquired, outcome.owner_user_id, users.name AS owner_name, outcome.expires_at
     FROM outcome
     JOIN users ON users.id = outcome.owner_user_id
     LIMIT 1`,
    [
      input.companyId,
      input.conversationId,
      input.userId,
      CONVERSATION_LEASE_SECONDS,
      Boolean(input.force),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('N\u00e3o foi poss\u00edvel determinar a posse da conversa');

  return {
    acquired: row.acquired,
    lease: {
      ownerUserId: row.owner_user_id,
      ownerName: row.owner_name,
      expiresAt: new Date(row.expires_at).toISOString(),
    },
  };
}

/** Mirrors the conditional UPSERT rule for deterministic unit tests. */
export const canAcquireConversationLease = (
  current: { ownerUserId: string; expiresAt: string } | undefined,
  userId: string,
  now = Date.now(),
  force = false,
) => !current || !isLeaseActive(current, now) || current.ownerUserId === userId || force;
