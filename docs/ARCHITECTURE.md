# Vitstock Hub — Architecture

> **Integration flow:** new work starts from `origin/preview` in a dedicated `feature/*`, `fix/*` or `chore/*` branch unless the task explicitly specifies otherwise. PRs integrate work into `preview` for pre-production deployment and human validation; a separate PR from `preview` to `main` promotes Production only after technical gates, human validation and an explicit promotion decision. Development does not occur directly on either integration branch.
>
> When investigating implementation details, confirm behavior in the source code, migrations and tests.

## 1. Purpose

Vitstock Hub is an internal application for shared WhatsApp customer service and commercial operations. Its technical center is the **Atendimento** module: a shared inbox, conversation timeline and message composer backed by PostgreSQL and an Evolution API instance.

The architecture is designed to keep the service usable when the provider is slow or when realtime events are duplicated, delayed or temporarily missed:

- PostgreSQL persists application state and received messages.
- Evolution API provides the WhatsApp connection and provider data.
- Server-Sent Events (SSE) distribute server-side changes to connected browsers.
- Periodic polling remains a reconciliation fallback rather than the primary realtime mechanism.

## 2. High-Level Architecture

```text
Browser (React + Vite)
   │  HTTPS fetch with session cookie / EventSource with credentials
   ▼
Vitstock Hub API (Fastify, Node.js)
   ├── PostgreSQL
   │     ├── application state, users and sessions
   │     ├── conversations and persisted messages
   │     └── Google Contacts and operational state
   ├── SSE clients grouped by company
   └── Evolution API
          ├── WhatsApp connection / QR code
          ├── chats, contacts and message history
          └── webhook events
                 │
                 ▼
             WhatsApp
```

The frontend is deployed as a Vite static application. The backend is a separate Fastify service. The source tree also contains a local PostgreSQL Docker Compose definition, but normal local development can point at the services configured in `.env.local`.

## 3. Repository Structure

```text
src/                         React frontend
  auth/                      Session context
  components/                Layout and Atendimento UI
  hooks/                     Inbox, message timeline and contact-panel state
  pages/                     Route-level views
  services/                  HTTP/Evolution adapters
  utils/                     Reconciliation, cache, media, scroll and UI helpers
  types/                     Shared frontend domain types

server/                      Fastify backend
  src/
    app.ts                   Fastify setup, CORS, cookies and global errors
    auth.ts                  Authentication and team-management routes
    evolution.ts             Evolution, inbox, message and webhook routes
    google-contacts.ts       Google Contacts integration and contact routes
    realtime.ts              In-memory SSE fan-out
    db.ts                    PostgreSQL pool
    security/                Password, session and encryption helpers
    scripts/                 Migration and administrator seed scripts
  migrations/                Ordered PostgreSQL migrations
  railway.json               Railway build, migration and start commands

tests/                       Node test runner and core regression suite
scripts/dev-local.mjs        Starts frontend and backend for local development
vite.config.ts               Vite development configuration
vercel.json                  SPA rewrite for Vercel
docker-compose.yml           Optional local PostgreSQL service
```

## 4. Frontend Architecture

### Entrypoints and routing

`src/main.tsx` mounts React in `StrictMode`, wraps the application with `AuthProvider`, and loads global CSS. `src/App.tsx` uses `BrowserRouter` and redirects an authenticated root route to `/atendimento`.

Current authenticated routes include:

- `/atendimento` — shared WhatsApp service workspace;
- `/contatos` — contacts;
- `/campanhas` — campaigns;
- `/configuracoes` — settings, team, password and WhatsApp connection;
- `/conexoes` — compatibility redirect to Settings → connection tab.

`AppLayout` provides the icon sidebar and polls the WhatsApp connection status for the shared application shell.

### Authentication state

`src/auth/AuthContext.tsx` owns the signed-in user state. It requests `/api/auth/me` at startup, performs login/logout through `apiRequest`, and exposes the authenticated user to routed pages.

The browser does not store a bearer token. Requests use `credentials: 'include'`; the server session cookie is the authentication credential.

### PWA and in-app notifications

`src/components/notifications/NotificationProvider.tsx` is mounted under `BrowserRouter` and owns browser installation state, explicit notification permission, the single authenticated notification listener, sound/visual decisions, and a small foreground toast queue. It subscribes through `EvolutionApiService.subscribeToRealtimeEvents`, which multiplexes listeners over the existing EventSource singleton; it does not create another SSE connection. Inbound notification targets use only the explicit message conversation ID or event `remoteJid`, never a display phone or inferred alias. A bounded same-origin `localStorage` ledger of SHA-256 message-ID fingerprints deduplicates outputs across browser tabs. The manifest uses an origin-scoped app ID, so Preview and Production remain separate installations even when their labels match. Desktop notifications use the active `ServiceWorkerRegistration.showNotification()` after permission and `navigator.serviceWorker.ready` checks; the settings test button uses the same path and reports API-level success or failure without blocking message handling.

The explicit `public/manifest.webmanifest` and `public/sw.js` provide install metadata, notification-click focus/navigation, and a network-only passthrough for document navigations. The worker does not intercept subresource/API/EventSource requests and does not use CacheStorage or provide offline behavior. The `beforeinstallprompt` and `appinstalled` listeners attach in `src/main.tsx` before React mounts so the prompt event is not lost before a component effect runs. Notification permission is requested only from the Application settings button. This phase has no Web Push, backend delivery, subscription persistence, or guaranteed notification when the Hub is fully closed; realtime notifications require an open or minimized connected Hub window.

### HTTP communication

`src/services/api.ts` is the general API helper. `src/services/evolutionApi.ts` contains the more specific service methods and adapters for Atendimento.

- API base URL: `VITE_API_URL`, defaulting to `http://localhost:3001`.
- Browser fetches include cookies.
- General requests time out after 20 seconds; Evolution-specific browser requests use a 30-second timeout.
- Errors are surfaced to callers rather than converted to false successes.

`VITE_*` variables are public build-time values. They must never contain provider keys, database URLs or session secrets.

## 5. Backend Architecture

