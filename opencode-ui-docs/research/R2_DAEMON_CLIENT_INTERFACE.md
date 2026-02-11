# R2: Current DaemonClient Interface Snapshot

> Research output for the opencode migration.
> Source files: `humanlayer-wui/src/lib/daemon/`

---

## 1. Module Structure

```
src/lib/daemon/
├── index.ts          — barrel re-exports (client, types, errors)
├── client.ts         — singleton: `export const daemonClient = new HTTPDaemonClient()`
├── http-client.ts    — main implementation (770 lines)
├── types.ts          — interfaces, enums, type aliases (471 lines)
├── errors.ts         — DaemonError, ConnectionError, RPCError (28 lines)
└── http-config.ts    — URL resolution, headers (69 lines)
```

**Key singleton pattern:** `client.ts:4` creates one global `HTTPDaemonClient` instance exported as `daemonClient`. All hooks and the AppStore import from here.

---

## 2. DaemonClient Interface

Defined in `types.ts:77-175`. This is the contract that the opencode adapter must fulfill.

```typescript
interface DaemonClient {
  // Connection lifecycle
  connect(): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  health(): Promise<HealthCheckResponse>;

  // Session methods
  launchSession(
    params: LaunchSessionParams | LaunchSessionRequest,
  ): Promise<CreateSessionResponseData>;
  getSlashCommands(params: {
    workingDir: string;
    query?: string;
  }): Promise<{ data: Array<{ name: string; source: "local" | "global" }> }>;
  searchSessions(params: {
    query?: string;
    limit?: number;
  }): Promise<{ data: Session[] }>;
  listSessions(): Promise<Session[]>;
  getSessionLeaves(request?: {
    filter?: "normal" | "archived" | "draft";
  }): Promise<{
    sessions: Session[];
    counts?: { normal?: number; archived?: number; draft?: number };
  }>;
  getSessionState(sessionId: string): Promise<SessionState>;
  continueSession(
    sessionId: string,
    message: string,
  ): Promise<{ success: boolean; new_session_id?: string }>;
  interruptSession(sessionId: string): Promise<{ success: boolean }>;
  updateSessionSettings(
    sessionId: string,
    settings: {
      auto_accept_edits?: boolean;
      dangerously_skip_permissions?: boolean;
      dangerously_skip_permissions_timeout_ms?: number;
    },
  ): Promise<{ success: boolean }>;
  updateSession(
    sessionId: string,
    updates: {
      model?: string;
      title?: string;
      archived?: boolean;
      autoAcceptEdits?: boolean;
      dangerouslySkipPermissions?: boolean;
      dangerouslySkipPermissionsTimeoutMs?: number;
      additionalDirectories?: string[];
      workingDir?: string;
      proxyEnabled?: boolean;
      proxyBaseUrl?: string;
      proxyModelOverride?: string;
      proxyApiKey?: string;
    },
  ): Promise<{ success: boolean }>;
  archiveSession(
    sessionIdOrRequest: string | { session_id: string; archived: boolean },
  ): Promise<{ success: boolean }>;
  bulkArchiveSessions(
    sessionIdsOrRequest:
      | string[]
      | { session_ids: string[]; archived: boolean },
  ): Promise<{ success: boolean; archived_count: number }>;
  updateSessionTitle(
    sessionId: string,
    title: string,
  ): Promise<{ success: boolean }>;

  // Conversation methods
  getConversation(
    params: { session_id?: string; claude_session_id?: string },
    options?: RequestInit,
  ): Promise<ConversationEvent[]>;
  getSessionSnapshots(sessionId: string): Promise<SessionSnapshot[]>;

  // Approval methods
  fetchApprovals(sessionId?: string): Promise<Approval[]>;
  sendDecision(
    approvalId: string,
    decision: "approve" | "deny",
    comment?: string,
  ): Promise<{ success: boolean; error?: string }>;
  approveFunctionCall(
    approvalId: string,
    comment?: string,
  ): Promise<{ success: boolean; error?: string }>;
  denyFunctionCall(
    approvalId: string,
    comment?: string,
  ): Promise<{ success: boolean; error?: string }>;

  // Event subscription
  subscribeToEvents(options: SubscribeOptions): SubscriptionHandle;

  // Utility methods
  getRecentPaths(limit?: number): Promise<RecentPath[]>;
  getDebugInfo(): Promise<DebugInfo>;
  fuzzySearchFiles(params: {
    query: string;
    paths: string[];
    limit?: number;
    filesOnly?: boolean;
    respectGitignore?: boolean;
  }): Promise<FuzzySearchFilesResponse>;
  discoverAgents(workingDir: string): Promise<Agent[]>;
}
```

---

