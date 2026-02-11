# OpenCode SDK Type Reference

**Document Version:** 1.0  
**OpenCode SDK Version:** 1.1.34 (as of Feb 2026)  
**Source Repository:** [github.com/sst/opencode](https://github.com/sst/opencode)  
**Primary Source File:** [packages/sdk/js/src/gen/types.gen.ts](https://github.com/sst/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)

---

## Overview

This document provides comprehensive TypeScript type definitions for the `@opencode-ai/sdk` package. These types are auto-generated from the OpenAPI 3.1 specification using `@hey-api/openapi-ts`.

The OpenCode SDK uses a **hierarchical message model** where:

- A **Session** contains multiple **Messages**
- Each **Message** (user or assistant) contains multiple **Parts**
- **Parts** represent atomic content units (text, tool calls, files, reasoning, etc.)

---

## Core Session Types

### Session

The main conversation context object.

```typescript
export type Session = {
  id: string; // Unique session identifier
  projectID: string; // Associated project ID
  directory: string; // Working directory path
  parentID?: string; // Parent session ID (for forked sessions)

  summary?: {
    additions: number; // Total lines added
    deletions: number; // Total lines deleted
    files: number; // Number of files modified
    diffs?: Array<FileDiff>; // Detailed file diffs
  };

  share?: {
    url: string; // Public share URL if shared
  };

  title: string; // Session title
  version: string; // OpenCode version

  time: {
    created: number; // Unix timestamp (ms) when created
    updated: number; // Unix timestamp (ms) last updated
    compacting?: number; // Unix timestamp (ms) if compaction in progress
  };

  revert?: {
    messageID: string; // Message to revert to
    partID?: string; // Specific part to revert to
    snapshot?: string; // Snapshot hash
    diff?: string; // Diff to apply
  };
};
```

**Source:** [types.gen.ts#L665-L693](https://github.com/sst/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts#L665-L693)

---

### SessionStatus

Represents the current state of a session.

```typescript
export type SessionStatus =
  | {
      type: "idle"; // Session is idle, ready for input
    }
  | {
      type: "retry"; // Session is retrying after error
      attempt: number; // Current retry attempt number
      message: string; // Error message
      next: number; // Unix timestamp (ms) of next retry
    }
  | {
      type: "busy"; // Session is actively processing
    };
```

**Source:** [types.gen.ts#L619-L629](https://github.com/sst/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts#L619-L629)

---

## Message Types

### Message (Union Type)

```typescript
export type Message = UserMessage | AssistantMessage;
```

### UserMessage

```typescript
export type UserMessage = {
  id: string; // Unique message ID
  sessionID: string; // Parent session ID
  role: "user"; // Always "user"

  time: {
    created: number; // Unix timestamp (ms) when created
  };

  summary?: {
    title?: string; // Optional summary title
    body?: string; // Optional summary body
    diffs: Array<FileDiff>; // File changes in this message
  };

  agent: string; // Agent name (e.g., "build", "plan")

  model: {
    providerID: string; // Provider ID (e.g., "anthropic")
    modelID: string; // Model ID (e.g., "claude-sonnet-4")
  };

  system?: string; // Optional system prompt override

  tools?: {
    [key: string]: boolean; // Tool enable/disable map
  };
};
```

**Source:** [types.gen.ts#L47-L68](https://github.com/sst/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts#L47-L68)

---

### AssistantMessage

```typescript
export type AssistantMessage = {
  id: string; // Unique message ID
  sessionID: string; // Parent session ID
  role: "assistant"; // Always "assistant"

  time: {
    created: number; // Unix timestamp (ms) when created
    completed?: number; // Unix timestamp (ms) when completed
  };

  error?:
    | ProviderAuthError
    | UnknownError
    | MessageOutputLengthError
    | MessageAbortedError
    | ApiError; // Error if message failed

  parentID: string; // Parent message ID (the user message)
  modelID: string; // Model ID used
  providerID: string; // Provider ID used
  mode: string; // Agent mode (e.g., "agentic", "text-only")

  path: {
    cwd: string; // Current working directory
    root: string; // Project root directory
  };

  summary?: boolean; // Whether this is a summary message

  cost: number; // Total cost in USD

  tokens: {
    input: number; // Input tokens used
    output: number; // Output tokens generated
    reasoning: number; // Reasoning tokens (for reasoning models)
    cache: {
      read: number; // Cache read tokens
      write: number; // Cache write tokens
    };
  };

  finish?: string; // Finish reason (e.g., "stop", "length", "tool_calls")
};
```

**Source:** [types.gen.ts#L114-L145](https://github.com/sst/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts#L114-L145)

---

## Part Types

### Part (Union Type)

```typescript
export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart;
```

**Source:** [types.gen.ts#L433-L446](https://github.com/sst/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts#L433-L446)

---

### TextPart

```typescript
export type TextPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";

  text: string; // The actual text content
  synthetic?: boolean; // True if generated by system (not LLM)
  ignored?: boolean; // True if ignored in context

  time?: {
    start: number;
    end?: number;
  };

  metadata?: { [key: string]: unknown };
};
```

### ReasoningPart

```typescript
export type ReasoningPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";

  text: string; // The reasoning text
  metadata?: { [key: string]: unknown };

  time: {
    start: number;
    end?: number;
  };
};
```

### FilePart

```typescript
export type FilePart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "file";

  mime: string; // MIME type (e.g., "image/png")
  filename?: string; // Original filename
  url: string; // URL to access the file
  source?: FilePartSource; // Source information
};
```

### ToolPart

```typescript
export type ToolPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";

  callID: string; // Tool call ID (from LLM)
  tool: string; // Tool name (e.g., "bash", "edit", "read")
  state: ToolState; // Current state (see below)
  metadata?: { [key: string]: unknown };
};
```

### ToolState (Union Type)

```typescript
export type ToolState =
  | ToolStatePending
  | ToolStateRunning
  | ToolStateCompleted
  | ToolStateError;

export type ToolStatePending = {
  status: "pending";
  input: { [key: string]: unknown };
  raw: string; // Raw JSON string from LLM
};

export type ToolStateRunning = {
  status: "running";
  input: { [key: string]: unknown };
  title?: string;
  metadata?: { [key: string]: unknown };
  time: { start: number };
};

export type ToolStateCompleted = {
  status: "completed";
  input: { [key: string]: unknown };
  output: string; // Tool output
  title: string;
  metadata: { [key: string]: unknown };
  time: { start: number; end: number; compacted?: number };
  attachments?: Array<FilePart>;
};

export type ToolStateError = {
  status: "error";
  input: { [key: string]: unknown };
  error: string; // Error message
  metadata?: { [key: string]: unknown };
  time: { start: number; end: number };
};
```

### SubtaskPart

```typescript
// Inline in Part union, not a separate export
{
  id: string;
  sessionID: string;
  messageID: string;
  type: "subtask";
  prompt: string;
  description: string;
  agent: string;
}
```

### StepStartPart

```typescript
export type StepStartPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-start";
  snapshot?: string; // Git snapshot hash before step
};
```

### StepFinishPart

```typescript
export type StepFinishPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";

  reason: string; // Finish reason
  snapshot?: string; // Git snapshot hash after step
  cost: number; // Cost for this step (USD)
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
};
```

### SnapshotPart

```typescript
export type SnapshotPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "snapshot";
  snapshot: string; // Git snapshot hash
};
```

### PatchPart

```typescript
export type PatchPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "patch";
  hash: string; // Patch hash
  files: Array<string>; // Affected file paths
};
```

### AgentPart

```typescript
export type AgentPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "agent";
  name: string; // New agent name
  source?: { value: string; start: number; end: number };
};
```

### RetryPart

```typescript
export type RetryPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "retry";
  attempt: number;
  error: ApiError;
  time: { created: number };
};
```

### CompactionPart

```typescript
export type CompactionPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "compaction";
  auto: boolean; // True if auto-compacted
};
```

---

## Permission System

### Permission

```typescript
export type Permission = {
  id: string; // Unique permission ID
  type: string; // Permission type (e.g., "edit", "bash")
  pattern?: string | Array<string>;
  sessionID: string;
  messageID: string;
  callID?: string; // Tool call ID if related to a tool
  title: string; // Human-readable title
  metadata: { [key: string]: unknown };
  time: { created: number };
};
```

---

## Error Types

```typescript
export type ProviderAuthError = {
  name: "ProviderAuthError";
  data: { providerID: string; message: string };
};

export type UnknownError = {
  name: "UnknownError";
  data: { message: string };
};

export type MessageOutputLengthError = {
  name: "MessageOutputLengthError";
  data: { [key: string]: unknown };
};

export type MessageAbortedError = {
  name: "MessageAbortedError";
  data: { message: string };
};

export type ApiError = {
  name: "APIError";
  data: {
    message: string;
    statusCode?: number;
    isRetryable: boolean;
    responseHeaders?: { [key: string]: string };
    responseBody?: string;
  };
};
```

---

## Server-Sent Events (SSE)

### Key Events for UI

#### EventMessagePartUpdated (Most important for streaming)

```typescript
export type EventMessagePartUpdated = {
  type: "message.part.updated";
  properties: {
    part: Part; // FULL current state of the part
    delta?: string; // Optional: just the new text chunk
  };
};
```

#### EventMessageUpdated

```typescript
export type EventMessageUpdated = {
  type: "message.updated";
  properties: { info: Message };
};
```

#### EventSessionStatus

```typescript
export type EventSessionStatus = {
  type: "session.status";
  properties: { sessionID: string; status: SessionStatus };
};
```

#### EventSessionIdle

```typescript
export type EventSessionIdle = {
  type: "session.idle";
  properties: { sessionID: string };
};
```

#### EventPermissionUpdated

```typescript
export type EventPermissionUpdated = {
  type: "permission.updated";
  properties: Permission;
};
```

#### EventServerConnected

```typescript
export type EventServerConnected = {
  type: "server.connected";
  properties: { [key: string]: unknown };
};
```

### All Event Types

```typescript
export type Event =
  | EventServerInstanceDisposed
  | EventInstallationUpdated
  | EventInstallationUpdateAvailable
  | EventLspClientDiagnostics
  | EventLspUpdated
  | EventMessageUpdated
  | EventMessageRemoved
  | EventMessagePartUpdated
  | EventMessagePartRemoved
  | EventPermissionUpdated
  | EventPermissionReplied
  | EventSessionStatus
  | EventSessionIdle
  | EventSessionCompacted
  | EventFileEdited
  | EventTodoUpdated
  | EventCommandExecuted
  | EventSessionCreated
  | EventSessionUpdated
  | EventSessionDeleted
  | EventSessionDiff
  | EventSessionError
  | EventFileWatcherUpdated
  | EventVcsBranchUpdated
  | EventTuiPromptAppend
  | EventTuiCommandExecute
  | EventTuiToastShow
  | EventPtyCreated
  | EventPtyUpdated
  | EventPtyExited
  | EventPtyDeleted
  | EventServerConnected;
```

### GlobalEvent Wrapper

```typescript
export type GlobalEvent = {
  directory: string; // Project directory
  payload: Event; // The actual event
};
```

---

## Key Takeaways for Migration

### 1. Hierarchical vs. Flat Model

**OpenCode:** `Session → Message[] → Part[]`  
**WUI target:** `ConversationEvent[]` (flat)

The transformer must flatten while preserving message boundaries, temporal ordering, and tool state transitions.

### 2. Streaming is Part-Centric

- `message.part.updated` is the primary event for streaming
- Each event contains **full part state** + optional `delta`
- Parts are immutable once completed

### 3. Tool State Machine

```
pending → running → completed/error
```

Each state has different fields. Transformer must handle partial tool parts during streaming.

### 4. Message Completion Detection

A message is complete when:

1. `EventSessionIdle` received, OR
2. `AssistantMessage.time.completed` set, OR
3. `AssistantMessage.finish` present

### 5. Reconnection Strategy

1. Call `client.session.messages()` for current state
2. Subscribe to `client.event.subscribe()` for new updates
3. Use `part.id` for deduplication

### 6. Timestamps are Unix Milliseconds

All `time` fields: `new Date(time.created)`

### 7. Cost and Token Tracking

- Per-step: `StepFinishPart.cost` / `StepFinishPart.tokens`
- Per-message: `AssistantMessage.cost` / `AssistantMessage.tokens`
- Costs in USD

### 8. Permission Handling

Permissions are **blocking** — session pauses until replied.

---

## Additional Resources

- **GitHub Repository:** https://github.com/sst/opencode
- **Type Definitions:** https://github.com/sst/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts
- **SDK Documentation:** https://opencode.ai/docs/sdk/
- **Server API Spec:** http://localhost:4096/doc (when server is running)