### Runtime and composition

The backend is **Fastify**, not Express. `server/src/index.ts` creates the application using `createApp()` and listens on `0.0.0.0` using `PORT` from `server/src/config.ts`.

`server/src/app.ts` composes:

- Fastify structured logging and request size limits;
- `@fastify/cors` with credentials;
- `@fastify/cookie`;
- request user loading;
- origin validation for state-changing `/api/` requests;
- `/health` database health check;
- authentication, Evolution and Google Contacts route registration;
- a global error handler.

The global handler returns a safe client error while logging diagnostic fields server-side. Its temporary plain-text diagnostic line is intentionally restricted to error and route metadata, not request payloads or credentials.

### Route modules

The backend currently uses route-oriented modules rather than a separate controller/service directory:

- `server/src/auth.ts` — login, logout, current user, password change and administrator-only team routes;
- `server/src/evolution.ts` — WhatsApp status/QR, chats, messages, notes, media, reactions, leasing, provider webhook and SSE endpoint;
- `server/src/google-contacts.ts` — OAuth connection, synchronization and contact data routes.

This is a deliberate description of the current layout, not a recommendation to reorganize it.

### PostgreSQL access

`server/src/db.ts` exposes one `pg.Pool`. Pool size and timeout are bounded through environment variables so overlapping deploys or Railway limits do not create unbounded connections. In production, PostgreSQL SSL uses `rejectUnauthorized: false` for the configured hosted database.

## 6. Database and Migrations

### Migration process

Migrations live in `server/migrations/` and are applied in filename order by `server/src/scripts/migrate.ts`.

The migration runner:

1. creates `schema_migrations` if necessary;
2. skips migration files already recorded by filename;
3. runs each pending SQL file and its `schema_migrations` insert in one transaction;
4. rolls back that migration if it fails.

`server/railway.json` runs `node dist/scripts/migrate.js` as `preDeployCommand`. The script's source is compiled because the server TypeScript configuration emits `dist/scripts/migrate.js`.

The current migration sequence also includes:

- `018_conversation_tags.sql` — conversation-scoped tags and their links, including tenant-scoped uniqueness and indexes;
- `019_evolution_message_staging.sql` — tenant-scoped staging for provider messages awaiting processing, with expiry and attempt tracking;
- `020_quick_replies.sql` — company/user quick replies, shortcuts, ordering, usage counts and active-state constraints;
- `021_product_library.sql` — company-scoped product metadata and message-product snapshot references. The reference table enforces that both the message and product belong to the same company.

### Main entities

The schema is company-scoped. The important tables are:

| Area | Tables | Notes |
| --- | --- | --- |
| Organization and access | `companies`, `users`, `sessions` | Users have `admin` or `attendant` roles; sessions store only a token HMAC. |
| Contacts and conversations | `contacts`, `contact_phones`, `contact_emails`, `contact_channel_identities`, `conversations` | Contacts are company-scoped profiles; channel identities and additional phones/emails are separate values. A conversation is keyed per company by `evolution_remote_jid`, including LIDs and groups, and is never selected only by `contact_id`. |
| Contact operations | `contact_tags`, `contact_tag_links`, `contact_duplicate_decisions`, `contact_merge_operations`, `contact_merge_conversations`, `contact_audit_logs`, `contact_import_jobs`, `contact_import_rows` | Migration 016 adds persistent tags, archive/merge lineage, append-only audit records and resumable CSV import records. Administrative operations remain company-scoped and backend-enforced. |
| Message history | `messages` | Provider message ID is unique per company; `metadata` is JSONB for message-scoped details. |
| Provider webhook processing | `webhook_events` | Deduplicates provider event keys. |
| Google Contacts | `google_connections` and Google-related fields on `contacts` | OAuth token material is stored encrypted by the backend integration; migration 017 adds persisted sync state, last-sync summary and a safe error message for the administrative integration card. |
| Operational conversation state | `conversation_assignments`, `conversation_statuses`, `conversation_read_states`, `conversation_daily_responders`, `conversation_notes`, `conversation_leases` | These are scoped by company and Evolution JID or conversation. |
| Provider contact cache | `whatsapp_contact_names` | Stores provider names and avatars independently of Google contact data. |
| Product library | `products`, `message_product_refs` | Company-scoped catalog metadata and immutable product/price/image-key snapshots inserted atomically with local outbound messages. |

`messages.metadata` holds optional provider and UI-relevant data, including media/document metadata, quoted-message context, Hub authorship (`sentByHub`, user identifiers and `clientMessageId`), traffic metadata, location/contact card data and reactions.

### Identity rules

- A persisted WhatsApp message is primarily identified by `evolution_message_id`.
- A Hub outbound message also carries a client-generated `clientMessageId` while it is optimistic/pending and through provider confirmation.
- Conversation remote JIDs are provider identities. Phone variants are used only where the implementation explicitly needs to bridge provider representations such as phone JIDs and LIDs; text or timestamp heuristics are not used to correlate Hub sends.

### Phone identity and presentation

Contact phone data follows this boundary:

```text
raw input → normalization → canonical identity → channel aliases/JID/LID → presentation formatting
```

- `server/src/contactDomain.ts` is the backend source for phone normalization. When the country is known, new contact inputs use an E.164-like canonical value (for Brazil, `+55` plus the national number).
- `contacts.phone` remains the primary/compatibility field and `contact_phones` stores the contact's additional phone identities. New writes keep both representations synchronized; existing legacy rows are not rewritten automatically.
- Brazil's tenth- and eleventh-digit forms are not treated as equivalent by the canonical identity helper: the missing-ninth-digit case remains a human-review candidate. Existing `phoneVariants` helpers are limited to provider/channel routing compatibility and must not authorize contact merges.
- International numbers are preserved when an explicit country code is present. A local number without country context is ambiguous and is not assigned `+55` automatically.
- `contact_channel_identities` stores WhatsApp identities independently of phone values. `@s.whatsapp.net`, `@c.us`, `@lid` and `@g.us` remain remote channel identifiers; they are never replaced by a phone string and do not change conversation selection rules.
- `src/utils/phone.ts` formats Brazilian canonical values as `(DD) XXXXX-XXXX` or `(DD) XXXX-XXXX` for display without changing persisted identity. Search and future contact inputs use exact canonical identity keys, while normalization never merges Contacts automatically.

