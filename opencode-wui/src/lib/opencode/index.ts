/**
 * OpenCode integration module.
 *
 * This module provides the adapter layer for bridging the OpenCode SDK
 * to the internal UI types used by React components and Zustand stores.
 *
 * Public API:
 * - createOpencodeAdapter() — main entry point for UI layer
 * - createEventAdapter() — lower-level SSE event mapping
 * - transform*() — SDK-to-internal type converters
 * - Internal*  — UI-optimized type definitions
 */

export type {
	ContinueSessionOptions,
	FileContent,
	ModelSelection,
	OpencodeAdapter,
	OpencodeAdapterConfig,
	ProviderInfo,
	ProviderListResult,
	TextMatch,
} from './client'
// Client Adapter (main entry point)
export { createOpencodeAdapter, OpencodeError } from './client'

// Event Adapter
export { createEventAdapter } from './events'

// Transformers
export {
	aggregateSessionMetrics,
	getSessionStatusText,
	transformMessages,
	transformPart,
	transformPermission,
	transformSession,
	transformSessionStatus,
} from './transformers'

// Types
export type {
	InternalAgentMessage,
	InternalCompactionMessage,
	// Events
	InternalEvent,
	InternalFileMessage,
	InternalMessage,
	InternalMessagePartUpdatedEvent,
	InternalMessageUpdatedEvent,
	InternalPatchMessage,
	InternalPermission,
	InternalPermissionRepliedEvent,
	InternalPermissionUpdatedEvent,
	InternalReasoningMessage,
	InternalRetryMessage,
	InternalServerConnectedEvent,
	InternalSession,
	InternalSessionCreatedEvent,
	InternalSessionDeletedEvent,
	InternalSessionStatus,
	InternalSessionStatusEvent,
	InternalSessionUpdatedEvent,
	InternalSnapshotMessage,
	InternalStepFinishMessage,
	InternalStepStartMessage,
	InternalSubtaskMessage,
	InternalTextMessage,
	InternalToolMessage,
	InternalUserInputMessage,
	// Messages
	MessageRole,
	// Permissions
	PermissionResponse,
	SessionCounts,
	SessionFilter,
	// Metrics
	SessionMetrics,
	// Session
	SessionStatusType,
	ToolStatus,
	// View & Filtering
	ViewMode,
} from './types'
