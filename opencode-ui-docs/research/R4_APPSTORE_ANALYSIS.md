# R4: AppStore Shape Analysis

> Complete analysis of `humanlayer-wui/src/AppStore.ts` — state, actions, daemon calls, and migration categorization.
> Source: `humanlayer-wui/src/AppStore.ts` (1192 lines)

---

## 1. State Interface

### 1.1 Session Management

```typescript
sessions: Session[]                           // All sessions in current view
sessionCounts: {                              // Server-side counts
  normal?: number; archived?: number; draft?: number
} | null
focusedSession: Session | null                // Keyboard-focused session
sessionTableViewModes: ViewModeOption[]       // [Normal, Drafts, Archived]
selectedSessions: Set<string>                 // IDs for bulk operations
pendingUpdates: Map<string, PendingUpdate>    // In-flight optimistic updates
isRefreshing: boolean                         // Prevents concurrent refresh
```

### 1.2 Active Session Detail

```typescript
activeSessionDetail: {
  session: Session
  conversation: any[]    // ConversationEvent[] from daemon
  loading: boolean
  error: string | null
} | null
```

### 1.3 Notifications & Approval Cache

```typescript
notifiedItems: Set<string>; // Shown notification IDs
recentResolvedApprovalsCache: Set<string>; // Max 50 recent approvals
recentNavigations: Map<string, number>; // sessionId → timestamp (5s TTL)
```

### 1.4 UI State

```typescript
isHotkeyPanelOpen: boolean;
isSettingsDialogOpen: boolean;
isEditingSessionTitle: boolean;
autoScrollEnabled: boolean; // Default: true
```

### 1.5 User Settings & Configuration

```typescript
userSettings: {
  advancedProviders: boolean
  optInTelemetry?: boolean
} | null

claudeConfig: {
  claudePath: string
  claudeDetectedPath?: string
  claudeAvailable: boolean
  claudeVersion?: string
  claudeVersionError?: string
} | null
```

### 1.6 Response Editor

```typescript
responseEditor: Editor | null; // Tiptap editor instance
isResponseEditorEmpty: boolean;
```

---

## 2. Actions — Daemon Client Calls

### Summary Table

| Action                               | Daemon Method                                                             | Purpose                    |
| ------------------------------------ | ------------------------------------------------------------------------- | -------------------------- |
| `refreshSessions()`                  | `getSessionLeaves({ filter })`                                            | Fetch sessions with counts |
| `updateSessionOptimistic()`          | `getSessionState(id)` + `updateSessionSettings(id, settings)`             | Optimistic setting update  |
| `interruptSession()`                 | `interruptSession(id)`                                                    | Stop running session       |
| `archiveSession()`                   | `archiveSession({ session_id, archived })` + `refreshSessions()`          | Archive/unarchive          |
| `bulkArchiveSessions()`              | `bulkArchiveSessions({ session_ids, archived })` + `refreshSessions()`    | Bulk archive               |
| `bulkSetAutoAcceptEdits()`           | `updateSessionSettings(id, { auto_accept_edits })` ×N                     | Bulk setting               |
| `bulkSetBypassPermissions()`         | `updateSessionSettings(id, { dangerously_skip_permissions, timeout })` ×N | Bulk bypass                |
| `bulkDiscardDrafts()`                | `deleteDraftSession(id)` ×N + `refreshSessions()`                         | Discard drafts             |
| `fetchActiveSessionDetail()`         | `getSessionState(id)` + `getConversation({ session_id })`                 | Load session detail        |
| `refreshActiveSessionConversation()` | `getConversation({ session_id })`                                         | Refresh conversation       |
| `fetchUserSettings()`                | `getUserSettings()`                                                       | Load user prefs            |
| `updateUserSettings()`               | `updateUserSettings(settings)`                                            | Save user prefs            |
| `fetchClaudeConfig()`                | `getConfig()` + `health()`                                                | Load Claude config         |
| `updateClaudePath()`                 | `updateConfig({ claudePath })` + `health()`                               | Update Claude path         |

### Detailed Patterns

#### Optimistic Update Pattern (AppStore.ts:202-300)

```typescript
// 1. Capture original state
let originalSession = get().sessions.find((s) => s.id === sessionId);
if (!originalSession) {
  originalSession = (await daemonClient.getSessionState(sessionId)).session;
}

// 2. Apply optimistic update immediately
set((state) => ({
  sessions: state.sessions.map((s) =>
    s.id === sessionId ? { ...s, ...updates } : s,
  ),
  pendingUpdates: new Map(state.pendingUpdates).set(sessionId, {
    updates,
    timestamp,
  }),
}));

// 3. Send to server
try {
  await daemonClient.updateSessionSettings(sessionId, apiUpdates);
  // Remove from pending on success
} catch {
  // Revert to original on failure
}
```

