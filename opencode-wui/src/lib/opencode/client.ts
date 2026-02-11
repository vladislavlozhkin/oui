/**
 * OpenCode Client Wrapper.
 *
 * Bridges the OpenCode SDK to internal UI types.
 * Provides a clean interface for the UI layer to interact with the OpenCode server.
 */

import type { Agent, FileDiff, Message, OpencodeClient, Part, Session, SessionStatus } from '@opencode-ai/sdk'
import { createOpencodeClient } from '@opencode-ai/sdk/client'
import { createEventAdapter } from './events'

import { aggregateSessionMetrics, transformMessages, transformSession } from './transformers'
import type { InternalEvent, InternalMessage, InternalSession, PermissionResponse, SessionMetrics } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for creating an OpenCode adapter.
 */
export interface OpencodeAdapterConfig {
	/** Base URL of the OpenCode server (e.g., http://127.0.0.1:PORT) */
	baseUrl: string
	/** Working directory for the project */
	directory: string
}

/**
 * Text match result from find.text().
 */
export interface TextMatch {
	path: string
	line: number
	text: string
}

/**
 * File content result from file.read().
 */
export interface FileContent {
	type: string
	content: string
}

/**
 * Model selection for prompts.
 */
export interface ModelSelection {
	providerId: string
	modelId: string
}

/**
 * Options for continuing a session.
 */
export interface ContinueSessionOptions {
	agent?: string
	model?: ModelSelection
}

/**
 * Provider info from the SDK.
 * This is a simplified representation of the SDK Provider type.
 */
export interface ProviderInfo {
	id: string
	name: string
	api?: string
	npm?: string
	env: string[]
	models: Record<string, unknown>
}

/**
 * Provider list result.
 */
export interface ProviderListResult {
	all: ProviderInfo[]
	default: Record<string, string>
	connected: string[]
}

/**
 * Config providers result.
 */
export interface ConfigProvidersResult {
	providers: ProviderInfo[]
	default: Record<string, string>
}

/**
 * Adapter interface for OpenCode operations.
 * Wraps SDK calls and transforms responses to internal types.
 */
export interface OpencodeAdapter {
	// =========================================================================
	// Session Methods
	// =========================================================================

	/**
	 * List all sessions for the current directory.
	 * Returns sessions sorted by updatedAt descending.
	 */
	listSessions(): Promise<InternalSession[]>

	/**
	 * Get a session by ID with full details including metrics.
	 */
	getSession(id: string): Promise<InternalSession>

	/**
	 * Create a new session.
	 */
	createSession(params: { title?: string; parentId?: string }): Promise<InternalSession>

	/**
	 * Continue a session with a new message.
	 * Uses promptAsync for fire-and-forget behavior.
	 */
	continueSession(id: string, message: string, options?: ContinueSessionOptions): Promise<void>

	/**
	 * Abort a running session.
	 */
	abortSession(id: string): Promise<void>

	/**
	 * Delete a session and all its data.
	 */
	deleteSession(id: string): Promise<void>

	/**
	 * Fork a session at a specific message.
	 */
	forkSession(id: string, messageId?: string): Promise<InternalSession>

	/**
	 * Share a session publicly.
	 */
	shareSession(id: string): Promise<InternalSession>

	/**
	 * Unshare a previously shared session.
	 */
	unshareSession(id: string): Promise<InternalSession>

	/**
	 * Get file diffs for a session.
	 */
	getSessionDiff(id: string, messageId?: string): Promise<FileDiff[]>

	/**
	 * Revert a session to a specific message.
	 */
	revertSession(id: string, messageId: string, partId?: string): Promise<InternalSession>

	/**
	 * Restore all reverted messages in a session.
	 */
	unrevertSession(id: string): Promise<InternalSession>

	// =========================================================================
	// Conversation Methods
	// =========================================================================

	/**
	 * Get all messages for a session.
	 */
	getMessages(sessionId: string): Promise<InternalMessage[]>

	// =========================================================================
	// Permission Methods
	// =========================================================================

	/**
	 * Respond to a permission request.
	 */
	respondToPermission(sessionId: string, permissionId: string, response: PermissionResponse): Promise<void>

	// =========================================================================
	// File Methods
	// =========================================================================

	/**
	 * Find files matching a query.
	 */
	findFiles(query: string): Promise<string[]>

	/**
	 * Find text in files matching a pattern.
	 */
	findText(pattern: string): Promise<TextMatch[]>

	/**
	 * Read file content.
	 */
	readFile(path: string): Promise<FileContent>

	// =========================================================================
	// System Methods
	// =========================================================================

	/**
	 * Get server configuration.
	 */
	getConfig(): Promise<unknown>

	/**
	 * List all providers.
	 */
	listProviders(): Promise<ProviderListResult>

	/**
	 * List all available agents.
	 */
	listAgents(): Promise<Agent[]>

	// =========================================================================
	// Event Subscription
	// =========================================================================

	/**
	 * Subscribe to server events.
	 * Returns an unsubscribe function.
	 */
	subscribe(handler: (event: InternalEvent) => void): { unsubscribe: () => void }