Production legacy data contains representation differences and cross-contact canonical collisions. Any future backfill or constraint change therefore requires a separate, company-scoped, auditable human-reviewed operation; this implementation only prevents new inconsistencies.

## 7. Authentication, Authorization and CORS

### Sessions and roles

`auth.ts` verifies email/password, creates a random session token, stores its HMAC in `sessions`, and sends the original token as the `vitstock_session` HTTP-only cookie.

- Session lifetime is 12 hours.
- Production cookies are `Secure` and `SameSite=None` to support the separate frontend origin.
- Development cookies use `SameSite=Lax`.
- `loadUser` resolves an active user and company on every request.
- `requireUser` protects authenticated routes; `requireAdmin` protects team administration.

### CORS and origin checks

`server/src/config.ts` normalizes origins and builds an explicit allow-list from:

- `FRONTEND_URL`;
- optional comma-separated `ALLOWED_FRONTEND_ORIGINS`.

`isAllowedFrontendOrigin()` compares normalized origins exactly. Wildcards, suffix/substring matching and `*.vercel.app` style rules are not accepted. The same helper is used by Fastify CORS and the manual origin guard for mutating API calls. This supports explicit Vercel Preview origins without opening CORS to arbitrary sites.

## 8. Evolution API Integration

`server/src/evolution.ts` is the integration boundary for Evolution API. It adds the provider API key only on server-to-provider requests and uses a 15-second upstream timeout.

### Provider operations

The module implements routes for:

- instance status, connection/QR code and logout;
- chat and contact snapshots;
- history retrieval and reconciliation;
- sending text, media and reactions;
- message media retrieval and business-profile lookup;
- read state, conversation status, notes and leases;
- incoming Evolution webhook processing.

The browser never calls Evolution API directly. It calls the Vitstock backend, which owns credentials, persistence and authorization.

### Connection lifecycle

The frontend maps Evolution instance state to three UI states:

| Evolution state | UI state |
| --- | --- |
| `open` | `connected` |
| `connecting` | `connecting` |
| any other/unavailable state | `disconnected` |

`EvolutionApiService.getInstanceStatus()` caches status briefly and emits a browser `vitstock:whatsapp-status` event. `AppLayout`, the Inbox hook and the message hook use this shared signal.

The connection settings flow uses existing status, connect/QR and logout endpoints. Status is readable by authenticated users so Atendimento and the shared sidebar can reflect the provider state, while QR generation and logout are restricted to administrators. Non-administrators see the connection state without management controls. Atendimento intentionally treats only `connected` as operational: while disconnected or connecting, it does not present the inbox/timeline as live and does not permit an outbound WhatsApp send. Existing browser state and drafts are not deleted merely because the connection is offline.

## 9. Atendimento Architecture

`src/pages/AtendimentoPage.tsx` orchestrates the service workspace. It composes these main responsibilities:

| Responsibility | Relevant implementation |
| --- | --- |
| Inbox state, filters and operational actions | `src/hooks/useConversationInbox.ts` |
| Timeline state, history loading, cache and scroll | `src/hooks/useConversationMessages.ts` |
| Contact details / Google Contact sheet | `src/hooks/useContactPanel.ts` |
| List filter counts | `src/components/conversations/ConversationFilters.tsx` |
| List and item rendering | `ConversationList.tsx`, `ConversationListItem.tsx`, `ContactPhoto.tsx` |
| Timeline rendering, quoted blocks, media and actions | `MessageTimeline.tsx` |
| Local typed text and submit keys | `MessageComposer.tsx` |
| Media viewer | `MediaViewer.tsx` and `utils/mediaViewer.ts` |

### Render boundaries

`MessageComposer` owns the currently typed text locally. It exposes a small imperative handle (`clear`, `setText`, `focus`) to its parent so changing a character does not rerender the page, inbox or message timeline.

`ConversationList` is memoized; each `ConversationListItem` is memoized with a comparator limited to fields rendered in the card. `ContactPhoto` is memoized and list avatars use lazy image loading. `ConversationFilters` calculates all filter counts in a single reduction when conversations actually change.

These boundaries rely on state reconciliation preserving object identity for unchanged conversation and message records.

## 10. Inbox State and Reconciliation

### Loading sources

`useConversationInbox` loads `/api/evolution/chats` through `EvolutionApiService.fetchRealChats()`.

On the server, chat loading combines Evolution data with locally persisted state. It can use a short-lived Evolution snapshot cache and a short-lived local inbox cache so a slow provider response does not make the inbox disappear. Local data also excludes reaction and other non-renderable provider events from the last-message selection.

### Reconciliation and ordering

`src/utils/conversationReconciliation.ts` provides two explicit mechanisms:

- `reconcileConversations()` performs structural sharing: equivalent conversations reuse their prior object; an entirely equivalent snapshot reuses the existing array.
- `reconcileConversationsMonotonic()` additionally protects recent activity. A snapshot whose last activity is older than the current local/SSE activity cannot replace preview fields, unread/needs-response state or list position.

This protects the visible inbox from the race where an optimistic or realtime message moves a conversation to the top, then an older `/chats` response moves it back.

`reconcileRealtimeConversation()` in `utils/realtimeUpdates.ts` applies payload-rich realtime changes incrementally. When an event lacks enough data or references a conversation absent from the list, the normal refresh path remains the safety fallback.

### Filters and response state

The current filters are `all`, `unread`, `unanswered`, `delivery`, `groups` and `resolved`.

Unread state and response state are intentionally distinct:

- `unreadCount` indicates whether the conversation has been read;
- `needsResponse` indicates whether the latest relevant customer activity still needs a response;
- a resolved conversation is not considered to need a response solely due to its prior last message.

`conversationNeedsResponse()` keeps this distinction outside the display layer.

### Conversation ownership

