# Pre-Implementation Research Plan

> This document defines research tasks that MUST be completed before starting
> the opencode migration implementation (Session 1 in OPENCODE_MIGRATION_ROADMAP.md).
>
> Each research item produces a reference document in `opencode-ui-docs/`.
> These documents are then consumed by implementation sessions.

---

## Context

We are migrating `humanlayer-wui/` (CodeLayer — Tauri + React desktop app) from
**hld daemon** backend to **opencode server** backend. The migration roadmap
is defined in `OPENCODE_MIGRATION_ROADMAP.md`.

Before implementation, we need to close knowledge gaps that could derail the work.
Each research item below targets a specific risk from the roadmap.

---

## Research Items

### R1. OpenCode SDK Type Reference

**Output file:** `opencode-ui-docs/research/R1_SDK_TYPE_REFERENCE.md`

**Why this matters:**
The hardest part of migration is the transformer that converts opencode's
hierarchical `Message → Part[]` model into a flat `ConversationEvent[]` list
that existing UI components expect. Without exact type definitions, we would
write the transformer blind and risk runtime failures.

**What to do:**

1. Install `@opencode-ai/sdk` (latest, currently v1.1.34) in a temp project
2. Extract and document full TypeScript type definitions for:
   - `Session` — all fields, nested types
   - `SessionStatus` — all variants (idle, busy, retry)
   - `Message` — both `UserMessage` and `AssistantMessage`, all fields
   - `Part` — ALL 12 types: `TextPart`, `ReasoningPart`, `ToolPart`, `SubtaskPart`,
     `FilePart`, `StepStartPart`, `StepFinishPart`, `SnapshotPart`, `PatchPart`,
     `AgentPart`, `RetryPart`, `CompactionPart`
   - `ToolPart` states: `ToolStatePending`, `ToolStateRunning`, `ToolStateCompleted`, `ToolStateError`
   - `PermissionRequest` — all fields, response format
   - SSE event types — payload shapes for each event
3. Source: `node_modules/@opencode-ai/sdk` type files, or opencode GitHub repo
   (`github.com/anomalyco/opencode`, look for `types.gen.ts` or similar)
4. Document each type with inline comments explaining what each field means

**Addresses risk:** Roadmap Risk #2 (transformer complexity)

---

### R2. Current DaemonClient Interface Snapshot

**Output file:** `opencode-ui-docs/research/R2_DAEMON_CLIENT_INTERFACE.md`

**Why this matters:**
The adapter layer (`src/lib/opencode/client.ts`) must provide equivalent
functionality to the current `DaemonClient`. If we don't know the exact
method signatures, return types, and error patterns, the adapter will
have gaps that break hooks and store.

**What to do:**

1. Read these files in `humanlayer-wui/`:
   - `src/lib/daemon/http-client.ts` — main client implementation
   - `src/lib/daemon/types.ts` — type definitions and re-exports
   - `src/lib/daemon/errors.ts` — error classes
   - `src/lib/daemon/http-config.ts` — configuration
   - `src/lib/daemon/client.ts` — singleton/factory
   - `src/lib/daemon/index.ts` — public exports
2. Document for EACH public method:
   - Method signature (params + return type)
   - What HTTP endpoint it calls
   - What transformations it applies to request/response
   - Error handling behavior
3. Document the DaemonClient interface or class shape
4. Document the connection lifecycle (connect → health → retry → disconnect)
5. Document the SSE subscription mechanism (subscribeToEvents)

**Addresses risk:** Ensures adapter layer has 1:1 feature coverage

---

### R3. Permission Flow Investigation

**Output file:** `opencode-ui-docs/research/R3_PERMISSION_FLOW.md`

**Why this matters:**
The permission API in opencode SDK is poorly documented. The method name
`postSessionByIdPermissionsByPermissionId()` is auto-generated and may not
reflect the actual usage pattern. The approval workflow is a core UX feature —
if we get this wrong, users can't approve tool calls.

**What to do:**

1. Find the permission handling code in opencode source:
   - GitHub: `github.com/anomalyco/opencode`
   - Look for: permission handler, permission routes, permission types
2. Document the exact flow:
   - How does a permission request arrive? (SSE event shape)
   - What fields does `PermissionRequest` contain?
   - What API call responds to a permission? (exact endpoint, method, body)
   - What are valid response values? (`once`, `always`, `reject` — confirm)
   - What SSE event fires after responding?
3. Compare with current hld approval flow:
   - hld: `POST /approvals/{id}/decide` with `{ decision: 'approve'|'deny', comment? }`
   - opencode: document equivalent
