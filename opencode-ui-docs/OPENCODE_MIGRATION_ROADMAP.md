# OpenCode Migration Roadmap

> Migration of CodeLayer WUI from hld daemon backend to opencode server backend.
> Target: `opencode-wui/` directory in monorepo (alongside `humanlayer-wui/`).

---

## Strategy

### Approach: Copy + Adapt

1. Copy `humanlayer-wui/` → `opencode-wui/`
2. Replace `@humanlayer/hld-sdk` → `@opencode-ai/sdk`
3. Create adapter layer (`src/lib/opencode/`) that maps opencode API to internal types
4. Adapt hooks, store, and UI components to use the new adapter
5. Keep existing UI component structure — only change data flow

### Key Design Decision

**No DaemonClient abstraction layer.** The opencode API differs fundamentally from hld (hierarchical messages, event-based permissions, separate status endpoint). Instead:

- Create `src/lib/opencode/` with dedicated client, types, transformers, and event adapter
- Internal types are purpose-built for the UI, not clones of hld types
- Transformers handle the mapping from opencode SDK types to internal types

### Dependency Graph

```
Session 1 (Adapter) ──→ Session 3a (Hooks) ──→ Session 3b (Store)
                    ──→ Session 4 (UI + Polish)
Session 2 (Tauri)   ──→ Session 4 (UI + Polish) [for E2E]

Sessions 1 & 2 are INDEPENDENT (can be done in any order)
Session 3a depends on Session 1
Session 3b depends on Session 3a
Session 4 depends on Sessions 1, 2, 3a, 3b
```

---

## SDK Verification Results (Session 0)

### @opencode-ai/sdk — VERIFIED

- **npm**: `@opencode-ai/sdk` v1.1.34, MIT, 0 dependencies, 453 kB
- **Weekly downloads**: 1.3M+

### Client Creation (3 ways)

```typescript
// 1. Client + Server (launches opencode)
import { createOpencode } from "@opencode-ai/sdk";
const opencode = await createOpencode({ hostname: "127.0.0.1", port: 4096 });
const client = opencode.client;

// 2. Client only (connect to existing server)
import { createOpencodeClient } from "@opencode-ai/sdk";
const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });

// 3. Low-level
import Opencode from "@opencode-ai/sdk";
const client = new Opencode({ baseURL: "http://127.0.0.1:4096" });
```

### API Differences from Research Doc

| Topic                  | Research Assumed                        | Actual SDK (SPIKE v1.1.58)                                                                           |
| ---------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| SSE subscription       | `client.event.subscribe()`              | **`client.event.subscribe()`** — Research was RIGHT, Session 0 was wrong (not `event.list()`)        |
| Providers list         | `client.provider.list()`                | **BOTH exist**: `client.provider.list()` AND `client.config.providers()` (different response shapes) |
| Agents list            | `client.app.agents()`                   | **`client.app.agents()`** — Research was RIGHT (not `app.modes()`)                                   |
| Session.prompt         | `client.session.prompt({ path, body })` | `client.session.prompt({ path: { id }, body: { parts, model?, agent? } })`                           |
| Permission respond     | unclear in research                     | `client.postSessionIdPermissionsPermissionId({ path: { id, permissionID }, body: { response } })`    |
| AssistantMessage.agent | `agent` field                           | Actually `mode` field (R1: `mode: string` not `agent: string`)                                       |
| Session.slug           | Assumed in initial research             | **NOT in SDK types** — CONFIRMED absent in SPIKE                                                     |
| Session.time.archived  | Assumed in research                     | **NOT in SDK types** — CONFIRMED absent. No archive API, only delete                                 |
| EventPermissionReplied | R3 said "doesn't exist"                 | **EXISTS** — `permission.replied` event with `{ sessionID, permissionID, response }`                 |
| Health check           | `client.global.health()`                | Not in SDK class methods — may be a raw HTTP endpoint                                                |
| Config                 | `client.config.get()` / `patch()`       | `client.config.get()` + `client.config.update()` (NOT patch!)                                        |
| File operations        | `client.find.files/text/symbols()`      | Confirmed                                                                                            |
| session.messages()     | Returns Messages                        | Returns `Array<{ info: Message, parts: Part[] }>` — Parts included inline!                           |

### SSE Events — Verified Types

Key events from `types.gen.ts`:

- `EventMessageUpdated`, `EventMessageRemoved`
- `EventMessagePartUpdated`, `EventMessagePartRemoved`
- `EventPermissionUpdated`, **`EventPermissionReplied`** (SPIKE: BOTH exist — R3 was wrong about `replied` not existing)
- ~~`EventQuestionAsked`, `EventQuestionReplied`, `EventQuestionRejected`~~ — **SPIKE: these do NOT exist in SDK v1.1.58**
- `EventSessionStatus`, `EventSessionIdle`, `EventSessionCompacted`
- `EventSessionCreated`, `EventSessionUpdated`, `EventSessionDeleted`, `EventSessionDiff`, `EventSessionError`
- `EventFileEdited`, `EventFileWatcherUpdated`, `EventServerConnected`
- `EventLspUpdated`, `EventLspClientDiagnostics`
- `EventTodoUpdated`, `EventCommandExecuted`
- `EventVcsBranchUpdated`, `EventInstallationUpdated`, `EventInstallationUpdateAvailable`
- `EventPtyCreated`, `EventPtyUpdated`, `EventPtyExited`, `EventPtyDeleted`
- `EventTuiPromptAppend`, `EventTuiCommandExecute`, `EventTuiToastShow`
- `EventServerInstanceDisposed`

### Security Note

- **CVE-2026-22812**: Unauthenticated RCE in versions < 1.1.10
- Server disabled by default since v1.1.10
- No built-in auth when server is enabled — `OPENCODE_SERVER_PASSWORD` for Basic Auth

---

## WUI Codebase Structure (Verified)

### Files requiring migration