## 3. Method-by-Method Documentation

### 3.1 Connection Lifecycle

| Method         | SDK Call                                         | Behavior                                                                     |
| -------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------ |
| `connect()`    | `new HLDClient({ baseUrl })` + `client.health()` | Creates SDK client, verifies with health check. Retries 3x with 500ms delay. |
| `reconnect()`  | `disconnect()` → `connect()`                     | Full teardown and reconnect. Used when daemon port changes.                  |
| `disconnect()` | None                                             | Unsubscribes all SSE streams, clears client reference, resets state.         |
| `health()`     | `client.health()`                                | Returns `HealthCheckResponse` (`{ status: 'ok'                               | 'degraded', dependencies? }`). |

**Connection flow** (`http-client.ts:40-111`):

1. `connect()` → `connectWithRetries()` → `doConnect()`
2. `doConnect()`: resolves URL via `getDaemonUrl()`, creates `HLDClient`, calls `health()` with 5s timeout
3. Accepts both `'ok'` and `'degraded'` health status
4. On failure: retries up to 3x with 500ms delay, then throws `"Cannot connect to daemon. Is it running?"`

### 3.2 Session Methods

| Method                                | HTTP Endpoint (via SDK)                  | Transformations                                                                                               | Error Handling |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------- |
| `listSessions()`                      | `GET /sessions?leavesOnly=true`          | `sessions.map(transformSDKSession)`                                                                           | Throws         |
| `getSessionLeaves(filter?)`           | `GET /sessions?leavesOnly=true&filter=X` | `data.map(transformSDKSession)`, returns `{ sessions, counts }`                                               | Throws         |
| `getSessionState(id)`                 | `GET /sessions/{id}`                     | `transformSDKSession(session)`, returns `{ session, pendingApprovals: [] }`                                   | Throws         |
| `launchSession(params)`               | `POST /sessions`                         | Complex param mapping (camelCase ↔ snake_case), provider-specific model handling                              | Throws         |
| `continueSession(id, msg)`            | `POST /sessions/{id}/continue`           | Returns `{ success: true, new_session_id }`                                                                   | Throws         |
| `interruptSession(id)`                | `POST /sessions/{id}/interrupt`          | Returns `{ success: true }`                                                                                   | Throws         |
| `updateSession(id, updates)`          | `PATCH /sessions/{id}`                   | Maps camelCase→snake_case for API                                                                             | Throws         |
| `updateSessionSettings(id, settings)` | `PATCH /sessions/{id}`                   | Maps `auto_accept_edits` → `auto_accept_edits`, `dangerously_skip_permissions` → `dangerouslySkipPermissions` | Logs + throws  |
| `archiveSession(idOrReq)`             | `POST /sessions/archive`                 | Accepts string or `{ session_id, archived }`                                                                  | Throws         |
| `bulkArchiveSessions(idsOrReq)`       | `POST /sessions/archive` (bulk)          | Accepts array or `{ session_ids, archived }`                                                                  | Throws         |
| `updateSessionTitle(id, title)`       | `PATCH /sessions/{id}` with `{ title }`  | Simple delegation                                                                                             | Throws         |
| `searchSessions(params)`              | `POST /sessions/search`                  | `data.map(transformSDKSession)`                                                                               | Throws         |
| `getSlashCommands(params)`            | `GET /slash-commands`                    | Direct passthrough                                                                                            | Throws         |

**`transformSDKSession`** (`types.ts:464-470`): Simple function that ensures `dangerouslySkipPermissions` defaults to `false`.

**`launchSession` details** (`http-client.ts:169-251`): Most complex method. Handles:

- Provider-specific model formatting (anthropic: `sonnet`/`opus`/`haiku`, openrouter/baseten: proxy config)
- Maps both `LaunchSessionParams` (camelCase) and `LaunchSessionRequest` (snake_case) formats
- Proxy configuration injection for openrouter/baseten providers

### 3.3 Conversation Methods

| Method                            | HTTP Endpoint                  | Return Type                                 |
| --------------------------------- | ------------------------------ | ------------------------------------------- |
| `getConversation({ session_id })` | `GET /sessions/{id}/messages`  | `ConversationEvent[]` — flat list of events |
| `getSessionSnapshots(id)`         | `GET /sessions/{id}/snapshots` | `SessionSnapshot[]` — file snapshot info    |

**Snapshot transformation** (`http-client.ts:545-555`): Converts SDK camelCase (`toolId`, `filePath`, `createdAt`) to snake_case (`tool_id`, `file_path`, `created_at`).

### 3.4 Approval Methods