The system also has a server-backed conversation lease. `conversation_leases` contains the owner and expiry; lease actions emit `conversation.updated` events. The frontend derives the active lock from `expiresAt`, so expiry releases the composer without a timeline reload. The server is the authority for lease acquisition and conflict behavior.

## 11. Message Lifecycle

### Received messages

```text
WhatsApp
  → Evolution webhook
  → POST /webhooks/evolution
  → provider normalization and message-scoped metadata
  → PostgreSQL conversation/messages update
  → publishRealtimeEvent(companyId, "message.upsert")
  → EventSource in the browser
  → incremental timeline and inbox reconciliation
```

`evolution.ts` unwraps supported provider message wrappers, derives message content, media, quoted context and message-scoped metadata, persists the data, then publishes a normalized realtime message. Provider reaction events are treated specially: they update metadata on their explicit target message instead of creating a standalone timeline message.

### Evolution webhook contract and self-heal

The backend keeps the instance webhook contract declarative. After startup and
at a low-frequency interval, it calls `GET /webhook/find/{instance}`, compares
the effective configuration, and calls `POST /webhook/set/{instance}` only when
drift is detected. The expected contract is the public backend URL followed by
`/webhooks/evolution`, the `MESSAGES_UPSERT` event, `byEvents=false`,
`base64=false` and the `x-webhook-secret` header. The header value is never
written to logs or exposed in API responses.

For Evolution API 2.3.7, the set request uses the provider shape
`{ webhook: { enabled, url, headers, byEvents, base64, events } }`; the find
response is normalized from the persisted top-level webhook fields. If the
provider omits or masks the header value, the Hub reports an unknown webhook
state and does not repeatedly overwrite a value it cannot compare safely.

Webhook reconciliation is best effort: provider failures do not prevent the
backend from starting, and concurrent checks share one in-flight operation.
`GET /api/evolution/status` exposes the additive `webhook` state separately
from the WhatsApp connection state; `open` therefore does not imply a healthy
webhook integration.

The frontend `evolutionMessageAdapter.ts` independently adapts API/provider snapshots into `Message` values. It handles common text, media captions, interactive messages, calls, contact cards, locations, sticker/audio/video/document placeholders and provider metadata.

### Sent messages

```text
MessageComposer
  → AtendimentoPage captures text/reply snapshot
  → optimistic Message with clientMessageId
  → POST /api/evolution/messages/send or /send-media
  → authenticated backend idempotency + lease checks
  → persist/update local message
  → Evolution API send
  → response and/or webhook confirmation
  → SSE upsert/status
  → merge with optimistic item by explicit identifiers
```

The page captures the message text and reply target before clearing mutable Composer state. This prevents a reply target from leaking into a subsequent rapid send.

Hub sends persist provenance in message metadata: `sentByHub`, sender identity/name and `clientMessageId`. The external WhatsApp payload may include an attendant signature, but the canonical local/UI content remains separate from authorship. Provider confirmation preserves stored Hub attribution rather than reclassifying it as a WhatsApp Web send.

### Status, failures and retry

Messages carry `pending`, `sent`, `delivered`, `read` or `failed` status. An optimistic message renders immediately as `pending`; an accepted provider ID and subsequent realtime status update confirm it. The timeline exposes retry only for failed outbound non-note messages. If a send is not accepted, the draft can be restored only when a newer edit has not superseded it.

The `OUTBOUND_TRACE=true` server flag and `VITE_OUTBOUND_TRACE=true` frontend build flag provide opt-in timing diagnostics. They log identifiers and elapsed times, not message content or secrets.

## 12. Message Reconciliation, History and Cache

### Stable identity and merge

`src/utils/messageMerge.ts` merges initial pages, realtime data, polling data and historical pages.

- Equivalent messages retain their previous object references.
- A confirmed Hub message can replace its optimistic alias only through `clientMessageId`/provider identity, never content or timing heuristics.
- New messages append/prepend without a full sort where chronology makes that safe; a sort is used only when required.
- Hub authorship, quoted context and reactions are preserved across provider snapshots that omit Hub-only metadata.

`reconcileRealtimeMessages()` applies a single `message.upsert` or `message.status` update to the active timeline or to a cached inactive conversation. Duplicate/no-op events return the current array.

### Seven-day initial window and pagination

`useConversationMessages` initially presents the recent seven-day window (`HISTORY_WINDOW_MS`). Older history is available through explicit load-more behavior. Loading older messages prepends the result and compensates `scrollTop` by the height delta so the reader's viewport remains anchored.

### Per-conversation browser cache

`conversationMessagesCache.ts` keeps the most recently accessed conversations in an in-memory LRU-like `Map`, capped at 40 entries. Each entry contains messages, pagination availability, history-expanded state and the latest known timestamp.

Returning to an already cached conversation is therefore immediate, followed by safe background reconciliation. This cache is session-memory only; a reload rehydrates from the backend.

## 13. Request Coordination and Fallback Polling

`utils/requestCoordinator.ts` contains two small primitives:

- `createInFlightRequestCoordinator()` shares concurrent requests with the same key;
- `createLatestRequestGuard()` prevents stale responses from applying after newer requests.

The inbox deduplicates an in-flight refresh. Message history requests are keyed by conversation and request parameters so equivalent polling, realtime fallback and post-send requests share the active request while different conversations remain independent.

SSE is the primary update path. `REALTIME_SAFETY_INTERVAL_MS` is five minutes for both inbox and active timeline reconciliation. A visible-tab event, WhatsApp reconnection and SSE reconnection can also trigger reconciliation; deduplication limits overlap. When the tab is hidden, those safety interval callbacks do not start new browser fetches.

## 14. Realtime Architecture

### Server stream

`GET /api/evolution/events` is authenticated and registers the raw HTTP response with `server/src/realtime.ts`. Clients are grouped by company in an in-memory map. The server sends:

- SSE event name `evolution`;
- a monotonically increasing in-process event ID;
- a 25-second heartbeat comment;
- a JSON payload with a `type` field.

Observed event types include:

