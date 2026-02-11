/**
 * Internal types for OpenCode Web UI.
 *
 * These types are the UI's internal representation, separate from the SDK types.
 * They are optimized for rendering and state management.
 *
 * SDK types are from @opencode-ai/sdk (Session, Message, Part, etc.)
 * Internal types are what the UI components actually consume.
 */

// =============================================================================
// View Mode & Filtering
// =============================================================================

/**
 * View mode for session list.
 * Note: OpenCode does NOT have drafts - only Normal and Archived views.
 */
export type ViewMode = 'normal' | 'archived'

/**
 * Filter options for session list.
 */
export interface SessionFilter {
	/** View mode (normal or archived) */
	viewMode: ViewMode
	/** Optional search query */
	searchQuery?: string
	/** Filter by project ID */
	projectId?: string
}

/**
 * Session counts for sidebar badges.
 */
export interface SessionCounts {
	/** Total active (non-archived) sessions */
	normal: number
	/** Total archived sessions */
	archived: number
	/** Sessions with pending permissions */
	pendingPermissions: number
}

// =============================================================================
// Session Status
// =============================================================================

/**
 * Human-readable session status.
 */
export type SessionStatusType = 'idle' | 'busy' | 'retry'

/**
 * Internal session status with computed fields.
 */
export interface InternalSessionStatus {
	type: SessionStatusType
	/** For retry status: current attempt number */
	attempt?: number
	/** For retry status: error message */
	message?: string
	/** For retry status: next retry time (Unix ms) */
	nextRetry?: number
}

// =============================================================================
// Internal Session
// =============================================================================

/**
 * Internal session representation combining Session + SessionStatus with computed fields.
 * This is what UI components consume for rendering session list items and details.
 */
export interface InternalSession {
	// Core identifiers
	id: string
	projectId: string
	directory: string
	parentId?: string

	// Display info
	title: string
	version: string

	// Timestamps (Unix milliseconds)
	createdAt: number
	updatedAt: number
	compactingAt?: number

	// Summary info (from code changes)
	summary?: {
		additions: number
		deletions: number
		files: number
		diffs?: Array<{
			path: string
			additions: number
			deletions: number
		}>
	}

	// Share URL if shared
	shareUrl?: string

	// Revert info if reverting
	revert?: {
		messageId: string
		partId?: string
		snapshot?: string
		diff?: string
	}

	// Status (computed from SessionStatus)
	status: InternalSessionStatus

	// Computed fields
	/** True if session is currently busy (processing) */
	isActive: boolean
	/** True if session has pending permission requests */
	hasPendingPermissions: boolean
	/** Total cost in USD across all messages */
	totalCost: number
	/** Total tokens used */
	totalTokens: {
		input: number
		output: number
		reasoning: number
	}
	/** Message count */
	messageCount: number
}

// =============================================================================
// Message Types
// =============================================================================

/**
 * Message role.
 */
export type MessageRole = 'user' | 'assistant'

/**
 * Internal message type - flattened representation of a message part.
 * Each item in the conversation list is an InternalMessage.
 */
export type InternalMessage =
	| InternalTextMessage
	| InternalReasoningMessage
	| InternalToolMessage
	| InternalFileMessage
	| InternalSubtaskMessage
	| InternalStepStartMessage
	| InternalStepFinishMessage
	| InternalSnapshotMessage
	| InternalPatchMessage
	| InternalAgentMessage
	| InternalRetryMessage
	| InternalCompactionMessage
	| InternalUserInputMessage

/**
 * Base fields common to all internal messages.
 */
interface InternalMessageBase {
	/** Unique identifier (part.id or generated for user messages) */
	id: string
	/** Session ID */
	sessionId: string
	/** Parent message ID */
	messageId: string
	/** Message role (user or assistant) */
	role: MessageRole
	/** Timestamp (Unix milliseconds) */
	timestamp: number
}

/**
 * User input message (the prompt from user).
 */
export interface InternalUserInputMessage extends InternalMessageBase {
	type: 'user-input'
	role: 'user'
	/** The user's text input */
	text: string
	/** Agent name */
	agent: string
	/** Model info */
	model: {
		providerId: string
		modelId: string
	}
}

/**
 * Text message from assistant.
 */
export interface InternalTextMessage extends InternalMessageBase {
	type: 'text'
	role: 'assistant'
	/** The text content */
	text: string
	/** Is this synthetic (system-generated)? */
	synthetic?: boolean
	/** Is this ignored in context? */
	ignored?: boolean
}

/**
 * Reasoning/thinking message from assistant.
 */
export interface InternalReasoningMessage extends InternalMessageBase {
	type: 'reasoning'
	role: 'assistant'
	/** The reasoning text */
	text: string
	/** Start time (Unix ms) */
	startTime: number
	/** End time (Unix ms) if completed */
	endTime?: number
}

/**
 * Tool state for tool messages.
 */
export type ToolStatus = 'pending' | 'running' | 'completed' | 'error'

/**
 * Tool call message from assistant.
 */
export interface InternalToolMessage extends InternalMessageBase {
	type: 'tool'
	role: 'assistant'
	/** Tool call ID from LLM */
	callId: string
	/** Tool name (e.g., "bash", "edit", "read") */
	toolName: string
	/** Current tool status */
	status: ToolStatus
	/** Tool title (human-readable) */
	title?: string
	/** Tool input parameters */
	input: Record<string, unknown>
	/** Tool output (if completed) */
	output?: string
	/** Error message (if error) */
	error?: string
	/** Tool metadata */
	metadata?: Record<string, unknown>
	/** Start time (Unix ms) */
	startTime?: number
	/** End time (Unix ms) if completed */
	endTime?: number
	/** Attachments (e.g., images) */
	attachments?: InternalFileMessage[]
}