| Directory         | Files                | Key Files                                                                                                                           |
| ----------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/daemon/` | 8 files              | `http-client.ts` (main client), `types.ts`, `errors.ts`, `http-config.ts`, `client.ts` (singleton)                                  |
| `src/hooks/`      | 22 files             | `useDaemonConnection.ts`, `useApprovals.ts`, `useSessions.ts`, `useConversation.ts`, `useSubscriptions.ts`, `useSessionLauncher.ts` |
| `src/AppStore.ts` | 1 file (1200+ lines) | Central Zustand store                                                                                                               |
| `src/stores/`     | 20+ files            | `appStore.ts`, `useDebugStore.ts`, demo stores                                                                                      |
| `src-tauri/src/`  | 3 files              | `daemon.rs`, `lib.rs`, `main.rs`                                                                                                    |

### Features in existing WUI

- Vim-style keyboard navigation (j/k, shift+j/k for bulk select)
- Session management with archive, interrupt, filter
- PostHog analytics tracking
- Demo mode with full store for UI development
- Hotkey system with scope management

---

## Session 0: Setup — COMPLETE

**Goal:** Roadmap created, SDK verified, repo structure planned, pre-implementation research done.

### Tasks

- [x] Read research documents
- [x] Decide on code location (opencode-wui/ in monorepo)
- [x] Verify @opencode-ai/sdk actual API surface
- [x] Create this roadmap
- [x] Complete pre-implementation research (R1-R5)
- [x] Update roadmap with research findings

### Pre-Implementation Research — COMPLETE

All 5 research items completed. Documents in `opencode-ui-docs/research/`:

| Document                   | Status   | Key Findings                                                                                                                                     |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1: SDK Type Reference     | **DONE** | All 12 Part types documented. `mode` not `agent` on AssistantMessage. `slug` not in SDK types                                                    |
| R2: DaemonClient Interface | **DONE** | 13 must-implement methods. 11 can-be-dropped methods. Error patterns documented                                                                  |
| R3: Permission Flow        | **DONE** | `permission.updated` event (not `asked`). **`permission.replied` event EXISTS** (SPIKE). `client.session.permissions.respond()` semantic wrapper |
| R4: AppStore Analysis      | **DONE** | 13 daemon calls in store. Recommended Session 3 split → 3a/3b. Draft features to remove                                                          |
| R5: Serve Runtime          | **DONE** | Port format: `"opencode server listening on http://..."`. `OPENCODE_CONFIG_CONTENT` env var. `x-opencode-directory` header                       |

### Output

- `OPENCODE_MIGRATION_ROADMAP.md` (this file)
- `opencode-ui-docs/research/R1_SDK_TYPE_REFERENCE.md`
- `opencode-ui-docs/research/R2_DAEMON_CLIENT_INTERFACE.md`
- `opencode-ui-docs/research/R3_PERMISSION_FLOW.md`
- `opencode-ui-docs/research/R4_APPSTORE_ANALYSIS.md`
- `opencode-ui-docs/research/R5_OPENCODE_SERVE_BEHAVIOR.md`

---

## Session 1: Adapter Layer (~180k tokens)

**Goal:** Complete bridge between opencode SDK and WUI internal types. All transformers tested.

**Pre-requisites:** opencode SDK verified (Session 0)

### Subagent Strategy

| Phase | Agent                    | Task                                                       |
| ----- | ------------------------ | ---------------------------------------------------------- |
| Start | explorer ×2 (background) | Read existing `src/lib/daemon/` files + `src/hooks/` types |
| Start | librarian (background)   | Get opencode SDK full type definitions                     |
| Main  | developer (sync)         | Implement adapter files                                    |

### Tasks

#### 1.1 Project Bootstrap

- [ ] Copy `humanlayer-wui/` → `opencode-wui/`
- [ ] Remove `@humanlayer/hld-sdk` from `package.json`
- [ ] Add `@opencode-ai/sdk` to `package.json`
- [ ] Remove `src/lib/daemon/` directory
- [ ] Update `package.json` name/description
- [ ] `bun install`

#### 1.2 Internal Types (`src/lib/opencode/types.ts`)

- [ ] Define `InternalSession` — maps from opencode Session + SessionStatus
- [ ] Define `InternalMessage` (ConversationEvent equivalent) — flattened from Message + Part[]
- [ ] Define `InternalPermission` (Approval equivalent) — from PermissionRequest
- [ ] Define `InternalEvent` — normalized events from 43 opencode types
- [ ] Define `SessionFilter`, `SessionCounts` — client-side filtering types
- [ ] Export type aliases for backward compatibility where possible

#### 1.3 Transformers (`src/lib/opencode/transformers.ts`)

- [ ] `transformSession(opencodeSession, statusMap?) → InternalSession`
- [ ] `transformMessages(messages: Message[]) → InternalMessage[]`
  - Flatten Message → Part[] hierarchy into sequential events
  - Handle all 12 Part types (TextPart, ToolPart, ReasoningPart, etc.)
  - Map ToolPart states (pending/running/completed/error)
  - Preserve ordering by message.time.created + part sequence
- [ ] `transformPermission(request: PermissionRequest) → InternalPermission`
- [ ] `aggregateSessionMetrics(messages: Message[]) → { cost, tokens }`
- [ ] `transformSessionStatus(status: SessionStatus) → InternalSessionStatus`

#### 1.4 Event Adapter (`src/lib/opencode/events.ts`)

- [ ] `createEventAdapter(opencodeStream) → InternalEventEmitter`
- [ ] Map key events:
  - `session.status` → `session_status_changed`
  - `session.updated` → `session_settings_changed`
  - `session.created` / `session.deleted` → session list refresh
  - `permission.updated` → `new_permission` (event is `permission.updated`, NOT `permission.asked`)
  - `permission.replied` → `permission_resolved` (**SPIKE: event EXISTS** — R3 was wrong, no need to detect via tool state)
  - `message.updated` + `message.part.updated` → `conversation_updated`
- [ ] Ignore non-essential events (lsp.updated, vcs.branch.updated, etc.)
- [ ] Heartbeat handling (`server.heartbeat`)

#### 1.5 Client (`src/lib/opencode/client.ts`)

- [ ] `createOpencodeAdapter(config) → OpencodeAdapter`
- [ ] Session methods:
  - `listSessions()` — `client.session.list()` + transform
  - `getSession(id)` — `client.session.get()` + status + transform
  - `createSession(params)` — `client.session.create()` + `client.session.prompt(id, { parts })`
  - `continueSession(id, message)` — `client.session.prompt(id, { parts: [{ type: 'text', text }] })`
  - `abortSession(id)` — `client.session.abort(id)`
  - `deleteSession(id)` — `client.session.delete(id)`
  - `forkSession(id, messageId?)` — `client.session.fork(id, { messageID })` [NEW]
  - `shareSession(id)` / `unshareSession(id)` — `client.session.share/unshare(id)` [NEW]
  - `getSessionDiff(id)` — `client.session.diff(id)` [NEW]
  - `revertSession(id, messageId)` / `unrevertSession(id)` [NEW]
- [ ] Conversation methods:
  - `getMessages(sessionId)` — `client.session.messages(id)` + transform
- [ ] Permission methods:
  - `respondToPermission(sessionId, permissionId, reply)` — `client.postSessionIdPermissionsPermissionId({ path: { id, permissionID }, body: { response } })`
  - Active permissions tracked from SSE `permission.updated` events (no list API)
  - Permission completion detected via SSE `permission.replied` event (**SPIKE: event exists**)
- [ ] File methods:
  - `findFiles(query)` — `client.find.files({ query })`
  - `findText(pattern)` — `client.find.text({ pattern })`
  - `readFile(path)` — `client.file.read({ path })`
- [ ] System methods:
  - `health()` — raw `GET /global/health` (no dedicated SDK method on client class)
  - `getConfig()` — `client.config.get()`
  - `listProviders()` — `client.provider.list()` OR `client.config.providers()` (both exist, different shapes)
  - `listAgents()` — `client.app.agents()` (**SPIKE: NOT app.modes()**)
- [ ] Event subscription:
  - `subscribe()` — `client.event.subscribe()` → `ServerSentEventsResult` (**SPIKE: NOT event.list()**)

#### 1.6 Tests

- [ ] Transformer unit tests (the most critical):
  - `transformMessages` with text, tool calls, thinking, tool results
  - `transformSession` with various statuses
  - `transformPermission`
  - `aggregateSessionMetrics`
- [ ] Event adapter tests

### Files Created

| File                                              | Lines (est.) | Purpose                   |
| ------------------------------------------------- | ------------ | ------------------------- |
| `src/lib/opencode/types.ts`                       | ~150         | Internal type definitions |
| `src/lib/opencode/transformers.ts`                | ~300         | Data model mapping        |
| `src/lib/opencode/events.ts`                      | ~150         | SSE event adapter         |
| `src/lib/opencode/client.ts`                      | ~400         | Main client adapter       |
| `src/lib/opencode/index.ts`                       | ~20          | Barrel export             |
| `src/lib/opencode/__tests__/transformers.test.ts` | ~300         | Transformer tests         |

### Verification

```bash
bun test src/lib/opencode/
bun run typecheck  # may have errors in hooks/store — OK at this stage
```

---

## Session 2: Tauri Layer (~120k tokens)

**Goal:** App can start opencode server process and connect to it. Health check works.

**Pre-requisites:** None (independent of Session 1)

### Subagent Strategy

| Phase | Agent                 | Task                                             |
| ----- | --------------------- | ------------------------------------------------ |
| Start | explorer (background) | Read existing daemon.rs, lib.rs, tauri.conf.json |
| Main  | developer (sync)      | Rewrite Rust files                               |

### Tasks

#### 2.1 Server Process Manager (`src-tauri/src/server.rs`)

- [ ] Rename DaemonInfo → ServerInfo { port, pid, base_url, is_running }
- [ ] Find opencode binary (PATH or bundled)
- [ ] Launch: `opencode serve --port 0 --hostname 127.0.0.1`
- [ ] Parse port from stdout: loop lines until `"opencode server listening on http://..."`, regex `/on\s+(https?:\/\/[^\s]+)/` (R5: may have warning line before listening line)
- [ ] Pass config via `OPENCODE_CONFIG_CONTENT` env var (R5: JSON string, no file needed)
- [ ] Health check: `GET /global/health` → `{ "healthy": true, "version": "..." }` (R5)
- [ ] Process monitoring (background task, 1s interval)
- [ ] Graceful shutdown: SIGTERM → wait 15s → SIGKILL (R5: no SIGTERM handler in opencode yet, GitHub #9859)

#### 2.2 Tauri Commands (`src-tauri/src/lib.rs`)

- [ ] Rename commands: start_daemon → start_server, etc.
- [ ] Update environment variables: HUMANLAYER\_\* → OPENCODE\_\* (R5: `OPENCODE_CONFIG_CONTENT`, `OPENCODE_SERVER_PASSWORD`)
- [ ] Update state management for ServerInfo
- [ ] Remove hld-specific logic (branch-based DB path, socket path)
- [ ] Remove `HUMANLAYER_DATABASE_PATH`, `HUMANLAYER_DAEMON_SOCKET`, `HUMANLAYER_DAEMON_HTTP_*` env vars

#### 2.3 Tauri Config

- [ ] `tauri.conf.json`: Update productName, identifier, resources
- [ ] Remove `bin/hld` and `bin/humanlayer` from bundled resources
- [ ] Add `bin/opencode` if bundling (or rely on PATH)

#### 2.4 Frontend Connection

- [ ] Update URL resolution in `src/lib/` (or `src/services/`)
  - Remove hld-specific URL detection
  - Use Tauri command `get_server_info` → `http://localhost:{port}`
  - Fallback: `http://localhost:4096`