#### Bulk Operation Pattern (AppStore.ts:494-520)

```typescript
const results = await Promise.allSettled(
  sessionIds.map((id) => daemonClient.updateSessionSettings(id, settings)),
);
const failedCount = results.filter((r) => r.status === "rejected").length;
if (failedCount > 0)
  throw new Error(`Failed to update ${failedCount} sessions`);
```

#### Refresh with Pending Preservation (AppStore.ts:319-386)

```typescript
const updatedSessions = response.sessions.map((serverSession) => {
  const pending = pendingUpdates.get(serverSession.id);
  // Only preserve updates < 2 seconds old
  if (pending && pending.timestamp > Date.now() - 2000) {
    return { ...serverSession, ...pending.updates };
  }
  return serverSession;
});
```

---

## 3. Actions — Local State Only

### Session Selection & Navigation

| Action                                | Purpose                         | File:Line |
| ------------------------------------- | ------------------------------- | --------- |
| `initSessions(sessions)`              | Initialize sessions array       | 183       |
| `updateSession(id, updates)`          | Local update (no daemon call)   | 184-201   |
| `updateSessionStatus(id, status)`     | Update status from SSE          | 301-318   |
| `removeSession(id)`                   | Remove from local state         | 521-529   |
| `setFocusedSession(session)`          | Set keyboard focus              | 401       |
| `focusNextSession()`                  | Move focus down (wraps)         | 402-416   |
| `focusPreviousSession()`              | Move focus up (wraps)           | 417-431   |
| `toggleSessionSelection(id)`          | Toggle in selection set         | 659-668   |
| `clearSelection()`                    | Clear all selections            | 669       |
| `selectRange(anchor, target)`         | Replace selection with range    | 670-704   |
| `addRangeToSelection(anchor, target)` | Add range to existing           | 705-742   |
| `updateCurrentRange(anchor, target)`  | Modify current contiguous range | 743-812   |
| `bulkSelect(id, direction)`           | Main Shift+j/k entry point      | 813-896   |

### View Mode Management

| Action                  | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `setViewMode(mode)`     | Switch view + refresh + auto-focus first      |
| `getViewMode()`         | Get current ViewMode (Normal/Archived/Drafts) |
| `setNextViewMode()`     | Cycle forward                                 |
| `setPreviousViewMode()` | Cycle backward                                |

### UI State

| Action                              | Purpose                    |
| ----------------------------------- | -------------------------- |
| `setHotkeyPanelOpen(open)`          | Toggle hotkey panel        |
| `setSettingsDialogOpen(open)`       | Toggle settings dialog     |
| `setIsEditingSessionTitle(editing)` | Toggle title edit mode     |
| `setAutoScrollEnabled(enabled)`     | Toggle auto-scroll         |
| `setResponseEditor(editor)`         | Set Tiptap editor instance |
| `setResponseEditorEmpty(isEmpty)`   | Track editor empty state   |
| `removeResponseEditor()`            | Clear editor               |

### Notification & Navigation Tracking

| Action                                 | Purpose                              |
| -------------------------------------- | ------------------------------------ |
| `addNotifiedItem(id)`                  | Mark notification as shown           |
| `removeNotifiedItem(id)`               | Remove notification                  |
| `isItemNotified(id)`                   | Check if already notified            |
| `clearNotificationsForSession(id)`     | Clear all session notifications      |
| `addRecentResolvedApprovalToCache(id)` | Cache resolved approval (max 50)     |
| `isRecentResolvedApproval(id)`         | Check if recently resolved           |
| `trackNavigationFrom(id)`              | Track navigation (5s TTL)            |
| `wasRecentlyNavigatedFrom(id, ms?)`    | Check recent navigation (default 3s) |

---

## 4. Event Subscriptions

The store does **NOT** directly subscribe to SSE events. Instead, `useSessionSubscriptions` hook (in `src/hooks/useSubscriptions.ts`) handles subscriptions and calls store methods:

```typescript
// Event types subscribed to:
event_types: [
  "session_status_changed", // → calls updateSessionStatus()
  "new_approval", // → triggers notification
  "approval_resolved", // → updates approval cache
  "session_settings_changed", // → calls updateActiveSessionDetail()
];
```

---

## 5. Helper Functions

### `validateSessionState(session)` (AppStore.ts:1154-1172)

Checks if `dangerouslySkipPermissions` has expired and disables it.

### Periodic Cleanup (AppStore.ts:1175-1191)

```typescript
setInterval(() => {
  const validatedSessions = state.sessions.map(validateSessionState);
  if (hasChanges) useStore.setState({ sessions: validatedSessions });
}, 5000); // Every 5 seconds
```