	// =========================================================================
	// Cleanup
	// =========================================================================

	/**
	 * Dispose of the adapter and clean up resources.
	 */
	dispose(): void
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Error thrown when an SDK call fails.
 */
export class OpencodeError extends Error {
	constructor(
		message: string,
		public readonly operation: string,
		public readonly cause?: unknown,
	) {
		super(message)
		this.name = 'OpencodeError'
	}
}

/**
 * Extract data from SDK response, throwing on error.
 */
function extractData<T>(result: { data?: T; error?: unknown }, operation: string): T {
	if (result.error) {
		throw new OpencodeError(`Failed to ${operation}: ${String(result.error)}`, operation, result.error)
	}
	if (result.data === undefined) {
		throw new OpencodeError(`No data returned from ${operation}`, operation)
	}
	return result.data
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an OpenCode adapter instance.
 *
 * @param config - Adapter configuration with baseUrl and directory
 * @returns OpencodeAdapter instance
 *
 * @example
 * ```ts
 * const adapter = createOpencodeAdapter({
 *   baseUrl: 'http://127.0.0.1:3000',
 *   directory: '/path/to/project'
 * })
 *
 * // List sessions
 * const sessions = await adapter.listSessions()
 *
 * // Subscribe to events
 * const { unsubscribe } = adapter.subscribe((event) => {
 *   console.log('Event:', event.type)
 * })
 *
 * // Clean up when done
 * adapter.dispose()
 * ```
 */
export function createOpencodeAdapter(config: OpencodeAdapterConfig): OpencodeAdapter {
	const { baseUrl, directory } = config

	// Create the SDK client
	const client: OpencodeClient = createOpencodeClient({ baseUrl })

	// Create the event adapter for SSE subscription
	const eventAdapter = createEventAdapter(client, directory)

	// =========================================================================
	// Session Methods
	// =========================================================================

	async function listSessions(): Promise<InternalSession[]> {
		// Fetch sessions and statuses in parallel
		const [sessionsResult, statusesResult] = await Promise.all([
			client.session.list({ query: { directory } }),
			client.session.status({ query: { directory } }),
		])

		const sessions = extractData<Session[]>(sessionsResult, 'list sessions')
		const statuses = extractData<Record<string, SessionStatus>>(statusesResult, 'get session statuses')

		// Transform each session with its status
		const internalSessions = sessions.map((session) => transformSession(session, statuses[session.id]))

		// Sort by updatedAt descending (most recent first)
		return internalSessions.sort((a, b) => b.updatedAt - a.updatedAt)
	}

	async function getSession(id: string): Promise<InternalSession> {
		// Fetch session, status, and messages in parallel for metrics
		const [sessionResult, statusesResult, messagesResult] = await Promise.all([
			client.session.get({ path: { id }, query: { directory } }),
			client.session.status({ query: { directory } }),
			client.session.messages({ path: { id }, query: { directory } }),
		])

		const session = extractData<Session>(sessionResult, 'get session')
		const statuses = extractData<Record<string, SessionStatus>>(statusesResult, 'get session statuses')
		const messages = extractData<Array<{ info: Message; parts: Part[] }>>(messagesResult, 'get session messages')

		// Aggregate metrics from messages
		const metrics: SessionMetrics = aggregateSessionMetrics(messages)

		// Transform session with status and metrics
		return transformSession(session, statuses[session.id], metrics)
	}

	async function createSession(params: { title?: string; parentId?: string }): Promise<InternalSession> {
		const result = await client.session.create({
			body: {
				title: params.title,
				parentID: params.parentId,
			},
			query: { directory },
		})

		const session = extractData<Session>(result, 'create session')
		return transformSession(session)
	}

	async function continueSession(id: string, message: string, options?: ContinueSessionOptions): Promise<void> {
		const body: {
			parts: Array<{ type: 'text'; text: string }>
			agent?: string
			model?: { providerID: string; modelID: string }
		} = {
			parts: [{ type: 'text', text: message }],
		}

		if (options?.agent) {
			body.agent = options.agent
		}

		if (options?.model) {
			body.model = {
				providerID: options.model.providerId,
				modelID: options.model.modelId,
			}
		}

		const result = await client.session.promptAsync({
			path: { id },
			body,
			query: { directory },
		})

		// promptAsync returns void on success, check for errors
		if (result.error) {
			throw new OpencodeError(
				`Failed to continue session: ${String(result.error)}`,
				'continue session',
				result.error,
			)
		}
	}

	async function abortSession(id: string): Promise<void> {
		const result = await client.session.abort({
			path: { id },
			query: { directory },
		})

		extractData<boolean>(result, 'abort session')
	}

	async function deleteSession(id: string): Promise<void> {
		const result = await client.session.delete({
			path: { id },
			query: { directory },
		})

		extractData<boolean>(result, 'delete session')
	}

	async function forkSession(id: string, messageId?: string): Promise<InternalSession> {
		const result = await client.session.fork({
			path: { id },
			body: messageId ? { messageID: messageId } : {},
			query: { directory },
		})

		const session = extractData<Session>(result, 'fork session')
		return transformSession(session)
	}

	async function shareSession(id: string): Promise<InternalSession> {
		const result = await client.session.share({
			path: { id },
			query: { directory },
		})

		const session = extractData<Session>(result, 'share session')
		return transformSession(session)
	}

	async function unshareSession(id: string): Promise<InternalSession> {
		const result = await client.session.unshare({
			path: { id },
			query: { directory },
		})

		const session = extractData<Session>(result, 'unshare session')
		return transformSession(session)
	}

	async function getSessionDiff(id: string, messageId?: string): Promise<FileDiff[]> {
		const result = await client.session.diff({
			path: { id },
			query: {
				directory,
				messageID: messageId,
			},
		})

		return extractData<FileDiff[]>(result, 'get session diff')
	}

	async function revertSession(id: string, messageId: string, partId?: string): Promise<InternalSession> {
		const result = await client.session.revert({
			path: { id },
			body: {
				messageID: messageId,
				partID: partId,
			},
			query: { directory },
		})

		const session = extractData<Session>(result, 'revert session')
		return transformSession(session)
	}

	async function unrevertSession(id: string): Promise<InternalSession> {
		const result = await client.session.unrevert({
			path: { id },
			query: { directory },
		})

		const session = extractData<Session>(result, 'unrevert session')
		return transformSession(session)
	}

	// =========================================================================
	// Conversation Methods
	// =========================================================================

	async function getMessages(sessionId: string): Promise<InternalMessage[]> {
		const result = await client.session.messages({
			path: { id: sessionId },
			query: { directory },
		})

		const messages = extractData<Array<{ info: Message; parts: Part[] }>>(result, 'get messages')

		return transformMessages(messages)
	}

	// =========================================================================
	// Permission Methods
	// =========================================================================

	async function respondToPermission(
		sessionId: string,
		permissionId: string,
		response: PermissionResponse,
	): Promise<void> {
		const result = await client.postSessionIdPermissionsPermissionId({
			path: {
				id: sessionId,
				permissionID: permissionId,
			},
			body: { response },
			query: { directory },
		})

		extractData<boolean>(result, 'respond to permission')
	}

	// =========================================================================
	// File Methods
	// =========================================================================

	async function findFiles(query: string): Promise<string[]> {
		const result = await client.find.files({
			query: {
				directory,
				query,
			},
		})

		return extractData<string[]>(result, 'find files')
	}

	async function findText(pattern: string): Promise<TextMatch[]> {
		const result = await client.find.text({
			query: {
				directory,
				pattern,
			},
		})

		type RawTextMatch = {
			path: { text: string }
			lines: { text: string }
			line_number: number
			absolute_offset: number
			submatches: Array<{
				match: { text: string }
				start: number
				end: number
			}>
		}

		const rawMatches = extractData<RawTextMatch[]>(result, 'find text')

		// Transform to simplified TextMatch format
		return rawMatches.map((match) => ({
			path: match.path.text,
			line: match.line_number,
			text: match.lines.text,
		}))
	}

	async function readFile(path: string): Promise<FileContent> {
		const result = await client.file.read({
			query: {
				directory,
				path,
			},
		})

		type RawFileContent = {
			type: 'text' | 'binary'
			content: string
			diff?: string
			patch?: unknown
			encoding?: 'base64'
			mimeType?: string
		}

		const content = extractData<RawFileContent>(result, 'read file')

		return {
			type: content.type,
			content: content.content,
		}
	}

	// =========================================================================
	// System Methods
	// =========================================================================

	async function getConfig(): Promise<unknown> {
		const result = await client.config.get({
			query: { directory },
		})

		return extractData<unknown>(result, 'get config')
	}

	async function listProviders(): Promise<ProviderListResult> {
		const result = await client.provider.list({
			query: { directory },
		})

		return extractData<ProviderListResult>(result, 'list providers')
	}

	async function listAgents(): Promise<Agent[]> {
		const result = await client.app.agents({
			query: { directory },
		})

		return extractData<Agent[]>(result, 'list agents')
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	function subscribe(handler: (event: InternalEvent) => void): { unsubscribe: () => void } {
		return eventAdapter.subscribe(handler)
	}

	// =========================================================================
	// Cleanup
	// =========================================================================

	function dispose(): void {
		eventAdapter.dispose()
	}

	// =========================================================================
	// Return Adapter
	// =========================================================================

	return {
		// Session methods
		listSessions,
		getSession,
		createSession,
		continueSession,
		abortSession,
		deleteSession,
		forkSession,
		shareSession,
		unshareSession,
		getSessionDiff,
		revertSession,
		unrevertSession,

		// Conversation methods
		getMessages,

		// Permission methods
		respondToPermission,

		// File methods
		findFiles,
		findText,
		readFile,

		// System methods
		getConfig,
		listProviders,
		listAgents,

		// Event subscription
		subscribe,

		// Cleanup
		dispose,
	}
}