- [ ] Update connection health check to use `/global/health`
- [ ] Add `x-opencode-directory` header to all API calls (R5: opencode resolves working dir per-request via header or query param)

### Files Modified

| File                                           | Action  | Complexity |
| ---------------------------------------------- | ------- | ---------- |
| `src-tauri/src/daemon.rs` → `server.rs`        | Rewrite | High       |
| `src-tauri/src/lib.rs`                         | Adapt   | Medium     |
| `src-tauri/tauri.conf.json`                    | Update  | Low        |
| `src/services/daemon-service.ts` or equivalent | Adapt   | Medium     |

### Verification

```bash
# Rust compiles
cd src-tauri && cargo check

# Manual: launch app, check opencode starts and health check passes
```

---

## Session 3a: Hooks (~120k tokens)

**Goal:** All React hooks migrated to use opencode adapter. Data flows work in isolation.

**Pre-requisites:** Session 1 complete (adapter layer available)

> **Split rationale (R4):** Original Session 3 combined hooks + store (5 of 8 files rated "High" complexity). R4 analysis found 13 daemon client methods in AppStore + 8 complex hooks. Splitting reduces risk and allows incremental verification.

### Subagent Strategy

| Phase | Agent                    | Task                                        |
| ----- | ------------------------ | ------------------------------------------- |
| Start | explorer ×2 (background) | Read all hooks + existing subscription code |
| Main  | implement sequentially   | Hook by hook, verifying types               |