---

## 6. Migration Categorization

### Direct Mapping (method exists in opencode)

| AppStore Method              | OpenCode Equivalent                                      | Notes                      |
| ---------------------------- | -------------------------------------------------------- | -------------------------- |
| `refreshSessions()`          | `client.session.list()`                                  | Need client-side filtering |
| `interruptSession()`         | `client.session.abort(id)`                               | Direct                     |
| `fetchActiveSessionDetail()` | `client.session.get(id)` + `client.session.messages(id)` | Different response shape   |
| `fetchUserSettings()`        | `client.config.get()`                                    | Different structure        |
| `updateUserSettings()`       | `client.config.update()` (**SPIKE: NOT patch()**)        | Different structure        |

### Needs Transformation (different shape)

| AppStore Method              | Issue                                                    | Solution                              |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------- |
| `refreshSessions()`          | No server-side filter/counts in opencode                 | Client-side filter + count            |
| `updateSessionOptimistic()`  | Field name differences                                   | Adapter maps fields                   |
| `archiveSession()`           | **No archive API in opencode** (only `session.delete()`) | Emulate client-side or remove feature |
| `fetchActiveSessionDetail()` | Messages → Parts hierarchy vs flat events                | Transformer needed                    |
| `fetchClaudeConfig()`        | hld-specific Claude config                               | Map to opencode providers             |
| `updateClaudePath()`         | hld-specific Claude path                                 | Map to opencode config                |

### Needs Emulation (no equivalent)

| AppStore Method                                       | Why                                | Workaround                                                                                   |
| ----------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `bulkDiscardDrafts()`                                 | Draft sessions are hld-specific    | Remove feature or emulate with delete                                                        |
| `getSessionLeaves(filter: 'draft')`                   | No drafts in opencode              | Remove draft view mode                                                                       |
| `claudeConfig` state                                  | hld manages Claude binary          | Use opencode's provider config                                                               |
| `getConfigStatus()`                                   | hld-specific provider status check | Use `client.provider.list()` or `client.config.providers()` (**SPIKE: NOT app.providers()**) |
| `updateSessionSettings(dangerously_skip_permissions)` | Different permission model         | Use opencode's "always" per-tool                                                             |

### Can Be Removed (hld-specific)

| Item                                                  | Reason                                         |
| ----------------------------------------------------- | ---------------------------------------------- |
| `claudeSessionId` check in `interruptSession()`       | opencode doesn't have separate Claude sessions |
| `dangerouslySkipPermissions` periodic cleanup         | opencode has per-tool "always allow" instead   |
| `getSlashCommands()`                                  | hld-specific feature                           |
| `searchSessions()`                                    | hld-specific server search                     |
| `getSessionSnapshots()`                               | hld-specific file snapshots                    |
| `getDebugInfo()`                                      | hld-specific debug endpoint                    |
| `getRecentPaths()`                                    | hld-specific feature                           |
| Draft-related UI (ViewMode.Drafts, bulkDiscardDrafts) | No drafts in opencode                          |
| Proxy settings (proxyEnabled, proxyBaseUrl, etc.)     | opencode has built-in provider management      |

---

## 7. Key Takeaways for Migration

### 1. Keep: Optimistic Update Pattern

The 2-second pending update preservation is critical for UX. Keep this pattern in the opencode adapter.

### 2. Keep: Selection & Navigation

All vim-style keyboard navigation is UI-only state — no daemon calls. Works as-is after migration.

### 3. Adapt: Session Filtering

Currently `getSessionLeaves({ filter: 'normal'|'archived'|'draft' })` uses server-side filtering. OpenCode has no equivalent — must filter client-side.

### 4. Adapt: Conversation Loading

`getConversation()` returns flat `ConversationEvent[]`. OpenCode returns hierarchical `Message[] → Part[]`. Need transformer.

### 5. Remove: Draft Sessions

Draft sessions don't exist in opencode. Remove `ViewMode.Drafts`, `bulkDiscardDrafts()`, draft-related state.

### 6. Remove: Claude Config Management

hld manages the Claude binary (path, version). OpenCode manages AI providers internally. Replace `claudeConfig` with provider state from `client.provider.list()` or `client.config.providers()` (**SPIKE: NOT app.providers()**).

### 7. Replace: Permission Bypass

`dangerouslySkipPermissions` + timeout → opencode's per-tool "always allow". Different UX model.

### 8. Critical: Event Subscription Separation

Keep subscriptions in hooks (not in store). The store should only react to state changes — not manage SSE connections.

### 9. Session 3 Scope Concern

The roadmap has Session 3 covering both hooks AND store (rated "High" complexity for 5 of 8 files). Consider splitting into 3a (hooks) and 3b (store) if context budget is tight.