- `message.upsert`;
- `message.status`;
- `conversation.updated`;
- browser-synthesized `realtime.reconnected` after EventSource reconnects.

`conversation.updated` transports operational updates such as assignment/status/read/lease state. A message-upsert reaction is marked as a reaction and updates only its original target message.

### Browser stream

`EvolutionApiService.subscribeToRealtimeEvents()` maintains a shared static `EventSource` per browser runtime. It fans events out to registered hook listeners and closes the stream once there are no listeners. After a stream error followed by a later successful open, it emits `realtime.reconnected`; Inbox and active message hooks reconcile safely if the document is visible.

## 15. Timeline and Scroll Invariants

`useConversationMessages` owns the scroll container ref and stores per-conversation scroll state (up to 100 conversations): `scrollTop` and sticky-to-bottom status.

Its key behaviors are:

- opening a conversation restores its saved position, or goes to the latest message when sticky;
- a user within 120 pixels of the bottom is considered sticky;
- incoming messages append without forcing a non-sticky reader to the bottom;
- non-sticky incoming messages increment the `↓ N novas mensagens` indicator instead;
- history prepends preserve viewport position;
- `ResizeObserver` compensates for lazy media/document layout changes;
- generation and active-conversation guards prevent delayed work for one conversation from moving another conversation's scroll position.

`VITE_SCROLL_TRACE=true` enables `SCROLL_TRACE` diagnostics for relevant scroll, resize, restore, history and realtime events. The trace is opt-in to avoid normal production DOM work.

## 16. Media, Documents, Reply and Reactions

### Media

The timeline supports image, audio, video, sticker and document message types. `EvolutionApiService` has short-lived, in-flight-deduplicated caches for media and business-profile requests.

`documentMedia.ts` classifies document cards by extension/MIME. PDFs can open in the shared `MediaViewer`; other office/archive/document types remain safe download cards instead of attempting an incorrect in-browser renderer.

`MediaViewer` is a focused modal for images, videos and PDFs. It supports close button, Escape, optional overlay close, focus containment and download. Opening/closing a viewer does not change the active conversation or reload history.

### Product library and image storage

`/configuracoes?tab=products` uses its own product API and UI; it is not coupled to Quick Replies. `server/src/products.ts` derives company scope from the authenticated session, permits product reads to authenticated company users, and restricts create/update/archive and Bling linking to `admin`. Search is name-only and excludes archived products. Products are archived rather than hard-deleted.

Products have an explicit source: legacy `manual` or `bling`. `manual` exists
only for pre-rule legacy records; new and operational products must remain
Bling-backed. New products can only be created by importing an active Bling
product; `POST /api/products` rejects manual creation in normal runtime. For
linked products, Bling is authoritative for product ID, `bling_name`, price, SKU/code, GTIN,
unit, status, format, explicit parent relation and physical/virtual stock.
`products.name` is the Hub's editable local display name and is never replaced
by import, link, relink or sync. The Hub also owns the local image, archive
state and message history. `product_bling_links` is company-scoped and stores
the last sanitized provider snapshot. `product_bling_stock_balances` stores
physical and virtual balances separately by warehouse. Migration
`023_product_bling_links.sql` adds the link and balance tables; migration
`024_product_bling_sku_unique.sql` adds only a partial unique index on
`(company_id, lower(btrim(bling_code)))`. The guarded local QA harness is the
validation target; do not apply migrations to Preview or Production as part of
ordinary local verification.

ADMIN can import an active Bling product only with a local JPEG/PNG/WebP image
up to 1 MB, link/relink an existing local product, explicitly sync its current
Bling ID, and archive products no longer in active use. Unlinking a product is
prohibited: the compatibility route `DELETE /api/products/:id/bling-link`
returns 409 without issuing database writes. Import/link/sync fetch authoritative
detail and stock before a database transaction; active status, nonblank SKU and numeric
effective stock are required. Effective stock is `stockVirtualTotal ??
stockPhysicalTotal`: zero and negative virtual balances are valid, and physical
stock is used only when virtual stock is absent. Missing/invalid price, missing
SKU, unresolved stock or mismatched provider IDs fail before writes. A
company-scoped partial unique index prevents duplicate trimmed,
case-insensitive SKUs; link/relink/sync conflicts return 409 and transaction
rollback preserves the previous cache. The full provider snapshot and
warehouse-balance replacement commit atomically. Relink and sync update
authoritative Bling fields without changing the local display name, image,
archive state or historical message snapshots. Archive removes a product from
active use while retaining its row, Bling link/balances, image and history. The
rejected unlink route leaves the product, link, balances, image and snapshots
unchanged. ADMIN may edit the local display name and image; catalog price and
Bling identity remain read-only. Authenticated company users can read cached
linked data while Bling is disconnected; all
these mutations remain ADMIN-only.

The product image contract accepts JPEG, PNG or WebP up to 1,000,000 decoded bytes, validates base64 plus magic bytes against the declared MIME type, and stores only an immutable object key and metadata in PostgreSQL. Add/edit forms accept image paste anywhere in the modal: supported images up to 1 MB replace the selection, invalid images preserve the previous selection, and plain-text paste remains native. `ProductStorage` has two explicit drivers: `memory` for local/QA and `r2` for an explicitly configured S3-compatible Cloudflare R2 bucket. R2 requires `PRODUCT_STORAGE_DRIVER=r2` plus server-side `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `R2_PUBLIC_BASE_URL`; these must never be exposed through `VITE_` variables. When no driver is set, only local/QA can receive the in-memory adapter; external databases do not silently receive ephemeral storage. Explicit `r2` configuration is validated at startup and registers the product routes; incomplete configuration fails without printing credential values.

R2 object keys are generated by the backend as `products/<company_id>/<product_uuid>/<image_uuid>.<ext>`; the browser never chooses the key or receives S3 credentials. R2 stores image bytes, while PostgreSQL stores product metadata and the key. Public image URLs use the configured custom-domain base; this bucket's images are intentionally public. The Preview bucket is `vitstock-hub-products-preview` at `https://media-preview.vitstock.com.br`; its managed `r2.dev` URL must remain disabled. Railway Preview environment values are a later deployment step and are not part of the local integration.