| Method                                 | HTTP Endpoint                                              | Notes                                          |
| -------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `fetchApprovals(sessionId?)`           | `GET /approvals?session_id=X`                              | Returns `Approval[]`                           |
| `sendDecision(id, decision, comment?)` | `POST /approvals/{id}/decide` with `{ decision, comment }` | Returns `{ success, error? }` — catches errors |
| `approveFunctionCall(id, comment?)`    | Delegates to `sendDecision(id, 'approve', comment)`        | Convenience wrapper                            |
| `denyFunctionCall(id, comment?)`       | Delegates to `sendDecision(id, 'deny', comment)`           | Convenience wrapper                            |

**Error handling** (`http-client.ts:565-580`): `sendDecision` is unique — it catches errors and returns `{ success: false, error: message }` instead of throwing.

### 3.5 Event Subscription

```typescript
subscribeToEvents(options: SubscribeOptions): SubscriptionHandle
```

**SubscribeOptions** (`types.ts:56-61`):

```typescript
interface SubscribeOptions {
  event_types?: EventType[]; // Filter by event type
  session_id?: string; // Filter by session
  run_id?: string; // Filter by run
  onEvent: (event: Event) => void; // Callback
}
```

**SubscriptionHandle** (`types.ts:63-65`):

```typescript
interface SubscriptionHandle {
  unsubscribe: () => void;
}
```

**Implementation** (`http-client.ts:599-652`):

1. Generates unique subscription ID
2. Calls `this.client.subscribeToEvents(filters, { onMessage, onError, onDisconnect })`
3. Maps SDK events: converts string timestamps to Date objects
4. On error: logs, attempts reconnection if disconnected
5. On disconnect: removes from active subscriptions map
6. All active subscriptions stored in `Map<string, () => void>`
7. `disconnect()` unsubscribes all active streams

### 3.6 Utility Methods

| Method                         | HTTP Endpoint               | Notes                             |
| ------------------------------ | --------------------------- | --------------------------------- |
| `getRecentPaths(limit?)`       | `GET /recent-paths`         | Limit param unused currently      |
| `fuzzySearchFiles(params)`     | `POST /fuzzy-search-files`  | Direct passthrough                |
| `validateDirectory(path)`      | SDK method                  | Direct passthrough                |
| `createDirectory(path)`        | SDK method                  | Direct passthrough                |
| `discoverAgents(workingDir)`   | `POST /discover-agents`     | Returns `response.agents \|\| []` |
| `getDebugInfo()`               | `GET /api/v1/debug-info`    | Direct fetch (not via SDK)        |
| `getConfigStatus()`            | `GET /api/v1/config/status` | Direct fetch (not via SDK)        |
| `getUserSettings()`            | SDK method                  | Direct passthrough                |
| `updateUserSettings(settings)` | SDK method                  | Direct passthrough                |
| `getConfig()`                  | SDK method                  | Direct passthrough                |
| `updateConfig(settings)`       | SDK method                  | Direct passthrough                |

**Note:** `getDebugInfo()` and `getConfigStatus()` bypass the SDK and use raw `fetch()` — these are hld-specific endpoints.

---

## 4. Additional Methods NOT in Interface

These methods exist on `HTTPDaemonClient` but are NOT declared in the `DaemonClient` interface:

| Method                                       | Source                   | Notes                                      |
| -------------------------------------------- | ------------------------ | ------------------------------------------ |
| `launchDraftSession(id, prompt, createDir?)` | `http-client.ts:318-355` | Handles 422 errors for directory_not_found |
| `deleteDraftSession(id)`                     | `http-client.ts:357-361` | Simple delegation                          |
| `bulkRestoreDrafts({ session_ids })`         | `http-client.ts:439-446` | Direct passthrough                         |
| `getConfigStatus()`                          | `http-client.ts:720-730` | Raw fetch, not via SDK                     |
| `getUserSettings()`                          | `http-client.ts:732-738` | Via SDK                                    |
| `updateUserSettings(settings)`               | `http-client.ts:740-746` | Via SDK                                    |
| `getConfig()`                                | `http-client.ts:748-754` | Via SDK                                    |
| `updateConfig(settings)`                     | `http-client.ts:756-762` | Via SDK                                    |
| `validateDirectory(path)`                    | `http-client.ts:677-681` | Via SDK                                    |
| `createDirectory(path)`                      | `http-client.ts:683-686` | Via SDK                                    |

---

## 5. URL Resolution (`http-config.ts`)

Priority order for daemon URL:

1. `window.__HUMANLAYER_DAEMON_URL` (debug override)
2. `localStorage['codelayer.daemon.url']` (persisted, non-Tauri only)
3. `VITE_HUMANLAYER_DAEMON_URL` env var
4. Tauri managed daemon: `daemonService.getDaemonInfo()` → `http://localhost:{port}`
5. Fallback: `http://{VITE_HUMANLAYER_DAEMON_HTTP_HOST||localhost}:{VITE_HUMANLAYER_DAEMON_HTTP_PORT||7777}`

