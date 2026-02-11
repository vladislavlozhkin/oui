# R3: Permission Flow Investigation

> OpenCode vs HLD permission/approval flow comparison.
> Sources: opencode GitHub (sst/opencode), opencode-sdk-go, humanlayer hld/

---

## Executive Summary

OpenCode uses a **three-option permission system** (`once`, `always`, `reject`) via REST API, while HLD uses a **two-option system** (`approve`, `deny`) with mandatory comments on denial. Key difference: OpenCode supports **persistent per-session permissions** via the `always` option.

---

## 1. OpenCode Permission Flow

### 1.1 Permission Request Structure

**Source**: [opencode-sdk-go/sessionpermission.go](https://github.com/sst/opencode-sdk-go/blob/main/sessionpermission.go)

```typescript
type Permission = {
  id: string; // Unique permission ID
  sessionID: string; // Parent session ID
  messageID: string; // Parent message ID
  callID?: string; // Tool call ID if related to a tool
  title: string; // Human-readable title (e.g., "Run bash: git status")
  type: string; // Permission type (e.g., "bash", "edit", "external_directory")
  pattern?: string | string[]; // Pattern for "always" rules (e.g., "git *")
  metadata: Record<string, unknown>; // Tool-specific metadata
  time: { created: number }; // Unix timestamp (ms)
};
```

### 1.2 SSE Event: Permission Created

```typescript
// Event type: "permission.updated"
{
  type: "permission.updated",
  properties: {
    id: string,
    sessionID: string,
    messageID: string,
    title: string,
    type: string,
    metadata: Record<string, unknown>,
    time: { created: number }
  }
}
```

**When sent**: When AI attempts a tool call requiring user approval (e.g., `bash` with `permission: "ask"`).

### 1.3 API: Respond to Permission

**Endpoint**: `POST /session/{sessionID}/permissions/{permissionID}`

**Request Body**:

```json
{
  "response": "once" | "always" | "reject"
}
```

**Response Options**:
| Option | Behavior |
|--------|----------|
| `once` | Allow this specific request only |
| `always` | Allow all future requests matching the pattern (session-scoped) |
| `reject` | Deny this request |

**Response**: `boolean` (success/failure)

**TypeScript SDK** usage pattern:

```typescript
// Method: client.session.permissions.respond()
await client.session.permissions.respond(
  sessionID,
  permissionID,
  { response: "once" }, // or 'always' or 'reject'
);
```

**Note**: The auto-generated SDK method name is `postSessionByIdPermissionsByPermissionId()` — use the semantic wrapper above.

### 1.4 After Response

- `once` or `always` → tool executes, `message.part.updated` event fires with result
- `reject` → tool not executed, AI receives error and may continue differently
- **SPIKE UPDATE**: `permission.replied` SSE event **EXISTS** with `{ sessionID, permissionID, response }` — R3 was originally wrong here

### 1.5 Timeout Behavior

**No built-in timeout**. If user doesn't respond:

- Session hangs in "busy" state
- AI cannot continue
- User must respond or abort session

**Known issue**: [GitHub #5888](https://github.com/sst/opencode/issues/5888) — hanging behavior in CI/CD

---

## 2. HLD Approval Flow

### 2.1 Approval Structure

```typescript
type Approval = {
  id: string; // Approval ID
  session_id: string; // Session ID
  run_id: string; // Run ID
  tool_name: string; // Tool name (e.g., "bash", "edit")
  tool_input: Record<string, any>; // Tool input parameters
  status: "pending" | "approved" | "denied";
  decision?: "approve" | "deny";
  comment?: string;
  created_at: string;
  decided_at?: string;
};
```

### 2.2 API: Decide Approval

**Endpoint**: `POST /approvals/{id}/decide`

**Request Body**:

```json
{
  "decision": "approve" | "deny",
  "comment": "optional comment (REQUIRED when deny)"
}
```

**Validation**: Comment is **required** when `decision = 'deny'`.

### 2.3 Event Delivery

HLD uses **SSE events** for real-time updates:

- `new_approval` — new approval request created
- `approval_resolved` — approval decided

---

## 3. Side-by-Side Comparison

| Feature                  | OpenCode                                                                              | HLD                                           |
| ------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| **API Endpoint**         | `POST /session/{id}/permissions/{permID}`                                             | `POST /approvals/{id}/decide`                 |
| **Request Body**         | `{"response": "once"\|"always"\|"reject"}`                                            | `{"decision": "approve"\|"deny", "comment?"}` |
| **Response Options**     | 3: `once`, `always`, `reject`                                                         | 2: `approve`, `deny`                          |
| **Persistent Allow**     | Yes (`always` per pattern)                                                            | No (every call requires approval)             |
| **Comment Support**      | No                                                                                    | Yes (required on deny)                        |
| **SSE Event (request)**  | `permission.updated`                                                                  | `new_approval`                                |
| **SSE Event (response)** | `permission.replied` (**SPIKE: EXISTS** with `{ sessionID, permissionID, response }`) | `approval_resolved`                           |
| **Timeout**              | None (hangs)                                                                          | None (hangs)                                  |
| **Rich Metadata**        | Yes (title, type, pattern, callID)                                                    | Basic (tool_name, tool_input)                 |
| **Pattern Matching**     | Yes (for `always` rules)                                                              | No                                            |
| **List API**             | No (track from SSE)                                                                   | Yes (`GET /approvals?session_id=...`)         |

---

## 4. Features Lost in Migration

1. **Comment on approvals**: HLD requires comment on deny; OpenCode has no comment field
2. **List approvals API**: HLD has `GET /approvals`; OpenCode requires SSE tracking
3. ~~**Approval resolved event**: HLD fires `approval_resolved`; OpenCode has no equivalent~~ — **SPIKE: RESOLVED. OpenCode has `permission.replied` event**

## 5. Features Gained in Migration

1. **"Always Allow" option**: Reduces repetitive approvals for trusted patterns
2. **Pattern-based rules**: Granular control (e.g., allow `git *` but not `rm *`)
3. **Rich metadata**: Human-readable `title` instead of raw `tool_name`/`tool_input`
4. **Real-time delivery**: `permission.updated` SSE event (no polling needed)

---

## 6. Key Takeaways for Migration

### API Changes Required

```diff
- POST /approvals/{id}/decide
- Body: { "decision": "approve"|"deny", "comment"?: string }
+ POST /session/{sessionID}/permissions/{permissionID}
+ Body: { "response": "once"|"always"|"reject" }
```

### UI Changes Required

1. **Add "Always Allow" button** to permission dialog:

   ```
   [Approve Once]  [Always Allow]  [Reject]
   ```

2. **Show pattern info** when "Always Allow" is selected:

   ```
   This will allow all future requests matching: git *
   ```

3. **Show `title`** instead of raw tool_name:

   ```diff
   - Tool: bash
   - Input: {"command": "git status"}
   + Run bash: git status
   ```

4. **Remove comment field** (or make purely optional for local logging)

### State Management Changes

1. **No list API** — track active permissions from SSE `permission.updated` events
2. **Store active permissions** in local state (Map by permission ID)
3. **Detect permission resolution** via `permission.replied` SSE event (**SPIKE: event exists** — no need for `message.part.updated` tool-state workaround)

### Adapter Implementation

```typescript
// Permission adapter for opencode
async respondToPermission(
  sessionId: string,
  permissionId: string,
  response: 'once' | 'always' | 'reject'
): Promise<void> {
  await client.session.permissions.respond(sessionId, permissionId, {
    response
  });
}
```

### Mapping from HLD concepts

| HLD Concept           | OpenCode Equivalent                    |
| --------------------- | -------------------------------------- |
| `approval.id`         | `permission.id`                        |
| `approval.session_id` | `permission.sessionID`                 |
| `approval.tool_name`  | `permission.type` + `permission.title` |
| `approval.tool_input` | `permission.metadata`                  |
| `decision: 'approve'` | `response: 'once'`                     |
| `decision: 'deny'`    | `response: 'reject'`                   |
| N/A                   | `response: 'always'` (new)             |
| `approval.comment`    | N/A (dropped)                          |

---

## References

- [Go SDK: sessionpermission.go](https://github.com/sst/opencode-sdk-go/blob/main/sessionpermission.go)
- [TypeScript SDK: event.ts](https://github.com/sst/opencode-sdk-js/blob/main/src/resources/event.ts)
- [OpenCode Permissions Documentation](https://opencode.ai/docs/permissions/)
- [GitHub Issue #5888: Hanging behavior](https://github.com/sst/opencode/issues/5888)
- `hld/api/handlers/approvals.go` (lines 149-219)
