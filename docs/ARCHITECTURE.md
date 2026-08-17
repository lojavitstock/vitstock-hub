# Vitstock Hub — Architecture

> **Implementation baseline:** this document describes the active development branch `codex/perf-atendimento-inbox`.
>
> This branch contains work that may not exist in `main`. When investigating implementation details, use this branch as the baseline, then confirm behavior in the source code, migrations and tests.

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

### Main entities

The schema is company-scoped. The important tables are:

| Area | Tables | Notes |
| --- | --- | --- |
| Organization and access | `companies`, `users`, `sessions` | Users have `admin` or `attendant` roles; sessions store only a token HMAC. |
| Contacts and conversations | `contacts`, `conversations` | A conversation is keyed per company by `evolution_remote_jid`; it carries persisted inbox fields. |
| Message history | `messages` | Provider message ID is unique per company; `metadata` is JSONB for message-scoped details. |
| Provider webhook processing | `webhook_events` | Deduplicates provider event keys. |
| Google Contacts | `google_connections` and Google-related fields on `contacts` | OAuth token material is stored encrypted by the backend integration. |
| Operational conversation state | `conversation_assignments`, `conversation_statuses`, `conversation_read_states`, `conversation_daily_responders`, `conversation_notes`, `conversation_leases` | These are scoped by company and Evolution JID or conversation. |
| Provider contact cache | `whatsapp_contact_names` | Stores provider names and avatars independently of Google contact data. |

`messages.metadata` holds optional provider and UI-relevant data, including media/document metadata, quoted-message context, Hub authorship (`sentByHub`, user identifiers and `clientMessageId`), traffic metadata, location/contact card data and reactions.

### Identity rules

- A persisted WhatsApp message is primarily identified by `evolution_message_id`.
- A Hub outbound message also carries a client-generated `clientMessageId` while it is optimistic/pending and through provider confirmation.
- Conversation remote JIDs are provider identities. Phone variants are used only where the implementation explicitly needs to bridge provider representations such as phone JIDs and LIDs; text or timestamp heuristics are not used to correlate Hub sends.

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

The connection settings flow uses existing status, connect/QR and logout endpoints. Atendimento intentionally treats only `connected` as operational: while disconnected or connecting, it does not present the inbox/timeline as live and does not permit an outbound WhatsApp send. Existing browser state and drafts are not deleted merely because the connection is offline.

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

### Quoted messages

Quoted/reply metadata is message-scoped. `quotedMessage.ts` creates the small quoted representation from explicit message/provider keys. The backend persists inbound quoted context in `messages.metadata`; when the original is already known it can be used as the preview source, otherwise the quoted payload supplies a compact fallback.

### Reactions

Reactions belong to the original message, not to an independent timeline row. Reactions are normalized with an explicit target message ID and reactor key. Metadata reconciliation supports replace/remove semantics for the same reactor, preserves different participants, and ignores stale reaction state. Hidden reaction events are excluded from inbox previews and conversation activity.

## 17. Google Contacts and Contact Presentation

`server/src/google-contacts.ts` manages OAuth connection state, synchronization, contact lookup and contact writes. Full Google data is retained in `contacts.google_data` with fields such as resource name, etag, sync time, additional phones and profile information represented by migrations 002, 003 and 012.

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
| Google/contacts | `/api/google/*`, `/api/contacts` |

Operational routes use the authenticated server boundary. The deliberately public entry points—login, the OAuth callback and the provider webhook—use their own route-specific validation.

## 19. Environment and Deployment

### Required backend configuration

`server/src/config.ts` validates required runtime configuration with Zod. Important variables include:

- `DATABASE_URL`;
- `SESSION_SECRET`;
- `WEBHOOK_SECRET`;
- `FRONTEND_URL` and optional `ALLOWED_FRONTEND_ORIGINS`;
- `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`;
- optional Google OAuth client values;
- `PORT` and `NODE_ENV`.

Optional operational tuning includes `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS` and `OUTBOUND_TRACE`.

### Local development

`npm run dev:local` runs the server on port 3001 and Vite on port 3000. It sets the local frontend origin and `VITE_API_URL` for the spawned processes.

The root README states that the configured `.env.local` may still point the local frontend/backend at the configured PostgreSQL and Evolution services. Developers must therefore use non-production credentials and avoid treating local UI testing as automatically isolated from provider or database state.

`docker-compose.yml` offers an optional local PostgreSQL 16 service.

### Preview and production

- `vercel.json` rewrites routes to `index.html` for the SPA.
- `server/railway.json` builds the backend with `npm ci && npm run build`, runs migrations before deploy, starts with `npm run start`, and health-checks `/health`.
- Vercel Preview origins must be added explicitly to `ALLOWED_FRONTEND_ORIGINS` when they need cookie-authenticated backend access.

## 20. Testing

The repository uses Node's built-in test runner through `npm test`, currently executing `tests/core.test.ts` via `tests/run-tests.mjs`. The suite covers many core regressions around:

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

## Evidence Used

The main sources used for this document were:

- `src/main.tsx`, `src/App.tsx`, `src/pages/AtendimentoPage.tsx` and `src/components/layout/AppLayout.tsx`;
- `src/hooks/useConversationInbox.ts`, `src/hooks/useConversationMessages.ts`, `src/hooks/useContactPanel.ts`;
- `src/services/api.ts`, `src/services/evolutionApi.ts`, `src/services/evolutionMessageAdapter.ts`;
- `src/utils/conversationReconciliation.ts`, `messageMerge.ts`, `realtimeUpdates.ts`, `requestCoordinator.ts`, `conversationMessagesCache.ts`, `scrollTrace.ts` and related media/reply/reaction helpers;
- `src/components/conversations/*`;
- `server/src/app.ts`, `index.ts`, `config.ts`, `db.ts`, `auth.ts`, `evolution.ts`, `realtime.ts`, `google-contacts.ts` and migration scripts;
- `server/migrations/001_initial.sql` through `014_conversation_leases.sql`;
- `server/railway.json`, `vercel.json`, package scripts, local-development script and `tests/core.test.ts`.