**Headers** sent with every request:

```typescript
{ 'X-Client': 'codelayer', 'X-Client-Version': getAppVersion() }
```

---

## 6. Error Classes (`errors.ts`)

```typescript
class DaemonError extends Error {
  code?: string;
  details?: any;
}
class ConnectionError extends DaemonError {
  code = "CONNECTION_ERROR";
}
class RPCError extends DaemonError {
  code = "RPC_ERROR";
}
```

These are defined but **not widely used** in http-client.ts. Most methods just throw raw errors from the SDK or create plain `Error` objects.

---

## 7. Supporting Types

### Session (extended from SDK)

```typescript
// types.ts:24-26
interface Session extends SDKSession {
  additionalDirectories?: string[];
}
```

### SessionState

```typescript
// types.ts:51-54
interface SessionState {
  session: Session;
  pendingApprovals: Approval[];
}
```

### LaunchSessionParams (WUI-specific)

```typescript
// types.ts:34-49 — camelCase format
interface LaunchSessionParams {
  query: string;
  title?: string;
  provider?: "anthropic" | "openrouter" | "baseten";
  model?: string;
  workingDir?: string;
  mcpConfig?: any;
  permissionPromptTool?: string;
  maxTurns?: number;
  autoAcceptEdits?: boolean;
  dangerouslySkipPermissions?: boolean;
  proxyApiKey?: string;
  additionalDirectories?: string[];
  draft?: boolean;
}
```

### LaunchSessionRequest (legacy snake_case)

```typescript
// types.ts:204-227 — snake_case format for protocol
interface LaunchSessionRequest {
  query: string;
  title?: string; /* ... 20+ fields in snake_case ... */
}
```

### Enums

```typescript
enum Decision {
  Approve = "approve",
  Deny = "deny",
}
enum ConversationEventType {
  Message,
  ToolCall,
  ToolResult,
  System,
  Thinking,
}
enum ConversationRole {
  User,
  Assistant,
  System,
}
enum ViewMode {
  Normal,
  Archived,
  Drafts,
}
```

---

## 8. Key Takeaways for Migration

### Must-implement methods (called by AppStore and hooks)

These are the methods actively called from `AppStore.ts` and hooks:

1. `connect()` / `reconnect()` / `disconnect()` / `health()`
2. `getSessionLeaves(filter)` — primary session list method
3. `getSessionState(id)` — used by `fetchActiveSessionDetail`
4. `getConversation({ session_id })` — used by conversation hooks
5. `updateSessionSettings(id, settings)` — used by optimistic updates
6. `archiveSession()` / `bulkArchiveSessions()` — session management
7. `interruptSession(id)` — stop running session
8. `continueSession(id, message)` — send follow-up message
9. `subscribeToEvents(options)` — SSE event stream
10. `sendDecision(id, decision, comment?)` — approval handling
11. `fetchApprovals(sessionId?)` — list approvals
12. `launchSession(params)` — create new session
13. `getUserSettings()` / `updateUserSettings()` — user preferences
14. `getConfig()` / `updateConfig()` — Claude configuration

### Can be dropped for opencode migration

- `getSlashCommands()` — hld-specific
- `searchSessions()` — hld-specific (opencode doesn't have server-side search)
- `getSessionSnapshots()` — hld-specific
- `getDebugInfo()` — hld-specific
- `getRecentPaths()` — hld-specific
- `fuzzySearchFiles()` — opencode has `client.find.files()` instead
- `discoverAgents()` — opencode uses `client.app.agents()` instead (**SPIKE: NOT app.modes()**)
- `validateDirectory()` / `createDirectory()` — hld-specific
- `launchDraftSession()` / `deleteDraftSession()` / `bulkRestoreDrafts()` — hld draft concept
- `getConfigStatus()` — hld-specific provider status
- `bulkSetBypassPermissions()` — hld-specific (opencode has "always allow" per-tool)

### Adapter design implications

1. **No interface abstraction needed** — opencode API is fundamentally different, better to create purpose-built adapter
2. **Return types will change** — opencode returns hierarchical Messages, not flat ConversationEvents
3. **Subscription model differs** — opencode uses `client.event.subscribe()` → `ServerSentEventsResult` (**SPIKE: NOT event.list()**)
4. **Approval → Permission** — different model (once/always/reject vs approve/deny+comment)
5. **Session filtering** — must be client-side for opencode (no server-side filter API)
6. **Error patterns** — most methods just throw; only `sendDecision` returns `{ success: false }`