/**
 * File/attachment message.
 */
export interface InternalFileMessage extends InternalMessageBase {
	type: 'file'
	role: 'assistant'
	/** MIME type */
	mime: string
	/** Filename */
	filename?: string
	/** URL to access the file */
	url: string
}

/**
 * Subtask spawn message.
 */
export interface InternalSubtaskMessage extends InternalMessageBase {
	type: 'subtask'
	role: 'assistant'
	/** Subtask prompt */
	prompt: string
	/** Subtask description */
	description: string
	/** Agent to run the subtask */
	agent: string
}

/**
 * Step start message (marks beginning of an LLM turn).
 */
export interface InternalStepStartMessage extends InternalMessageBase {
	type: 'step-start'
	role: 'assistant'
	/** Git snapshot hash before step */
	snapshot?: string
}

/**
 * Step finish message (marks end of an LLM turn).
 */
export interface InternalStepFinishMessage extends InternalMessageBase {
	type: 'step-finish'
	role: 'assistant'
	/** Finish reason */
	reason: string
	/** Git snapshot hash after step */
	snapshot?: string
	/** Cost for this step in USD */
	cost: number
	/** Token usage for this step */
	tokens: {
		input: number
		output: number
		reasoning: number
		cache: { read: number; write: number }
	}
}

/**
 * Snapshot message (git checkpoint).
 */
export interface InternalSnapshotMessage extends InternalMessageBase {
	type: 'snapshot'
	role: 'assistant'
	/** Git snapshot hash */
	snapshot: string
}

/**
 * Patch message (file changes).
 */
export interface InternalPatchMessage extends InternalMessageBase {
	type: 'patch'
	role: 'assistant'
	/** Patch hash */
	hash: string
	/** Affected file paths */
	files: string[]
}

/**
 * Agent switch message.
 */
export interface InternalAgentMessage extends InternalMessageBase {
	type: 'agent'
	role: 'assistant'
	/** New agent name */
	name: string
	/** Source info */
	source?: { value: string; start: number; end: number }
}

/**
 * Retry message (after error).
 */
export interface InternalRetryMessage extends InternalMessageBase {
	type: 'retry'
	role: 'assistant'
	/** Retry attempt number */
	attempt: number
	/** Error that caused retry */
	error: {
		name: string
		message: string
		statusCode?: number
		isRetryable?: boolean
	}
}

/**
 * Compaction message (context window management).
 */
export interface InternalCompactionMessage extends InternalMessageBase {
	type: 'compaction'
	role: 'assistant'
	/** Was this auto-compacted? */
	auto: boolean
}

// =============================================================================
// Permission Types
// =============================================================================

/**
 * Permission response options.
 */
export type PermissionResponse = 'once' | 'always' | 'reject'

/**
 * Internal permission representation.
 */
export interface InternalPermission {
	/** Unique permission ID */
	id: string
	/** Session ID */
	sessionId: string
	/** Message ID that triggered the permission */
	messageId: string
	/** Tool call ID if related to a tool */
	callId?: string
	/** Permission type (e.g., "bash", "edit") */
	type: string
	/** Human-readable title */
	title: string
	/** Pattern for "always" rules */
	pattern?: string | string[]
	/** Additional metadata */
	metadata: Record<string, unknown>
	/** Created timestamp (Unix ms) */
	createdAt: number
	/** Has user responded? */
	responded: boolean
	/** User's response (if responded) */
	response?: PermissionResponse
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Normalized internal event types.
 * These are the events the UI cares about (subset of 43+ opencode event types).
 */
export type InternalEvent =
	| InternalSessionCreatedEvent
	| InternalSessionUpdatedEvent
	| InternalSessionDeletedEvent
	| InternalSessionStatusEvent
	| InternalMessageUpdatedEvent
	| InternalMessagePartUpdatedEvent
	| InternalPermissionUpdatedEvent
	| InternalPermissionRepliedEvent
	| InternalServerConnectedEvent

interface InternalEventBase {
	/** Project directory */
	directory: string
	/** Event timestamp (when received) */
	receivedAt: number
}

export interface InternalSessionCreatedEvent extends InternalEventBase {
	type: 'session.created'
	sessionId: string
}

export interface InternalSessionUpdatedEvent extends InternalEventBase {
	type: 'session.updated'
	sessionId: string
}

export interface InternalSessionDeletedEvent extends InternalEventBase {
	type: 'session.deleted'
	sessionId: string
}

export interface InternalSessionStatusEvent extends InternalEventBase {
	type: 'session.status'
	sessionId: string
	status: InternalSessionStatus
}

export interface InternalMessageUpdatedEvent extends InternalEventBase {
	type: 'message.updated'
	sessionId: string
	messageId: string
	role: MessageRole
}

export interface InternalMessagePartUpdatedEvent extends InternalEventBase {
	type: 'message.part.updated'
	sessionId: string
	messageId: string
	partId: string
	/** The updated part as InternalMessage */
	message: InternalMessage
	/** Optional text delta for streaming */
	delta?: string
}

export interface InternalPermissionUpdatedEvent extends InternalEventBase {
	type: 'permission.updated'
	permission: InternalPermission
}

export interface InternalPermissionRepliedEvent extends InternalEventBase {
	type: 'permission.replied'
	sessionId: string
	permissionId: string
	response: PermissionResponse
}

export interface InternalServerConnectedEvent extends InternalEventBase {
	type: 'server.connected'
}

// =============================================================================
// Aggregated Metrics
// =============================================================================

/**
 * Aggregated session metrics from messages.
 */
export interface SessionMetrics {
	/** Total cost in USD */
	cost: number
	/** Total token usage */
	tokens: {
		input: number
		output: number
		reasoning: number
	}
	/** Message count */
	messageCount: number
}