### Tasks

#### 3a.1 Connection Hook

- [ ] `useDaemonConnection` → `useServerConnection`
  - New health check endpoint: `GET /global/health` → `{ healthy: true }` (R5)
  - New URL resolution (remove hld URL detection)
  - Connection status tracking
  - Add `x-opencode-directory` header support (R5)

#### 3a.2 Subscription Hook

- [ ] `useSubscriptions` (heavy rewrite)
  - Use event adapter from Session 1
  - Map opencode events to internal events
  - Handle reconnection / heartbeat
  - Register handlers for: session updates, permissions, conversation updates
  - Use `client.event.subscribe()` → `ServerSentEventsResult` (**SPIKE: NOT event.list()**)

#### 3a.3 Sessions Hook

- [ ] `useSessions` adaptation
  - Use `client.listSessions()` from adapter
  - Client-side filtering (archived only — no drafts in opencode, R4/R12)
  - Session counts computed client-side (R10: no server-side filter/counts)
  - Status mapping (idle/busy/retry → UI states)

#### 3a.4 Conversation Hook

- [ ] `useConversation` (heavy rewrite)
  - Use `client.getMessages()` which returns transformed flat events
  - Real-time updates via `message.updated` / `message.part.updated` events
  - Streaming support: partial text, tool progress
  - Consider: switch from polling to pure SSE-driven updates?

#### 3a.5 Permissions Hook

- [ ] `useApprovals` → `usePermissions`
  - No list API — track from SSE `permission.updated` events (R3: NOT `permission.asked`)
  - Store active permissions in local state
  - Decision: once / always / reject (instead of approve / deny) — use `client.postSessionIdPermissionsPermissionId()`
  - Remove comment support (opencode has no comment field)
  - Detect completion via `permission.replied` SSE event (**SPIKE: event exists**, no need for tool state workaround)

#### 3a.6 Remove/Replace Utility Files

- [ ] `src/utils/errors.ts` — replace ResponseError with standard handling
- [ ] `src/services/daemon-service.ts` → `src/services/server-service.ts`

### Files Modified

