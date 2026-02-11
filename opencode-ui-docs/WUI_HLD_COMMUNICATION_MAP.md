# HumanLayer WUI ↔ HLD Daemon Communication Map

**Last Updated:** February 11, 2025  
**Purpose:** Complete reference for all communication between humanlayer-wui and hld daemon

---

## Table of Contents

1. [Connection Protocol](#connection-protocol)
2. [HTTP REST API Endpoints](#http-rest-api-endpoints)
3. [Server-Sent Events (SSE) Subscriptions](#server-sent-events-sse-subscriptions)
4. [Data Models](#data-models)
5. [Client Architecture](#client-architecture)
6. [Integration Points](#integration-points)

---

## Connection Protocol

### Transport Layer

- **Protocol:** HTTP/1.1 with Server-Sent Events (SSE)
- **Base URL:** `http://localhost:7777/api/v1` (default)
- **Alternative:** Unix socket at `~/.humanlayer/daemon.sock` (for Tauri integration)
- **Headers:**
  - `X-Client: codelayer`
  - `X-Client-Version: <app-version>`

### Connection Management

- **Client Class:** `HTTPDaemonClient` (in `humanlayer-wui/src/lib/daemon/http-client.ts`)
- **SDK Wrapper:** `HLDClient` (in `hld/sdk/typescript/src/client.ts`)
- **Connection Strategy:**
  - Lazy connection on first API call
  - Automatic retry with exponential backoff (max 3 retries, 500ms delay)
  - Health check on connection (accepts 'ok' or 'degraded' status)
  - Periodic health checks every 30 seconds when connected

### URL Resolution (Priority Order)

1. Debug panel override: `window.__HUMANLAYER_DAEMON_URL`
2. localStorage (non-Tauri): `codelayer.daemon.url`
3. Environment variable: `VITE_HUMANLAYER_DAEMON_URL`
4. Managed daemon: Query via `daemonService.getDaemonInfo()`
5. Default: `http://localhost:7777`

---

## HTTP REST API Endpoints

### Base Path

All endpoints are prefixed with `/api/v1`

### System Endpoints

#### Health Check

```
GET /health
Response: { status: 'ok' | 'degraded', version: string, dependencies?: {...} }
```

- Called on connection to verify daemon is running
- Periodic health checks every 30 seconds
- Used by `useDaemonConnection()` hook

#### Debug Info

```
GET /debug-info
Response: { path: string, size: number, table_count: number, stats: {...}, cli_command: string, last_modified?: string }
```

- Retrieves database statistics and debug information
- Called by debug panel in WUI

---

### Session Management Endpoints

#### Create Session

```
POST /sessions
Request: CreateSessionRequest {
  query: string
  title?: string
  workingDir: string
  model?: 'opus' | 'sonnet' | 'haiku'
  mcpConfig?: any
  permissionPromptTool?: string
  autoAcceptEdits?: boolean
  dangerouslySkipPermissions?: boolean
  allowedTools?: string[]
  disallowedTools?: string[]
  additionalDirectories?: string[]
  draft?: boolean
  proxyEnabled?: boolean
  proxyBaseUrl?: string
  proxyModelOverride?: string
  proxyApiKey?: string
}
Response: CreateSessionResponse { data: CreateSessionResponseData { sessionId: string, runId: string } }
```

- Creates new Claude Code session
- Supports multiple providers: anthropic, openrouter, baseten
- Called by `launchSession()` in `useSessions()` hook

#### List Sessions

```
GET /sessions?leavesOnly=true&filter=normal|archived|draft
Response: SessionsResponse {
  data: Session[]
  counts?: { normal?: number, archived?: number, draft?: number }
}
```

- Retrieves all sessions (leaf nodes only)
- Supports filtering by status
- Returns session counts for UI display
- Called by `getSessionLeaves()` in AppStore `refreshSessions()`

#### Get Session

```
GET /sessions/{id}
Response: SessionResponse { data: Session }
```

- Retrieves single session details
- Called by `getSessionState()` for active session detail

#### Update Session

```
PATCH /sessions/{id}
Request: UpdateSessionRequest {
  title?: string
  model?: string
  archived?: boolean
  autoAcceptEdits?: boolean
  dangerouslySkipPermissions?: boolean
  dangerouslySkipPermissionsTimeoutMs?: number
  additionalDirectories?: string[]
  workingDir?: string
  proxyEnabled?: boolean
  proxyBaseUrl?: string
  proxyModelOverride?: string
  proxyApiKey?: string
  editorState?: string
}
Response: SessionResponse { data: Session }
```

- Updates session settings
- Called by `updateSessionSettings()` for permission/edit settings
- Called by `updateSession()` for general updates

#### Continue Session

```
POST /sessions/{id}/continue
Request: ContinueSessionRequest { query: string }
Response: ContinueSessionResponse { sessionId: string, runId: string }
```

- Continues a completed session with new query
- Creates new session as child of original

#### Interrupt Session

```
POST /sessions/{id}/interrupt
Response: InterruptSessionResponse { success: boolean, sessionId: string, status: string }
```

- Stops running session
- Called by `interruptSession()` in AppStore

#### Archive Sessions (Bulk)

```
POST /sessions/archive
Request: BulkArchiveRequest { sessionIds: string[], archived: boolean }
Response: BulkArchiveResponse { archived: string[], failedSessions?: string[] }
```

- Archives or unarchives multiple sessions
- Called by `archiveSession()` and `bulkArchiveSessions()` in AppStore

#### Restore Draft Sessions (Bulk)

```
POST /sessions/restore-drafts
Request: BulkRestoreDraftsRequest { sessionIds: string[] }
Response: BulkRestoreDraftsResponse { success: boolean, failedSessions?: string[] }
```

- Restores discarded draft sessions
- Called by bulk restore action

#### Launch Draft Session

```
POST /sessions/{id}/launch-draft
Request: LaunchDraftSessionRequest { prompt: string, createDirectoryIfNotExists?: boolean }
Response: SessionResponse { data: Session }
```

- Launches a draft session with new prompt
- Can create working directory if needed
- Returns 422 with `directory_not_found` error if directory missing

#### Delete Draft Session

```
DELETE /sessions/{id}/draft
Response: void
```

- Permanently deletes draft session
- Called by `bulkDiscardDrafts()` in AppStore

#### Get Session Messages (Conversation)

```
GET /sessions/{id}/messages
Response: ConversationResponse { data: ConversationEvent[] }
```

- Retrieves conversation history for session
- Called by `getConversation()` in `useConversation()` hook
- Polled every 1 second while session is active

#### Get Session Snapshots

```
GET /sessions/{id}/snapshots
Response: SnapshotsResponse { data: FileSnapshot[] }
```

- Retrieves file snapshots from session
- Called by `getSessionSnapshots()` in AppStore

#### Get Slash Commands

```
GET /sessions/slash-commands?workingDir={dir}&query={query}
Response: SlashCommandsResponse { data: Array<{ name: string, source: 'local' | 'global' }> }
```

- Retrieves available slash commands for working directory
- Called by command palette in WUI

#### Search Sessions

```
GET /sessions/search?query={query}&limit={limit}
Response: SessionSearchResponse { data: Session[] }
```

- Full-text search across sessions
- Called by session search feature

#### Get Recent Paths

```
GET /sessions/recent-paths?limit={limit}
Response: RecentPathsResponse { data: RecentPath[] }
```

- Retrieves recently used working directories
- Called by `getRecentPaths()` for directory suggestions

---

### Approval Endpoints

#### List Approvals

```
GET /approvals?sessionId={sessionId}
Response: ApprovalsResponse { data: Approval[] }
```

- Retrieves all pending/resolved approvals
- Optional filter by session
- Called by `fetchApprovals()` in `useApprovals()` hook
- Polled on subscription events

#### Get Approval

```
GET /approvals/{id}
Response: ApprovalResponse { data: Approval }
```

- Retrieves single approval details

#### Create Approval

```
POST /approvals
Request: CreateApprovalRequest {
  sessionId: string
  toolName: string
  toolInputJson: string
  toolUseId?: string
  ...
}
Response: CreateApprovalResponse { data: CreateApprovalResponseData }
```

- Creates new approval request (called by daemon, not WUI)

#### Decide Approval

```
POST /approvals/{id}/decide
Request: DecideApprovalRequest { decision: 'approve' | 'deny', comment?: string }
Response: DecideApprovalResponse { data: DecideApprovalResponseData }
```

- Approves or denies approval request
- Called by `sendDecision()` in `useApprovals()` hook
- Triggers `approval_resolved` event

---

### File Operations Endpoints

#### Validate Directory

```
POST /files/validate-directory
Request: ValidateDirectoryRequest { path: string }
Response: ValidateDirectoryResponse { valid: boolean, error?: string }
```

- Checks if directory exists and is accessible
- Called by directory picker in WUI

#### Create Directory

```
POST /files/create-directory
Request: CreateDirectoryRequest { path: string }
Response: CreateDirectory200Response { success: boolean, path: string }
```

- Creates directory and parent directories
- Called by session launcher

#### Fuzzy Search Files

```
POST /files/fuzzy-search
Request: FuzzySearchFilesRequest {
  query: string
  paths: string[]
  limit?: number
  filesOnly?: boolean
  respectGitignore?: boolean
}
Response: FuzzySearchFilesResponse { matches: FileMatch[] }
```

- Searches files in specified paths
- Called by file picker in WUI

---

### Agent Discovery Endpoints

#### Discover Agents

```
POST /agents/discover
Request: DiscoverAgentsRequest { workingDir: string }
Response: DiscoverAgents200Response { agents: Agent[] }
```

- Discovers available agents in working directory
- Called by agent selection in session launcher

---

### Settings Endpoints

#### Get User Settings

```
GET /settings/user
Response: UserSettingsResponse {
  advancedProviders?: boolean
  optInTelemetry?: boolean
  ...
}
```

- Retrieves user preferences
- Called by `fetchUserSettings()` in AppStore

#### Update User Settings

```
PATCH /settings/user
Request: UpdateUserSettingsRequest {
  advancedProviders?: boolean
  optInTelemetry?: boolean
  ...
}
Response: UserSettingsResponse
```

- Updates user preferences
- Called by settings dialog in WUI

#### Get Config

```
GET /settings/config
Response: ConfigResponse {
  openrouter?: { api_key_configured: boolean }
  baseten?: { api_key_configured: boolean }
  ...
}
```

- Retrieves daemon configuration status
- Called by `getConfig()` in AppStore

#### Update Config

```
PATCH /settings/config
Request: UpdateConfigRequest { ... }
Response: ConfigResponse
```

- Updates daemon configuration
- Called by settings dialog

#### Get Config Status

```
GET /config/status
Response: ConfigStatus {
  openrouter: { api_key_configured: boolean }
  baseten: { api_key_configured: boolean }
}
```

- Quick check of provider API key configuration
- Called by provider selection UI

---

## Server-Sent Events (SSE) Subscriptions

### Event Stream Endpoint

```
GET /stream/events?eventTypes={type1}&eventTypes={type2}&sessionId={id}&runId={id}
```

### Connection Details

- **Protocol:** Server-Sent Events (HTTP/1.1 with persistent connection)
- **Format:** JSON events with `data:` prefix
- **Auto-reconnect:** Browser EventSource handles automatic reconnection
- **Polyfill:** Uses `eventsource` package for Node.js environments

### Event Types

#### 1. `new_approval`

```json
{
  "type": "new_approval",
  "timestamp": "2025-02-11T10:30:00Z",
  "data": {
    "approval_id": "apr_123",
    "session_id": "sess_456",
    "tool_name": "bash",
    "tool_use_id": "tool_789"
  }
}
```

- Fired when new approval request is created
- Triggers approval list refresh in `useApprovalsWithSubscription()`
- Triggers notification in WUI

#### 2. `approval_resolved`

```json
{
  "type": "approval_resolved",
  "timestamp": "2025-02-11T10:31:00Z",
  "data": {
    "approval_id": "apr_123",
    "session_id": "sess_456",
    "decision": "approve"
  }
}
```

- Fired when approval is approved/denied
- Triggers approval list refresh
- Removes from pending approvals display

#### 3. `session_status_changed`

```json
{
  "type": "session_status_changed",
  "timestamp": "2025-02-11T10:32:00Z",
  "data": {
    "session_id": "sess_456",
    "old_status": "running",
    "new_status": "completed"
  }
}
```

- Fired when session status changes (running → completed, etc.)
- Triggers session list refresh
- Updates session detail view
- Handled by `useSessionSubscriptions()` hook

#### 4. `session_settings_changed`

```json
{
  "type": "session_settings_changed",
  "timestamp": "2025-02-11T10:33:00Z",
  "data": {
    "session_id": "sess_456",
    "auto_accept_edits": true,
    "dangerously_skip_permissions": false,
    "dangerously_skip_permissions_timeout_ms": 3600000,
    "reason": "expired",
    "expired_at": "2025-02-11T11:33:00Z"
  }
}
```

- Fired when session settings are modified
- Includes reason for change (e.g., "expired" for permission timeout)
- Updates session in store

#### 5. `conversation_updated`

```json
{
  "type": "conversation_updated",
  "timestamp": "2025-02-11T10:34:00Z",
  "data": {
    "session_id": "sess_456",
    "event_count": 42
  }
}
```

- Fired when new conversation events are added
- Triggers conversation refresh in `useConversation()` hook

### Subscription Management

#### Subscribe to Events

```typescript
const handle = daemonClient.subscribeToEvents({
  event_types: ["new_approval", "approval_resolved", "session_status_changed"],
  session_id: "sess_456", // Optional: filter by session
  run_id: "run_789", // Optional: filter by run
  onEvent: (event) => {
    // Handle event
  },
});

// Unsubscribe
handle.unsubscribe();
```

#### Subscription Hooks

- **`useSessionSubscriptions()`** - Global session events
  - Subscribes to: `session_status_changed`, `new_approval`, `approval_resolved`, `session_settings_changed`
  - Calls handlers for each event type
- **`useApprovalsWithSubscription()`** - Approval-specific events
  - Subscribes to: `new_approval`, `approval_resolved`, `session_status_changed`
  - Refreshes approval list on relevant events
  - Falls back to polling if subscription fails

---

## Data Models

### Session

```typescript
interface Session {
  id: string;
  runId: string;
  claudeSessionId?: string;
  parentSessionId?: string;
  status: SessionStatus; // 'running' | 'completed' | 'failed' | 'interrupted' | 'draft' | 'discarded'
  query: string;
  title?: string;
  model?: string;
  workingDir: string;
  createdAt: string; // ISO 8601
  completedAt?: string;
  updatedAt?: string;
  autoAcceptEdits?: boolean;
  dangerouslySkipPermissions?: boolean;
  dangerouslySkipPermissionsExpiresAt?: string;
  archived?: boolean;
  additionalDirectories?: string[];
  proxyEnabled?: boolean;
  proxyBaseUrl?: string;
  proxyModelOverride?: string;
  editorState?: string;
}
```

### Approval

```typescript
interface Approval {
  id: string;
  sessionId: string;
  toolName: string;
  toolInputJson: string;
  toolUseId?: string;
  status: ApprovalStatus; // 'pending' | 'approved' | 'denied'
  decision?: "approve" | "deny";
  comment?: string;
  createdAt: string;
  resolvedAt?: string;
  expiresAt?: string;
}
```

### ConversationEvent

```typescript
interface ConversationEvent {
  id?: number;
  sessionId: string;
  eventType: "message" | "tool_call" | "tool_result" | "system" | "thinking";
  role?: "user" | "assistant" | "system";
  content?: string;
  toolName?: string;
  toolId?: string;
  toolInputJson?: string;
  toolResultContent?: string;
  approvalId?: string;
  approvalStatus?: string;
  createdAt: string;
}
```

### Event (SSE)

```typescript
interface Event {
  type: EventType; // 'new_approval' | 'approval_resolved' | 'session_status_changed' | 'conversation_updated' | 'session_settings_changed'
  data: any; // Event-specific data
  timestamp: Date;
}
```

### Health Response

```typescript
interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  dependencies?: {
    claude?: {
      available: boolean;
      version?: string;
      error?: string;
    };
    database?: {
      available: boolean;
      error?: string;
    };
  };
}
```

---

## Client Architecture

### Layer 1: HTTP Client (`HTTPDaemonClient`)

**File:** `humanlayer-wui/src/lib/daemon/http-client.ts`

Responsibilities:

- Connection management (connect, disconnect, reconnect)
- Retry logic with exponential backoff
- Health checks
- Wraps HLDClient SDK
- Transforms SDK responses to WUI format
- Error handling and logging

Key Methods:

- `connect()` - Establish connection with retries
- `health()` - Check daemon health
- `launchSession()` - Create new session
- `listSessions()` - Get all sessions
- `getSessionLeaves()` - Get leaf sessions with counts
- `getConversation()` - Get session messages
- `fetchApprovals()` - Get approvals
- `sendDecision()` - Approve/deny approval
- `subscribeToEvents()` - Subscribe to SSE events
- `updateSessionSettings()` - Update session settings
- `archiveSession()` / `bulkArchiveSessions()` - Archive sessions

### Layer 2: HLD SDK (`HLDClient`)

**File:** `hld/sdk/typescript/src/client.ts`

Responsibilities:

- Generated OpenAPI client
- HTTP request/response handling
- Type-safe API calls
- SSE subscription management

API Classes:

- `SessionsApi` - Session operations
- `ApprovalsApi` - Approval operations
- `FilesApi` - File operations
- `SettingsApi` - Settings operations
- `SystemApi` - System operations
- `AgentsApi` - Agent discovery

### Layer 3: React Hooks

**Files:** `humanlayer-wui/src/hooks/*.ts`

Responsibilities:

- Manage component-level state
- Handle polling and subscriptions
- Transform data for UI consumption
- Error handling and loading states

Key Hooks:

- `useDaemonConnection()` - Connection status and health
- `useSessions()` - Session list management
- `useSession()` - Single session details
- `useConversation()` - Conversation polling
- `useApprovals()` - Approval list
- `useApprovalsWithSubscription()` - Approvals with real-time updates
- `useSessionSubscriptions()` - Global session events

### Layer 4: Zustand Store (`AppStore`)

**File:** `humanlayer-wui/src/AppStore.ts`

Responsibilities:

- Global application state
- Session list and filtering
- Active session detail
- User settings
- UI state (selection, focus, etc.)
- Optimistic updates with rollback

Key State:

- `sessions: Session[]` - All sessions
- `activeSessionDetail` - Currently viewed session
- `focusedSession` - Keyboard navigation focus
- `selectedSessions` - Bulk selection
- `sessionCounts` - Counts by status
- `userSettings` - User preferences
- `claudeConfig` - Claude configuration

---

## Integration Points

### Session Lifecycle

1. **Launch Session**
   - User fills form in WUI
   - `launchSession()` called → `POST /sessions`
   - Returns `sessionId` and `runId`
   - Session added to store
   - Conversation polling starts

2. **Session Running**
   - `useConversation()` polls `GET /sessions/{id}/messages` every 1 second
   - SSE subscription listens for `session_status_changed`
   - Approvals appear via `new_approval` events
   - User can approve/deny via `POST /approvals/{id}/decide`

3. **Session Completion**
   - `session_status_changed` event fires with status='completed'
   - Conversation polling stops
   - Session moves to completed list
   - User can continue session or archive

4. **Archive/Restore**
   - `POST /sessions/archive` with `archived: true/false`
   - Session filtered based on view mode
   - Bulk operations supported

### Approval Workflow

1. **Approval Created**
   - Claude Code tool calls function requiring approval
   - Daemon creates approval, fires `new_approval` event
   - WUI receives event via SSE
   - `useApprovalsWithSubscription()` refreshes approval list
   - Approval displayed in UI

2. **User Decision**
   - User clicks approve/deny button
   - `sendDecision()` called → `POST /approvals/{id}/decide`
   - Daemon processes decision
   - Fires `approval_resolved` event
   - WUI removes from pending list

3. **Fallback to Polling**
   - If SSE subscription fails, falls back to polling
   - `useApprovals()` polls `GET /approvals` every 5 seconds
   - Ensures approvals are always visible

### Real-Time Updates

**Event Flow:**

```
Daemon Event → SSE Stream → Browser EventSource → HLDClient.subscribeToEvents()
  → Hook Handler (useSessionSubscriptions, useApprovalsWithSubscription)
  → AppStore Update → React Re-render
```

**Polling Fallback:**

```
Timer → Hook (useConversation, useApprovals) → daemonClient.fetch*()
  → AppStore Update → React Re-render
```

### Settings Synchronization

1. **User Settings**
   - `GET /settings/user` on app load
   - `PATCH /settings/user` on change
   - Stored in AppStore

2. **Session Settings**
   - `PATCH /sessions/{id}` for auto-accept, permissions, etc.
   - Optimistic update in store
   - Rollback on failure
   - `session_settings_changed` event confirms change

3. **Config Status**
   - `GET /config/status` to check provider API keys
   - Used by provider selection UI
   - `GET /settings/config` for full config

### Error Handling

**Connection Errors:**

- Retry up to 3 times with 500ms delay
- Show error message if all retries fail
- User can manually reconnect

**API Errors:**

- Logged to Sentry via `captureException()`
- User-friendly error messages via toast
- Optimistic updates rolled back on failure

**SSE Errors:**

- EventSource auto-reconnects on transient errors
- Falls back to polling if subscription fails
- Logs errors for debugging

---

## Key Differences from Previous Implementations

### What Changed

- **Protocol:** Moved from JSON-RPC over Unix socket to HTTP REST API
- **SDK:** Now uses generated OpenAPI SDK (`@humanlayer/hld-sdk`)
- **Events:** SSE instead of custom event protocol
- **URL Resolution:** Dynamic daemon URL detection with fallbacks

### What Stayed the Same

- **Data Models:** Session, Approval, ConversationEvent structures unchanged
- **Hook Architecture:** Same React hooks for state management
- **Store Pattern:** Zustand for global state
- **Polling Strategy:** Still polls conversation and approvals as fallback

---

## Testing the Communication

### Manual Testing with curl

```bash
# Health check
curl http://localhost:7777/api/v1/health | jq

# List sessions
curl http://localhost:7777/api/v1/sessions?leavesOnly=true | jq

# Get specific session
curl http://localhost:7777/api/v1/sessions/{sessionId} | jq

# Get conversation
curl http://localhost:7777/api/v1/sessions/{sessionId}/messages | jq

# List approvals
curl http://localhost:7777/api/v1/approvals | jq

# Subscribe to events (requires curl with SSE support)
curl -N http://localhost:7777/api/v1/stream/events?eventTypes=new_approval
```

### Debugging in WUI

1. **Connection Status:** Check `useDaemonConnection()` hook state
2. **API Calls:** Monitor Network tab in DevTools
3. **Events:** Check console for SSE event logs
4. **Store State:** Use Redux DevTools or Zustand middleware
5. **Logs:** Check `~/.humanlayer/logs/wui-*/codelayer.log`

---

## Migration Checklist (If Replacing HLD)

To replace HLD with a different backend, ensure the new backend implements:

### Required Endpoints

- [ ] `GET /health` - Health check
- [ ] `POST /sessions` - Create session
- [ ] `GET /sessions` - List sessions
- [ ] `GET /sessions/{id}` - Get session
- [ ] `PATCH /sessions/{id}` - Update session
- [ ] `POST /sessions/{id}/continue` - Continue session
- [ ] `POST /sessions/{id}/interrupt` - Interrupt session
- [ ] `POST /sessions/archive` - Bulk archive
- [ ] `POST /sessions/restore-drafts` - Restore drafts
- [ ] `POST /sessions/{id}/launch-draft` - Launch draft
- [ ] `DELETE /sessions/{id}/draft` - Delete draft
- [ ] `GET /sessions/{id}/messages` - Get conversation
- [ ] `GET /sessions/{id}/snapshots` - Get snapshots
- [ ] `GET /sessions/slash-commands` - Get slash commands
- [ ] `GET /sessions/search` - Search sessions
- [ ] `GET /sessions/recent-paths` - Get recent paths
- [ ] `GET /approvals` - List approvals
- [ ] `GET /approvals/{id}` - Get approval
- [ ] `POST /approvals/{id}/decide` - Decide approval
- [ ] `POST /files/validate-directory` - Validate directory
- [ ] `POST /files/create-directory` - Create directory
- [ ] `POST /files/fuzzy-search` - Fuzzy search files
- [ ] `POST /agents/discover` - Discover agents
- [ ] `GET /settings/user` - Get user settings
- [ ] `PATCH /settings/user` - Update user settings
- [ ] `GET /settings/config` - Get config
- [ ] `PATCH /settings/config` - Update config
- [ ] `GET /config/status` - Get config status
- [ ] `GET /debug-info` - Get debug info

### Required SSE Events

- [ ] `new_approval` - New approval created
- [ ] `approval_resolved` - Approval decided
- [ ] `session_status_changed` - Session status changed
- [ ] `session_settings_changed` - Session settings changed
- [ ] `conversation_updated` - Conversation updated

### Required Data Models

- [ ] Session with all fields (id, status, query, model, etc.)
- [ ] Approval with all fields (id, status, decision, etc.)
- [ ] ConversationEvent with all fields (eventType, content, etc.)
- [ ] Health response with status and version
- [ ] All request/response types matching OpenAPI spec

### Code Changes Needed

1. Update `HTTPDaemonClient` to call new backend endpoints
2. Update `HLDClient` SDK or replace with new SDK
3. Update data model transformations if needed
4. Update error handling for new error formats
5. Update SSE event handling if event format changes
6. Update URL resolution in `http-config.ts`

---

## References

- **WUI Source:** `/humanlayer-wui/src/lib/daemon/`
- **HLD SDK:** `/hld/sdk/typescript/src/`
- **OpenAPI Spec:** Generated from HLD daemon
- **Hooks:** `/humanlayer-wui/src/hooks/`
- **Store:** `/humanlayer-wui/src/AppStore.ts`
- **Services:** `/humanlayer-wui/src/services/daemon-service.ts`