The in-memory adapter remains the default for local/QA and is not safe for external databases or multiple backend instances. Update-image creates a new immutable key and does not delete the previous object; archiving a product also preserves its image. If product-row creation fails after an upload, the backend makes a best-effort delete of only that request's new object and logs cleanup failure without replacing the original database error.

The product preview shows local name, linked SKU/effective stock, registered catalog price and an editable positive BRL message price (up to two decimals). It submits `productId`, the existing conversation's explicit `remoteJid`, `clientMessageId` and optional integer-cent `priceCentsOverride` to authenticated `POST /api/evolution/messages/send-product`. The backend validates the override and snapshots it only into that message; catalog and Bling cache prices are unchanged. It requires an active tenant-owned product and accessible existing tenant conversation, then acquires the normal conversation lease. Name, image key/URL, bucket and company remain server-owned. `ProductStorage.buildUrl()` supplies the trusted image URL and catalog supplies MIME; Evolution receives `sendMedia` with `mediatype=image`, exact PN/LID/group recipient and local display name plus the deterministic message-snapshot price. This path makes no Bling call and reads only local cache.

The normal outbox transaction locks the client ID and catalog row, inserts a pending local message with structured `productSnapshot`, and inserts `message_product_refs` using its local UUID (not the provider ID). This path uses the locally cached product/image and makes no realtime Bling request. Failure rolls back both before transport; provider rejection retains a failed message/ref. Only failed attempts can retry, reusing their original snapshot/ref; accepted or pending attempts are deduplicated without another provider request or message-upsert publication. Reusing a product client ID for another product or transport JID is rejected. If an early webhook creates a provider row, confirmation transfers the reference and Hub metadata to the surviving local UUID transactionally before removing the pending row.

After success the existing message-upsert/SSE path updates the timeline; the UI merges confirmed history as a safety fallback, not a parallel optimistic product message. `ProductMessageCard` recognizes only structured metadata, never captions, URLs, filenames or OCR. Stored name, integer price, BRL currency and immutable image key survive catalog edits, replacement images, archiving, linking, relinking and sync; rejected unlink attempts do not mutate them. Historical images are served through the authenticated storage route authorized by the tenant's message references. A real Preview provider send still requires a separately authorized human gate.

### Quoted messages

Quoted/reply metadata is message-scoped. `quotedMessage.ts` creates the small quoted representation from explicit message/provider keys. The backend persists inbound quoted context in `messages.metadata`; when the original is already known it can be used as the preview source, otherwise the quoted payload supplies a compact fallback.

### Reactions

Reactions belong to the original message, not to an independent timeline row. Reactions are normalized with an explicit target message ID and reactor key. Metadata reconciliation supports replace/remove semantics for the same reactor, preserves different participants, and ignores stale reaction state. Hidden reaction events are excluded from inbox previews and conversation activity.

## 17. Google Contacts and Contact Presentation

`server/src/google-contacts.ts` manages OAuth connection state, synchronization, contact lookup and contact writes. Full Google data is retained in `contacts.google_data` with fields such as resource name, etag, sync time, additional phones and profile information represented by migrations 002, 003, 012 and 016. Migration 017 stores the connection's sync state and last-sync summary without storing credentials in the frontend. A Google Person is reconciled into one local Contact; additional values are stored in `contact_phones` and `contact_emails` rather than creating one Contact per phone.

`useContactPanel` loads a contact panel for the active private conversation. The Inbox can remember a higher-priority saved contact name locally so provider snapshots do not transiently replace a Google Contact name. Provider contact names and avatars are separately cached in `whatsapp_contact_names`.

## 18. API Surface (Current Major Routes)

| Area | Routes |
| --- | --- |
| Health | `GET /health` |
| Auth | `/api/auth/login`, `/logout`, `/me`, `/change-password` |
| Team | `/api/team/attendants` and `/api/team/attendants/:id` |
| WhatsApp connection and realtime | `/api/evolution/status`, `/connect`, `/logout`, `/events` |
| Inbox operations | `/api/evolution/chats`, `/chats/capture`, `/chats/release`, `/chats/pull-lease`, `/chats/status`, `/chats/read` |
| Messages and media | `/api/evolution/messages`, `/messages/send`, `/messages/send-media`, `/messages/reaction`, `/media` |
| Notes and business data | `/api/evolution/notes`, `/notes/list`, `/business-profile` |
| Provider ingress | `POST /webhooks/evolution` |
| Google/contacts | `/api/google/status`, `/api/google/connect`, `/api/google/callback`, `/api/google/sync`, `/api/google/disconnect`, `/api/google/contact*`, `/api/contacts`, `/api/contact-tags` |
| Product library (memory in local/QA; explicitly configured R2 where enabled) | `/api/products`, `/api/products/:id`, `/api/products/:id/archive`, `/api/products/bling-links`, `/api/products/:id/bling-link`, `/api/products/:id/bling-sync`, `/api/products/bling-import`, `/api/products/storage?key=...`, `/api/evolution/messages/send-product` |

Operational routes use the authenticated server boundary. The deliberately public entry points—login, the OAuth callback and the provider webhook—use their own route-specific validation.

## 19. Environment and Deployment

### Required backend configuration

`server/src/config.ts` validates required runtime configuration with Zod. Important variables include:

- `DATABASE_URL`;
- `SESSION_SECRET`;
- `WEBHOOK_SECRET`;
- `BACKEND_PUBLIC_URL` (or the existing `VITE_API_URL` compatibility source);
- `FRONTEND_URL` and optional `ALLOWED_FRONTEND_ORIGINS`;
- `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`;
- optional Google OAuth client values;
- `PORT` and `NODE_ENV`.

Optional operational tuning includes `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS` and `OUTBOUND_TRACE`.

### Local development

`npm run dev:local` runs the server on port 3001 and Vite on port 3000. It sets the local frontend origin and `VITE_API_URL` for the spawned processes.