| File                                              | Action         | Complexity |
| ------------------------------------------------- | -------------- | ---------- |
| `src/hooks/useDaemonConnection.ts`                | Rewrite        | Medium     |
| `src/hooks/useSubscriptions.ts`                   | Heavy rewrite  | High       |
| `src/hooks/useSessions.ts`                        | Adapt          | Medium     |
| `src/hooks/useConversation.ts`                    | Heavy rewrite  | High       |
| `src/hooks/useApprovals.ts` → `usePermissions.ts` | Rewrite        | High       |
| `src/utils/errors.ts`                             | Simplify       | Low        |
| `src/services/daemon-service.ts`                  | Rename + adapt | Medium     |

### Verification

```bash
bun run typecheck  # should pass or have only store/UI-level errors
bun test           # hooks tests pass
```

---

## Session 3b: AppStore (~100k tokens)

**Goal:** Central Zustand store fully migrated. All daemon client calls replaced with opencode adapter.

**Pre-requisites:** Session 3a complete (hooks available)

### Subagent Strategy

| Phase | Agent                 | Task                                               |
| ----- | --------------------- | -------------------------------------------------- |
| Start | explorer (background) | Read AppStore.ts, identify all daemon client calls |
| Main  | implement             | Method by method, preserving optimistic patterns   |

### Tasks

#### 3b.1 Replace Daemon Client Calls (R4: 13 methods)

- [ ] `refreshSessions()` — `client.session.list()` + client-side filter/count (R4/R10)
- [ ] `fetchActiveSessionDetail()` — `client.session.get(id)` + `client.session.messages(id)`
- [ ] `updateSessionOptimistic()` — Keep 2s pending preservation pattern (R4), adapt field names
- [ ] `interruptSession()` — `client.session.abort(id)` (remove `claudeSessionId` check)
- [ ] `archiveSession()` — **No archive API in opencode** (only `session.delete()`). Emulate client-side (e.g., local storage flag) or remove feature
- [ ] `bulkArchiveSessions()` — **No archive or bulk archive API in opencode**. Remove or emulate client-side
- [ ] `continueSession()` — `client.session.prompt(id, { parts })`
- [ ] `fetchUserSettings()` / `updateUserSettings()` — `client.config.get()` / `client.config.update()` (**SPIKE: NOT config.patch()**)
- [ ] `fetchClaudeConfig()` / `updateClaudePath()` — Replace with `client.provider.list()` or `client.config.providers()` (**SPIKE: NOT app.providers()** — R4 was wrong)

#### 3b.2 Adapt Session Model

- [ ] Adapt Session model in store (new fields: share, summary; **slug confirmed absent in SPIKE — do not reference**)
- [ ] Remove hld-specific state: `runId`, `claudeSessionId`, proxy settings, `editorState` (R4)
- [ ] Add new state: providers cache, permissions cache
- [ ] Adapt session filtering: remove `ViewMode.Drafts` (R4/R12: no drafts in opencode)

#### 3b.3 Remove hld-Specific Features (R4: "Can Be Removed")

- [ ] Remove `bulkDiscardDrafts()`, `launchDraftSession()`, `deleteDraftSession()`
- [ ] Remove `getSlashCommands()`, `searchSessions()`, `getSessionSnapshots()`
- [ ] Remove `getDebugInfo()`, `getRecentPaths()`, `getConfigStatus()`
- [ ] Remove `claudeConfig` state (replace with provider state from `client.provider.list()` or `client.config.providers()` — **SPIKE: NOT app.providers()**)
- [ ] Remove `dangerouslySkipPermissions` periodic cleanup (R4: opencode uses per-tool "always allow")

#### 3b.4 Adapt Optimistic Updates

- [ ] Preserve 2-second pending update preservation pattern (R4: critical for UX)
- [ ] Adapt field mappings (camelCase hld → opencode field names)
- [ ] Keep rollback-on-failure pattern

### Files Modified

| File              | Action      | Complexity |
| ----------------- | ----------- | ---------- |
| `src/AppStore.ts` | Heavy adapt | High       |

### Verification

```bash
bun run typecheck  # should pass or have only UI-level errors
bun test           # store tests pass
# Manual: app shows session list, conversation loads
```

---

## Session 4: UI Components + Polish (~150k tokens)

**Goal:** Fully working application. All type errors fixed. Tests pass.

**Pre-requisites:** Sessions 1, 2, 3a, 3b complete

