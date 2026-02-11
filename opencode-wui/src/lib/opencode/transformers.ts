/**
 * Transformers for converting OpenCode SDK types to internal UI types.
 *
 * The OpenCode SDK uses a hierarchical model: Session → Message[] → Part[]
 * The UI uses a flat model: InternalMessage[] for rendering as a list.
 *
 * These transformers bridge the gap.
 */

import type {
	AssistantMessage,
	FilePart,
	Message,
	Part,
	PatchPart,
	Permission,
	ReasoningPart,
	Session,
	SessionStatus,
	SnapshotPart,
	StepFinishPart,
	StepStartPart,
	TextPart,
	ToolPart,
	ToolState,
	UserMessage,
} from '@opencode-ai/sdk'

import type {
	InternalAgentMessage,
	InternalCompactionMessage,
	InternalFileMessage,
	InternalMessage,
	InternalPatchMessage,
	InternalPermission,
	InternalReasoningMessage,
	InternalRetryMessage,
	InternalSession,
	InternalSessionStatus,
	InternalSnapshotMessage,
	InternalStepFinishMessage,
	InternalStepStartMessage,
	InternalSubtaskMessage,
	InternalTextMessage,
	InternalToolMessage,
	InternalUserInputMessage,
	SessionMetrics,
	ToolStatus,
} from './types'

// =============================================================================
// Session Transformers
// =============================================================================

/**
 * Transform an OpenCode Session + SessionStatus into an InternalSession.
 *
 * @param session - The OpenCode SDK Session object
 * @param status - Optional SessionStatus (defaults to idle)
 * @param metrics - Optional pre-computed metrics (cost, tokens, message count)
 * @param hasPendingPermissions - Whether session has pending permissions
 */
export function transformSession(
	session: Session,
	status?: SessionStatus,
	metrics?: SessionMetrics,
	hasPendingPermissions: boolean = false,
): InternalSession {
	const internalStatus = transformSessionStatus(status)

	return {
		// Core identifiers
		id: session.id,
		projectId: session.projectID,
		directory: session.directory,
		parentId: session.parentID,

		// Display info
		title: session.title,
		version: session.version,

		// Timestamps
		createdAt: session.time.created,
		updatedAt: session.time.updated,
		compactingAt: session.time.compacting,

		// Summary
		summary: session.summary
			? {
					additions: session.summary.additions,
					deletions: session.summary.deletions,
					files: session.summary.files,
					diffs: session.summary.diffs?.map((d) => ({
						path: d.file,
						additions: d.additions,
						deletions: d.deletions,
					})),
				}
			: undefined,

		// Share URL
		shareUrl: session.share?.url,

		// Revert info
		revert: session.revert
			? {
					messageId: session.revert.messageID,
					partId: session.revert.partID,
					snapshot: session.revert.snapshot,
					diff: session.revert.diff,
				}
			: undefined,

		// Status
		status: internalStatus,

		// Computed fields
		isActive: internalStatus.type === 'busy',
		hasPendingPermissions,
		totalCost: metrics?.cost ?? 0,
		totalTokens: metrics?.tokens ?? { input: 0, output: 0, reasoning: 0 },
		messageCount: metrics?.messageCount ?? 0,
	}
}

/**
 * Transform SessionStatus to InternalSessionStatus.
 */
export function transformSessionStatus(status?: SessionStatus): InternalSessionStatus {
	if (!status || status.type === 'idle') {
		return { type: 'idle' }
	}

	if (status.type === 'busy') {
		return { type: 'busy' }
	}

	if (status.type === 'retry') {
		return {
			type: 'retry',
			attempt: status.attempt,
			message: status.message,
			nextRetry: status.next,
		}
	}

	// Fallback for unknown status types
	return { type: 'idle' }
}

/**
 * Get human-readable status string from SessionStatus.
 */
export function getSessionStatusText(status?: SessionStatus): string {
	if (!status || status.type === 'idle') {
		return 'Idle'
	}

	if (status.type === 'busy') {
		return 'Processing...'
	}

	if (status.type === 'retry') {
		return `Retrying (attempt ${status.attempt})...`
	}

	return 'Unknown'
}

// =============================================================================
// Message Transformers
// =============================================================================

/**
 * Message with parts structure from session.messages().
 */
interface MessageWithParts {
	info: Message
	parts: Part[]
}

/**
 * Transform messages from session.messages() to flat InternalMessage array.
 *
 * The SDK returns: Array<{ info: Message, parts: Part[] }>
 * We flatten this to: InternalMessage[]
 *
 * Each Part becomes an InternalMessage.
 * UserMessages also get a synthetic InternalUserInputMessage.
 *
 * @param messages - Array of messages with parts from SDK
 * @returns Flat array of InternalMessage items ordered by timestamp
 */