The root README states that the configured `.env.local` may still point the local frontend/backend at the configured PostgreSQL and Evolution services. Developers must therefore use non-production credentials and avoid treating local UI testing as automatically isolated from provider or database state.

`docker-compose.yml` offers an optional local PostgreSQL 16 service.

For browser automation, `npm run dev:e2e` uses the isolated QA Compose database on `127.0.0.1:55432/vitstock_qa`, `QA_MODE=true`, Evolution mock and Google mock. Its startup guard rejects remote database/provider URLs instead of falling back to `.env.local`. `npm run test:e2e` defaults to the local frontend and confirms the QA marker before running Playwright; remote Preview execution requires explicit `PLAYWRIGHT_ALLOW_REMOTE=true`.

### Preview and production

- `vercel.json` rewrites routes to `index.html` for the SPA.
- `server/railway.json` builds the backend with `npm ci && npm run build`, runs migrations before deploy, starts with `npm run start`, and health-checks `/health`.
- Vercel Preview origins must be added explicitly to `ALLOWED_FRONTEND_ORIGINS` when they need cookie-authenticated backend access.

## 20. Testing

The repository uses Node's built-in test runner through the main `npm test` suite defined in `package.json`, with each TypeScript file delegated through `tests/run-tests.mjs`. The suite covers regressions around:

- conversation and message reconciliation;
- optimistic sends and explicit client-message identity;
- reactions, replies and authorship preservation;
- request coordination;
- call/message normalization;
- message menu and media helpers;
- scroll-adjacent utility behavior.

Frontend build/type checking runs through `npm run build` (`tsc && vite build`). Backend checks are available through `npm --prefix server run check` and `npm --prefix server run build`.

## 21. Architecture Invariants

The following are derived from the current implementation and project rules; changes in these areas require focused regression testing.

1. **Backend authority:** authentication, authorization, provider credentials, leases, persisted message provenance and database state belong to the backend.
2. **Explicit identity:** Hub messages reconcile through provider IDs and persisted `clientMessageId`, not text or timing similarity.
3. **Monotonic activity:** an inbox snapshot with older activity must not regress a more recent optimistic/realtime preview or list position.
4. **Structural sharing:** equivalent inbox/message snapshots retain prior references to avoid unnecessary list and timeline work.
5. **SSE plus fallback:** realtime is primary; polling, visibility and reconnect reconciliation remain necessary because events can be missed or insufficient.
6. **Message-scoped metadata:** ads, quoted context and reactions must stay on the message that carries them and must not leak through chat-level/cached context.
7. **Reaction events are not conversation activity:** they do not create a timeline item, inbox preview, unread increment, needs-response transition or reorder.
8. **Scroll is conversation-specific:** delayed callbacks, media layout changes and history prepends must not move a different active conversation or a non-sticky reader.
9. **Offline is not operational:** only connection state `open`/frontend `connected` enables normal inbox loading and outbound WhatsApp sends.
10. **No false send success:** an accepted send is optimistic but stays pending/failed until confirmed; failure must remain visible and retryable.

## 22. Known Architectural Risks / Technical Debt

These items are observations from the current code, not proposed changes in this document.

1. **In-memory SSE fan-out is process-local.** `realtime.ts` stores clients and event sequence in module-level maps. Multiple backend instances would not share events without a cross-process broadcaster; polling remains the recovery path.
2. **Evolution payloads are loosely typed.** Provider normalization intentionally accepts several shapes and uses `any` at the adapter boundary. This improves compatibility but requires fixture/regression coverage when Evolution changes its payload format.
3. **Large inbox rendering is not virtualized.** Memoization reduces updates, but `ConversationList` still maps all visible conversations. A very large visible filtered list can still create many DOM cards.
4. **Global request body limit versus media limit.** `app.ts` sets Fastify `bodyLimit` to 2 MiB while the frontend validates attachments up to 10 MiB and sends Base64 JSON to the media endpoint. Files permitted by the UI can therefore exceed the server request limit after Base64 expansion.
5. **Local development can be externally connected.** The documented local workflow can use services configured in `.env.local`; it is not inherently a sandboxed provider/database environment.
6. **Evolution integration is concentrated.** `server/src/evolution.ts` contains provider access, persistence, webhook normalization and many routes. Its broad responsibility makes targeted tests especially important.

## 23. Architecture Change Policy

When a task changes message flow, Inbox state, SSE, caching, connection lifecycle, database schema or deployment configuration:

1. inspect the relevant source, migrations and tests first;
2. keep backend authority for critical state;
3. preserve explicit identifiers and monotonic reconciliation;
4. test duplicate, delayed and out-of-order events where applicable;
5. update this document when the architecture or a permanent decision changes.

If this document conflicts with the current implementation, inspect the source code, migrations and tests before making changes. Once actual behavior is confirmed, update this document so the architecture documentation remains aligned with the implementation.

## 24. Bling integration

`bling.ts` exposes authenticated, tenant-bound `/api/integrations/bling` routes.
`blingClient.ts` calls Bling API v3 directly; MCP/ChatGPT are not runtime dependencies.
Connect, callback and disconnect require an active ADMIN session. The callback
requires the same user/company that started authorization. Random 256-bit state
is hashed in PostgreSQL, expires after five minutes and is atomically marked used
before exchanging the code. Reconnect invalidates previous states; disconnect
removes pending states. Cookies/session must still be valid at callback time.

Migration `022_bling_integration.sql` adds `bling_connections`,
`bling_oauth_states` and `bling_request_budgets`. Migration
`023_product_bling_links.sql` adds the company-scoped Product Library link and
warehouse-balance cache; `024_product_bling_sku_unique.sql` adds only the
normalized company/SKU uniqueness index. Product images remain local Hub/R2
objects and are never fetched from Bling. Access/refresh tokens use AES-256-GCM with a separate backend
`INTEGRATION_ENCRYPTION_KEY` (32 random bytes in base64). AAD binds ciphertext to
provider, version, company and token kind. The key must remain persistent per
environment; replacing/losing it requires reconnecting existing companies, with
no fallback decryption key. Google encryption was inspected but
not reused because it currently derives its key from `SESSION_SECRET`.
Request logging omits query strings, including OAuth code/state; integration
errors never include provider bodies, credentials or authorization headers.