### Subagent Strategy

| Phase | Agent                 | Task                                           |
| ----- | --------------------- | ---------------------------------------------- |
| Start | explorer (background) | Find all remaining @humanlayer/hld-sdk imports |
| Main  | implement             | Fix component types, then typecheck loop       |

### Tasks

#### 4.1 Conversation Components

- [ ] `ConversationEventRow.tsx` — adapt to internal types
- [ ] `ConversationStream.tsx` — rendering pipeline
- [ ] Tool content components (7 files):
  - BashToolCallContent
  - EditToolCallContent
  - MultiEditToolCallContent
  - NotebookEditToolCallContent
  - NotebookReadToolCallContent
  - ExitPlanModeToolCallContent
  - TaskGroupEventRow
- [ ] Replace `ApprovalStatus` → `PermissionStatus` or internal type

#### 4.2 Session Components

- [ ] `SessionTable` — status badges, filtering UI
- [ ] `SessionDetail` — new fields (share, diff, fork buttons)
- [ ] `QuickLauncher` — provider/model selection from opencode

#### 4.3 New Feature Components (optional for V1)

- [ ] Share session dialog
- [ ] Session diff viewer
- [ ] Provider selector
- [ ] Fork session UI
- [ ] Todo list (server-side)

#### 4.4 Cleanup

- [ ] Remove ALL `@humanlayer/hld-sdk` imports
- [ ] Remove ALL `hld` references in code and comments
- [ ] Update branding (CodeLayer → OpenCode UI)
- [ ] Update `package.json` metadata

#### 4.5 Type Check + Lint

- [ ] `bun run typecheck` — fix all errors
- [ ] `bun run lint` — fix all warnings
- [ ] Iterative: fix → check → fix until clean

#### 4.6 Tests

- [ ] Update/fix existing tests
- [ ] Add tests for new components if needed
- [ ] Storybook stories (if maintaining)

### Verification

```bash
bun run typecheck   # 0 errors
bun run lint        # 0 errors
bun test            # all pass
bun run build       # successful build
# Manual E2E: create session, see conversation, approve permission, archive
```

---

## Risk Register

> **Updated post-research (R1-R5).** All major risks have been investigated. No open unknowns remain.