export function transformMessages(messages: MessageWithParts[]): InternalMessage[] {
	const result: InternalMessage[] = []

	for (const { info, parts } of messages) {
		if (info.role === 'user') {
			// User messages: create a synthetic user input message
			const userMessage = info as UserMessage
			result.push(transformUserMessage(userMessage))

			// Then transform any user message parts (usually just text)
			for (const part of parts) {
				const internalPart = transformPart(part, info)
				if (internalPart) {
					result.push(internalPart)
				}
			}
		} else {
			// Assistant messages: transform all parts
			for (const part of parts) {
				const internalPart = transformPart(part, info)
				if (internalPart) {
					result.push(internalPart)
				}
			}
		}
	}

	// Sort by timestamp (preserving order within same timestamp)
	return result.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Transform a UserMessage to InternalUserInputMessage.
 */
function transformUserMessage(message: UserMessage): InternalUserInputMessage {
	return {
		id: `user-input-${message.id}`,
		sessionId: message.sessionID,
		messageId: message.id,
		role: 'user',
		type: 'user-input',
		timestamp: message.time.created,
		text: '', // User text comes from parts (TextPart)
		agent: message.agent,
		model: {
			providerId: message.model.providerID,
			modelId: message.model.modelID,
		},
	}
}

/**
 * Transform a Part to an InternalMessage.
 *
 * @param part - The SDK Part object
 * @param message - The parent Message for context
 * @returns InternalMessage or null if part type is not supported
 */
export function transformPart(part: Part, message: Message): InternalMessage | null {
	const baseFields = {
		id: part.id,
		sessionId: part.sessionID,
		messageId: part.messageID,
		role: message.role as 'user' | 'assistant',
		timestamp: getPartTimestamp(part, message),
	}

	switch (part.type) {
		case 'text':
			return transformTextPart(part as TextPart, baseFields)

		case 'reasoning':
			return transformReasoningPart(part as ReasoningPart, baseFields)

		case 'tool':
			return transformToolPart(part as ToolPart, baseFields)

		case 'file':
			return transformFilePart(part as FilePart, baseFields)

		case 'subtask':
			return transformSubtaskPart(
				part as Part & { type: 'subtask'; prompt: string; description: string; agent: string },
				baseFields,
			)

		case 'step-start':
			return transformStepStartPart(part as StepStartPart, baseFields)

		case 'step-finish':
			return transformStepFinishPart(part as StepFinishPart, baseFields)

		case 'snapshot':
			return transformSnapshotPart(part as SnapshotPart, baseFields)

		case 'patch':
			return transformPatchPart(part as PatchPart, baseFields)

		case 'agent':
			return transformAgentPart(
				part as Part & {
					type: 'agent'
					name: string
					source?: { value: string; start: number; end: number }
				},
				baseFields,
			)

		case 'retry':
			return transformRetryPart(
				part as Part & {
					type: 'retry'
					attempt: number
					error: { name: string; data: { message: string; statusCode?: number; isRetryable?: boolean } }
					time: { created: number }
				},
				baseFields,
			)

		case 'compaction':
			return transformCompactionPart(part as Part & { type: 'compaction'; auto: boolean }, baseFields)

		default:
			// Unknown part type - skip
			return null
	}
}

/**
 * Get timestamp for a part.
 */
function getPartTimestamp(part: Part, message: Message): number {
	// Parts with their own time field
	if ('time' in part && part.time) {
		const time = part.time as { start?: number; end?: number; created?: number }
		return time.start ?? time.created ?? message.time.created
	}

	// Fall back to message creation time
	return message.time.created
}

// =============================================================================
// Part Transformers
// =============================================================================

interface BaseFields {
	id: string
	sessionId: string
	messageId: string
	role: 'user' | 'assistant'
	timestamp: number
}

function transformTextPart(part: TextPart, base: BaseFields): InternalTextMessage {
	return {
		...base,
		type: 'text',
		role: 'assistant',
		text: part.text,
		synthetic: part.synthetic,
		ignored: part.ignored,
	}
}

function transformReasoningPart(part: ReasoningPart, base: BaseFields): InternalReasoningMessage {
	return {
		...base,
		type: 'reasoning',
		role: 'assistant',
		text: part.text,
		startTime: part.time.start,
		endTime: part.time.end,
	}
}

function transformToolPart(part: ToolPart, base: BaseFields): InternalToolMessage {
	const state = part.state
	const status = getToolStatus(state)

	const result: InternalToolMessage = {
		...base,
		type: 'tool',
		role: 'assistant',
		callId: part.callID,
		toolName: part.tool,
		status,
		input: state.input,
		metadata: part.metadata,
	}

	// Add status-specific fields
	if (state.status === 'running' || state.status === 'completed' || state.status === 'error') {
		result.startTime = state.time.start
	}

	if (state.status === 'running') {
		result.title = state.title
		if (state.metadata) {
			result.metadata = { ...result.metadata, ...state.metadata }
		}
	}

	if (state.status === 'completed') {
		result.title = state.title
		result.output = state.output
		result.endTime = state.time.end
		result.metadata = { ...result.metadata, ...state.metadata }
		// Transform attachments
		if (state.attachments) {
			result.attachments = state.attachments.map((att) => ({
				id: att.id,
				sessionId: att.sessionID,
				messageId: att.messageID,
				role: 'assistant' as const,
				type: 'file' as const,
				timestamp: base.timestamp,
				mime: att.mime,
				filename: att.filename,
				url: att.url,
			}))
		}
	}

	if (state.status === 'error') {
		result.error = state.error
		result.endTime = state.time.end
		if (state.metadata) {
			result.metadata = { ...result.metadata, ...state.metadata }
		}
	}

	return result
}

function getToolStatus(state: ToolState): ToolStatus {
	return state.status
}

function transformFilePart(part: FilePart, base: BaseFields): InternalFileMessage {
	return {
		...base,
		type: 'file',
		role: 'assistant',
		mime: part.mime,
		filename: part.filename,
		url: part.url,
	}
}

function transformSubtaskPart(
	part: { type: 'subtask'; prompt: string; description: string; agent: string } & Part,
	base: BaseFields,
): InternalSubtaskMessage {
	return {
		...base,
		type: 'subtask',
		role: 'assistant',
		prompt: part.prompt,
		description: part.description,
		agent: part.agent,
	}
}

function transformStepStartPart(part: StepStartPart, base: BaseFields): InternalStepStartMessage {
	return {
		...base,
		type: 'step-start',
		role: 'assistant',
		snapshot: part.snapshot,
	}
}

function transformStepFinishPart(part: StepFinishPart, base: BaseFields): InternalStepFinishMessage {
	return {
		...base,
		type: 'step-finish',
		role: 'assistant',
		reason: part.reason,
		snapshot: part.snapshot,
		cost: part.cost,
		tokens: {
			input: part.tokens.input,
			output: part.tokens.output,
			reasoning: part.tokens.reasoning,
			cache: {
				read: part.tokens.cache.read,
				write: part.tokens.cache.write,
			},
		},
	}
}

function transformSnapshotPart(part: SnapshotPart, base: BaseFields): InternalSnapshotMessage {
	return {
		...base,
		type: 'snapshot',
		role: 'assistant',
		snapshot: part.snapshot,
	}
}

function transformPatchPart(part: PatchPart, base: BaseFields): InternalPatchMessage {
	return {
		...base,
		type: 'patch',
		role: 'assistant',
		hash: part.hash,
		files: part.files,
	}
}

function transformAgentPart(
	part: { type: 'agent'; name: string; source?: { value: string; start: number; end: number } } & Part,
	base: BaseFields,
): InternalAgentMessage {
	return {
		...base,
		type: 'agent',
		role: 'assistant',
		name: part.name,
		source: part.source,
	}
}

function transformRetryPart(
	part: {
		type: 'retry'
		attempt: number
		error: { name: string; data: { message: string; statusCode?: number; isRetryable?: boolean } }
		time: { created: number }
	} & Part,
	base: BaseFields,
): InternalRetryMessage {
	return {
		...base,
		type: 'retry',
		role: 'assistant',
		timestamp: part.time.created,
		attempt: part.attempt,
		error: {
			name: part.error.name,
			message: part.error.data.message,
			statusCode: part.error.data.statusCode,
			isRetryable: part.error.data.isRetryable,
		},
	}
}

function transformCompactionPart(
	part: { type: 'compaction'; auto: boolean } & Part,
	base: BaseFields,
): InternalCompactionMessage {
	return {
		...base,
		type: 'compaction',
		role: 'assistant',
		auto: part.auto,
	}
}

// =============================================================================
// Permission Transformers
// =============================================================================

/**
 * Transform an OpenCode Permission to InternalPermission.
 */
export function transformPermission(permission: Permission): InternalPermission {
	return {
		id: permission.id,
		sessionId: permission.sessionID,
		messageId: permission.messageID,
		callId: permission.callID,
		type: permission.type,
		title: permission.title,
		pattern: permission.pattern,
		metadata: permission.metadata,
		createdAt: permission.time.created,
		responded: false,
		response: undefined,
	}
}

// =============================================================================
// Metrics Aggregation
// =============================================================================

/**
 * Aggregate session metrics from messages.
 *
 * @param messages - Array of messages with parts from SDK
 * @returns Aggregated metrics (cost, tokens, message count)
 */
export function aggregateSessionMetrics(messages: MessageWithParts[]): SessionMetrics {
	let totalCost = 0
	let totalInputTokens = 0
	let totalOutputTokens = 0
	let totalReasoningTokens = 0
	let messageCount = 0

	for (const { info } of messages) {
		messageCount++

		if (info.role === 'assistant') {
			const assistantMsg = info as AssistantMessage
			totalCost += assistantMsg.cost
			totalInputTokens += assistantMsg.tokens.input
			totalOutputTokens += assistantMsg.tokens.output
			totalReasoningTokens += assistantMsg.tokens.reasoning
		}
	}

	return {
		cost: totalCost,
		tokens: {
			input: totalInputTokens,
			output: totalOutputTokens,
			reasoning: totalReasoningTokens,
		},
		messageCount,
	}
}