PostgreSQL company advisory transaction locks serialize refresh/reconnect/
disconnect across replicas. Successful token rotations and consumed request
budgets commit even if the later provider GET fails. SQL/storage failure after
provider rotation is not recoverable atomically across both systems: reconnect
may be required. No OAuth POST is automatically retried. Refresh occurs within
60 seconds of access-token expiry, or once after 401. A second 401 fails closed.

A conservative shared PostgreSQL budget serializes ALL Hub Bling calls (not
just per company), including across replicas: at least 340 ms between requests,
120,000/day using the UTC calendar date, and at least 3,100 ms between
token requests (below the documented 20/minute/IP). Locks remain held through
transport to avoid delayed-reservation bursts, using one pool connection. Spacing
is also extended after each HTTP attempt (including failures), so a late database
acknowledgement cannot compress actual dispatches. This deliberately sacrifices
throughput/holds a DB connection for a bounded request.
Bling owns a separate pool capped at one connection and closes it with Fastify.
The Hub pool remains bounded by DB_POOL_MAX (default four, maximum eight): a
configured integration adds at most one connection per process, not per tenant.
This prevents slow provider calls from exhausting session/inbox/health slots,
including DB_POOL_MAX=1. Bling requests may fail with a bounded pool/lock timeout;
they do not block unrelated Hub requests. No pool is created if Bling is disabled.
Other apps/accounts sharing an upstream account or egress IP are outside Hub
coordination; 429 remains authoritative. Retry-After cooldown is persisted.
GET retries are limited to two for network/5xx/429 (backoff+jitter); waits over
five seconds return a sanitized limit error instead of retrying too early.
Each attempt has an eight-second timeout covering headers AND body, a 5 MiB
body ceiling and no redirect following. Database lock wait is capped at 12 s.

Read routes allow only fixed product/deposit/stock paths, explicit page/limit
(1..10,000 / 1..100; defaults 1/50), product name/type and warehouse
description/status filters. The operational product-selection catalog always
uses upstream `criterio=2` (active products); clients cannot override that
criterion, and the Hub fails closed if the provider returns any non-active item
in that catalog page. Import, link and relink revalidate status from the
authoritative detail response and accept only `A`. Sync of an existing link is
different: it remains allowed and records authoritative `A` or `I` status
without automatically unlinking the product. The product-list contract accepts
`A`, `I` and the observed `E`, but the detail and persisted link/snapshot
contracts remain `A`/`I`. An explicit `E` detail is not accepted: selection
rejects it with 409 before stock lookup or mutation, while direct detail reads
and existing-link sync fail closed with 502 until the detail contract is
verified. Migration 023 retains the `A`/`I` status constraint; migration 024
only enforces normalized company/SKU uniqueness and does not delete or rewrite
product data, message snapshots or images. No arbitrary upstream URL or
full-catalog scan is allowed.
IDs normalize to strings; unsafe JSON numeric IDs fail rather than round.
Variations retain their own IDs and explicit parent relation. Warehouse field
`descricao` and flags are preserved. Physical/virtual totals and deposit balances
remain separate: no recomputation, aggregation or available-stock business rule.
Product images are not fetched from Bling. The product send path uses cached
values and makes no Bling request. Message references and historical snapshots
are untouched by link/sync/relink/archive; the compatibility unlink route
rejects with 409 and leaves these records unchanged. Orders and webhooks remain
outside scope.
Local disconnect deletes only credentials/states; revoke authorization separately
in Bling's authorized applications when needed.

Official sources (consulted 2026-10-03):
[applications/OAuth](https://developer.bling.com.br/aplicativos),
[JWT](https://developer.bling.com.br/migracao-jwt),
[limits](https://developer.bling.com.br/limites),
[OpenAPI reference](https://developer.bling.com.br/referencia) and its linked
[schema](https://developer.bling.com.br/build/assets/openapi-Dw6cY8yQ.json).
Contract: `https://api.bling.com.br/Api/v3`, authorization
`https://bling.com.br/Api/v3/oauth/authorize`, token
`https://api.bling.com.br/Api/v3/oauth/token`, Basic app credentials + form body,
JWT `enable-jwt: 1` on exchange/refresh/authenticated GETs. Honor `expires_in`
(OAuth example 21,600 s); refresh lifetime is documented as 30 days; authorization
code one minute. OpenAPI security scheme uses `bling.com.br` for token host;
the applications guide uses `api.bling.com.br/Api/v3/oauth/token`, selected here.
The JWT guide also contains a curl example omitting `/Api/v3`; this discrepancy
must be checked during the separately authorized first real OAuth gate.
Pagination OpenAPI minimum is one/default limit 100, with no declared maximum;
Hub's 100 ceiling is defensive, not claimed as an upstream maximum.

## Evidence Used

The main sources used for this document were:

- `src/main.tsx`, `src/App.tsx`, `src/pages/AtendimentoPage.tsx` and `src/components/layout/AppLayout.tsx`;
- `src/hooks/useConversationInbox.ts`, `src/hooks/useConversationMessages.ts`, `src/hooks/useContactPanel.ts`;
- `src/services/api.ts`, `src/services/evolutionApi.ts`, `src/services/evolutionMessageAdapter.ts`;
- `src/utils/conversationReconciliation.ts`, `messageMerge.ts`, `realtimeUpdates.ts`, `requestCoordinator.ts`, `conversationMessagesCache.ts`, `scrollTrace.ts` and related media/reply/reaction helpers;
- `src/components/conversations/*`;
- `server/src/app.ts`, `index.ts`, `config.ts`, `db.ts`, `auth.ts`, `evolution.ts`, `realtime.ts`, `google-contacts.ts`, `contacts.ts`, `contactDomain.ts` and migration scripts;
- `server/migrations/001_initial.sql` through `020_quick_replies.sql`;
- `server/railway.json`, `vercel.json`, package scripts, local-development script and `tests/core.test.ts`.