| #   | Risk                                                    | Impact     | Probability | Status                      | Mitigation                                                                                                                                                                     |
| --- | ------------------------------------------------------- | ---------- | ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | ~~opencode SDK API differs from research assumptions~~  | ~~High~~   | ~~Medium~~  | **CLOSED/MITIGATED**        | R1 confirmed types. Additional diffs found: `mode` not `agent` on AssistantMessage, `slug` not in SDK types. Documented in API Differences table above                         |
| 2   | Message/Part → flat events transformer too complex      | High       | Medium      | **CONFIRMED HIGH**          | R1 documents all 12 Part types with exact field definitions. ToolState has 4 variants. Session 1 focuses ONLY on this; extensive tests required                                |
| 3   | Permission model too different for existing approval UI | Medium     | High        | **CLOSED/MITIGATED**        | R3 documents exact flow: `permission.updated` event → `client.session.permissions.respond()` with once/always/reject. No comments. Add "Always Allow"                          |
| 4   | Permission API poorly documented in SDK                 | Medium     | High        | **CLOSED/MITIGATED**        | R3 found Go SDK source + semantic TS wrapper. Endpoint: `POST /session/{id}/permissions/{permId}`, body: `{ response: "once"\|"always"\|"reject" }`                            |
| 5   | opencode binary not available on user machine           | Medium     | Medium      | Open                        | Check PATH at startup; show install instructions                                                                                                                               |
| 6   | Tauri/Rust changes need debugging                       | Medium     | Low         | Open                        | Session 2 is independent; R5 provides exact Rust code patterns for port detection and spawn                                                                                    |
| 7   | ~~Session 3 too wide (hooks + store)~~                  | ~~Med~~    | ~~Medium~~  | **CLOSED/RESOLVED**         | R4 confirmed scope concern. **Split into Session 3a (hooks) and 3b (store)** in this roadmap                                                                                   |
| 8   | SSE event storm from 30+ event types                    | Low        | Medium      | Open                        | R1 documents all event types. Event adapter filters aggressively — only ~8 events are UI-relevant                                                                              |
| 9   | No auth on opencode server by default (CVE-2026-22812)  | Low        | Low         | Open                        | R5: localhost only by default. Optional `OPENCODE_SERVER_PASSWORD` for Basic Auth                                                                                              |
| 10  | No server-side session filtering in opencode            | Medium     | **Certain** | **CONFIRMED (R4)**          | opencode has no `filter=normal\|archived\|draft`. Must filter client-side. Fetch all sessions, filter/count locally                                                            |
| 11  | Port detection format changed                           | Low        | **Certain** | **CONFIRMED (R5)**          | R5 provides exact regex and Rust code. Parse: `"opencode server listening on http://..."`. Handle warning line before listen line                                              |
| 12  | No draft sessions in opencode                           | Low        | **Certain** | **CONFIRMED (R4)**          | Remove ViewMode.Drafts, bulkDiscardDrafts(), draft-related state entirely. Addressed in Session 3b                                                                             |
| 13  | No SIGTERM handler in opencode (GitHub #9859)           | Low        | **Certain** | **CONFIRMED (R5)**          | Keep SIGTERM+SIGKILL pattern with 15s timeout. Addressed in Session 2                                                                                                          |
| 14  | ~~`permission.replied` event doesn't exist~~            | ~~Medium~~ | ~~Certain~~ | **CLOSED/RESOLVED (SPIKE)** | **SPIKE disproved R3**: `EventPermissionReplied` EXISTS with `{ sessionID, permissionID, response }`. No tool-state workaround needed. Use `permission.replied` event directly |
| 15  | Working directory passed per-request                    | Low        | **Certain** | **NEW (R5)**                | R5: opencode resolves dir via `x-opencode-directory` header or `?directory=` query param. Must add to all API calls. Addressed in Session 2                                    |

---

## Effort Summary

| Session       | Estimated Effort   | Token Budget   | Files Touched |
| ------------- | ------------------ | -------------- | ------------- |
| 0 (Setup)     | ~~Complete~~       | ~~Done~~       | 7 docs        |
| 1 (Adapter)   | ~4-6 hours AI time | ~180k          | 6 new files   |
| 2 (Tauri)     | ~2-3 hours AI time | ~120k          | 4 files       |
| 3a (Hooks)    | ~3-4 hours AI time | ~120k          | 7 files       |
| 3b (Store)    | ~2-3 hours AI time | ~100k          | 1 file (big)  |
| 4 (UI+Polish) | ~3-4 hours AI time | ~150k          | 15+ files     |
| **Total**     | **~15-20 hours**   | **5 sessions** | **~30 files** |

---

## Quick Start for Each Session

### Session 1

```
Read: OPENCODE_MIGRATION_ROADMAP.md, R1_SDK_TYPE_REFERENCE.md, R3_PERMISSION_FLOW.md
Then: Start with 1.1 (bootstrap), proceed to 1.2-1.6
Key ref: R1 for all Part types, R3 for permission event flow
```

### Session 2

```
Read: OPENCODE_MIGRATION_ROADMAP.md (Session 2 section), R5_OPENCODE_SERVE_BEHAVIOR.md
Read: src-tauri/src/daemon.rs, src-tauri/src/lib.rs
Then: Implement server.rs, update lib.rs
Key ref: R5 for port detection regex, env vars, health check format
```

### Session 3a

```
Read: OPENCODE_MIGRATION_ROADMAP.md (Session 3a section), R2_DAEMON_CLIENT_INTERFACE.md, R3_PERMISSION_FLOW.md
Read: src/lib/opencode/ (from Session 1)
Then: Hook by hook — connection, subscriptions, sessions, conversation, permissions
Key ref: R2 for must-implement methods, R3 for permission hook rewrite
```

### Session 3b

```
Read: OPENCODE_MIGRATION_ROADMAP.md (Session 3b section), R4_APPSTORE_ANALYSIS.md
Read: src/lib/opencode/ (from Session 1), migrated hooks (from Session 3a)
Then: Replace daemon calls method-by-method, preserving optimistic update patterns
Key ref: R4 for all daemon calls, migration categories, and removal list
```

### Session 4

```
Read: OPENCODE_MIGRATION_ROADMAP.md (Session 4 section)
Then: grep for @humanlayer/hld-sdk, fix all imports, typecheck loop
```
