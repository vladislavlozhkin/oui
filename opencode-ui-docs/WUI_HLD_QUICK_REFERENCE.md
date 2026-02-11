# WUI ↔ HLD Communication - Quick Reference

## Connection

- **Protocol:** HTTP REST + Server-Sent Events (SSE)
- **Base URL:** `http://localhost:7777/api/v1`
- **Headers:** `X-Client: codelayer`, `X-Client-Version: <version>`

## All RPC Methods / API Endpoints (29 total)

### Sessions (13 endpoints)

| Method | Endpoint                                                   | Purpose                    |
| ------ | ---------------------------------------------------------- | -------------------------- |
| POST   | `/sessions`                                                | Create new session         |
| GET    | `/sessions?leavesOnly=true&filter=normal\|archived\|draft` | List sessions with counts  |
| GET    | `/sessions/{id}`                                           | Get session details        |
| PATCH  | `/sessions/{id}`                                           | Update session settings    |
| POST   | `/sessions/{id}/continue`                                  | Continue completed session |
| POST   | `/sessions/{id}/interrupt`                                 | Stop running session       |
| POST   | `/sessions/archive`                                        | Bulk archive/unarchive     |
| POST   | `/sessions/restore-drafts`                                 | Restore discarded drafts   |
| POST   | `/sessions/{id}/launch-draft`                              | Launch draft session       |
| DELETE | `/sessions/{id}/draft`                                     | Delete draft session       |
| GET    | `/sessions/{id}/messages`                                  | Get conversation history   |
| GET    | `/sessions/{id}/snapshots`                                 | Get file snapshots         |
| GET    | `/sessions/slash-commands`                                 | Get available commands     |
| GET    | `/sessions/search`                                         | Search sessions            |
| GET    | `/sessions/recent-paths`                                   | Get recent directories     |

### Approvals (4 endpoints)

| Method | Endpoint                    | Purpose                       |
| ------ | --------------------------- | ----------------------------- |
| GET    | `/approvals?sessionId={id}` | List approvals                |
| GET    | `/approvals/{id}`           | Get approval details          |
| POST   | `/approvals/{id}/decide`    | Approve/deny approval         |
| POST   | `/approvals`                | Create approval (daemon only) |

### Files (3 endpoints)

| Method | Endpoint                    | Purpose                |
| ------ | --------------------------- | ---------------------- |
| POST   | `/files/validate-directory` | Check directory exists |
| POST   | `/files/create-directory`   | Create directory       |
| POST   | `/files/fuzzy-search`       | Search files           |

### Agents (1 endpoint)

| Method | Endpoint           | Purpose                      |
| ------ | ------------------ | ---------------------------- |
| POST   | `/agents/discover` | Discover agents in directory |

### Settings (4 endpoints)

| Method | Endpoint           | Purpose                 |
| ------ | ------------------ | ----------------------- |
| GET    | `/settings/user`   | Get user preferences    |
| PATCH  | `/settings/user`   | Update user preferences |
| GET    | `/settings/config` | Get daemon config       |
| PATCH  | `/settings/config` | Update daemon config    |
| GET    | `/config/status`   | Check provider API keys |

### System (2 endpoints)

| Method | Endpoint      | Purpose           |
| ------ | ------------- | ----------------- |
| GET    | `/health`     | Health check      |
| GET    | `/debug-info` | Debug information |

---

## All SSE Events (5 types)

| Event                      | Fired When               | Data                                                                        |
| -------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `new_approval`             | Approval request created | `approval_id`, `session_id`, `tool_name`, `tool_use_id`                     |
| `approval_resolved`        | Approval approved/denied | `approval_id`, `session_id`, `decision`                                     |
| `session_status_changed`   | Session status changes   | `session_id`, `old_status`, `new_status`                                    |
| `session_settings_changed` | Settings modified        | `session_id`, `auto_accept_edits`, `dangerously_skip_permissions`, `reason` |
| `conversation_updated`     | New conversation events  | `session_id`, `event_count`                                                 |

---

## Data Models (4 core types)

### Session

```
id, runId, claudeSessionId, parentSessionId, status, query, title, model,
workingDir, createdAt, completedAt, updatedAt, autoAcceptEdits,
dangerouslySkipPermissions, dangerouslySkipPermissionsExpiresAt, archived,
additionalDirectories, proxyEnabled, proxyBaseUrl, proxyModelOverride, editorState
```

### Approval

```
id, sessionId, toolName, toolInputJson, toolUseId, status, decision, comment,
createdAt, resolvedAt, expiresAt
```

### ConversationEvent

```
id, sessionId, eventType, role, content, toolName, toolId, toolInputJson,
toolResultContent, approvalId, approvalStatus, createdAt
```

### Event (SSE)

```
type, data (event-specific), timestamp
```

---

## Client Architecture (4 layers)

```
React Components
    ↓
React Hooks (useSessions, useConversation, useApprovals, etc.)
    ↓
Zustand Store (AppStore)
    ↓
HTTPDaemonClient (connection, retry, error handling)
    ↓
HLDClient SDK (generated OpenAPI client)
    ↓
HTTP REST API + SSE
```

---

## Key Hooks

| Hook                             | Purpose                | Polling          | Events                                                                                    |
| -------------------------------- | ---------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `useDaemonConnection()`          | Connection status      | 30s health check | -                                                                                         |
| `useSessions()`                  | Session list           | On demand        | -                                                                                         |
| `useSession()`                   | Single session         | On demand        | -                                                                                         |
| `useConversation()`              | Conversation history   | 1s polling       | -                                                                                         |
| `useApprovals()`                 | Approval list          | On demand        | -                                                                                         |
| `useApprovalsWithSubscription()` | Approvals with updates | 5s fallback      | `new_approval`, `approval_resolved`                                                       |
| `useSessionSubscriptions()`      | Global session events  | -                | `session_status_changed`, `new_approval`, `approval_resolved`, `session_settings_changed` |

---

## Session Lifecycle

```
1. Launch Session
   → POST /sessions
   → Returns sessionId, runId
   → Added to store

2. Session Running
   → GET /sessions/{id}/messages (1s polling)
   → SSE: session_status_changed, new_approval
   → User approves/denies via POST /approvals/{id}/decide

3. Session Completed
   → SSE: session_status_changed (status=completed)
   → Polling stops
   → User can continue or archive

4. Archive/Restore
   → POST /sessions/archive (archived: true/false)
   → Filtered by view mode
```

---

## Approval Workflow

```
1. Approval Created
   → Daemon fires SSE: new_approval
   → useApprovalsWithSubscription() refreshes list
   → Displayed in UI

2. User Decision
   → POST /approvals/{id}/decide (decision: approve|deny)
   → Daemon fires SSE: approval_resolved
   → Removed from pending list

3. Fallback
   → If SSE fails, polls GET /approvals every 5s
```

---

## Error Handling

| Scenario                | Handling                                               |
| ----------------------- | ------------------------------------------------------ |
| Connection fails        | Retry 3x with 500ms delay, show error                  |
| API error               | Log to Sentry, show toast, rollback optimistic updates |
| SSE error               | Auto-reconnect, fall back to polling                   |
| 422 directory_not_found | Special handling in launchDraftSession                 |

---

## To Replace HLD Backend

Implement all 29 endpoints + 5 SSE events with same request/response formats.

See full document: `WUI_HLD_COMMUNICATION_MAP.md`