4. Note any features lost (e.g., comments on approvals)
5. Note any features gained (e.g., "always allow" option)

**Addresses risk:** Roadmap Risk #4 (permission API poorly documented)

---

### R4. AppStore Shape Analysis

**Output file:** `opencode-ui-docs/research/R4_APPSTORE_ANALYSIS.md`

**Why this matters:**
`AppStore.ts` is 1200+ lines and is the central state management for the entire
application. Every hook and component depends on it. Session 3 of the roadmap
requires heavy adaptation of this file. Without understanding its exact shape,
we risk breaking the app in subtle ways.

**What to do:**

1. Read `humanlayer-wui/src/AppStore.ts`
2. Document:
   - **State interface**: every field, its type, and purpose
   - **Actions**: every action/method, what it does, what daemon client methods it calls
   - **Daemon client calls**: list every `daemonClient.xxx()` call with:
     - Which action triggers it
     - What it does with the response
     - Error handling (optimistic updates? rollback?)
   - **Subscriptions**: how the store listens to SSE events
   - **Derived state**: any computed/derived values
3. Categorize actions by migration difficulty:
   - Direct mapping (method exists in opencode)
   - Needs transformation (method exists but different shape)
   - Needs emulation (no equivalent in opencode — e.g., archive, drafts)
   - Can be removed (hld-specific, not needed)
4. Also read related files:
   - `src/stores/appStore.ts` (re-export)
   - `src/stores/useDebugStore.ts`

**Addresses risk:** Roadmap Risk #6 (Session 3 too wide)

---

### R5. opencode serve Runtime Behavior

**Output file:** `opencode-ui-docs/research/R5_OPENCODE_SERVE_BEHAVIOR.md`

**Why this matters:**
The Tauri layer (Session 2) needs to spawn `opencode serve` as a child process,
detect the port, and monitor its health. Currently hld outputs `HTTP_PORT=XXXX`
on stdout. If opencode has a different output format, the Tauri code won't work.

**What to do:**

1. Check if `opencode` is installed locally: `which opencode`, `opencode --version`
2. Run `opencode serve --help` — document all flags
3. If possible, run `opencode serve --port 0` and capture stdout to see:
   - What format is the port output? (e.g., `Listening on :4096`, JSON, etc.)
   - Does `--port 0` allocate a random port?
   - Does it output to stdout or stderr?
4. Check environment variables:
   - `OPENCODE_SERVER_PASSWORD` — how Basic Auth works
   - Any other `OPENCODE_*` variables
5. If opencode is not installed, find this information from:
   - GitHub source: `github.com/anomalyco/opencode` — look for `serve` command handler
   - CLI documentation
6. Document:
   - Exact command to start: `opencode serve [flags]`
   - Port detection method
   - Health check endpoint: `GET /global/health` (response format)
   - Graceful shutdown behavior (SIGTERM handling)
   - Data directory location (`~/.opencode/` or XDG)

**Addresses risk:** Roadmap Session 2 (Tauri layer)

---

## Execution Guide

### For AI agents

Each research item is **independent** — run all 5 in parallel for maximum speed.

```
R1 (SDK types)        → librarian agent (read npm package types / GitHub source)
R2 (DaemonClient)     → explorer agent (read local files in humanlayer-wui/)
R3 (Permission flow)  → librarian agent (read opencode GitHub source)
R4 (AppStore)         → explorer agent (read local files in humanlayer-wui/)
R5 (opencode serve)   → explorer + bash (try running opencode locally, or librarian for GitHub source)
```

### Output structure

```
opencode-ui-docs/
├── research/
│   ├── R1_SDK_TYPE_REFERENCE.md
│   ├── R2_DAEMON_CLIENT_INTERFACE.md
│   ├── R3_PERMISSION_FLOW.md
│   ├── R4_APPSTORE_ANALYSIS.md
│   └── R5_OPENCODE_SERVE_BEHAVIOR.md
├── OPENCODE_MIGRATION_ROADMAP.md
├── opencode-ui-migration-research.md
├── WUI_HLD_COMMUNICATION_MAP.md
└── WUI_HLD_QUICK_REFERENCE.md
```

### Definition of done

Each research document should:

1. Contain exact type definitions / code snippets (not summaries)
2. Be self-contained (agent reading it doesn't need to look at other files)
3. Include source references (file paths, GitHub URLs, line numbers)
4. End with a "Key Takeaways for Migration" section

### After all research is complete

Update `OPENCODE_MIGRATION_ROADMAP.md`:

- Mark risks as verified/mitigated
- Adjust session estimates if needed
- Add any new risks discovered
- Then proceed to Session 1 implementation
