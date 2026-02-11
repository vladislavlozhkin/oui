/**
 * Event Adapter for mapping OpenCode SDK SSE events to internal UI events.
 *
 * The OpenCode SDK emits 31+ event types via SSE. The UI only cares about 9 of them.
 * This adapter subscribes to the SDK event stream and maps relevant events to
 * internal event types that the UI components consume.
 */

import type {
	Event,
	EventMessagePartUpdated,
	EventMessageUpdated,
	EventPermissionReplied,
	EventPermissionUpdated,
	EventSessionCreated,
	EventSessionDeleted,
	EventSessionStatus,
	EventSessionUpdated,
	Message,
	OpencodeClient,
} from '@opencode-ai/sdk'
import { transformPart, transformPermission, transformSessionStatus } from './transformers'
import type { InternalEvent, InternalMessage, MessageRole, PermissionResponse } from './types'

/** Event prefixes to ignore (not relevant for UI) */
const IGNORED_PREFIXES = [
	'lsp.',
	'vcs.',
	'file.watcher.',
	'tui.',
	'pty.',
	'installation.',
	'server.instance.',
	'todo.',
	'command.',
]

/** Specific event types to ignore */
const IGNORED_TYPES = new Set([
	'session.idle',
	'session.compacted',
	'session.diff',
	'session.error',
	'file.edited',
	'message.removed',
	'message.part.removed',
])

function shouldIgnoreEvent(type: string): boolean {
	return IGNORED_TYPES.has(type) || IGNORED_PREFIXES.some((p) => type.startsWith(p))
}

type EventHandler = (event: InternalEvent) => void

interface Subscription {
	unsubscribe: () => void
}

interface EventAdapter {
	/** Subscribe to internal events */
	subscribe: (handler: EventHandler) => Subscription
	/** Dispose the adapter and close the SSE connection */
	dispose: () => void
}

/**
 * Create an event adapter that maps SDK SSE events to internal UI events.
 *
 * @param client - The OpenCode SDK client instance
 * @param directory - The project directory for event filtering
 * @returns Event adapter with subscribe and dispose methods
 */
export function createEventAdapter(client: OpencodeClient, directory: string): EventAdapter {
	const handlers = new Set<EventHandler>()
	let abortController: AbortController | null = null
	let isRunning = false

	function mapEvent(sdkEvent: Event): InternalEvent | null {
		const receivedAt = Date.now()
		if (shouldIgnoreEvent(sdkEvent.type)) return null

		switch (sdkEvent.type) {
			case 'session.created': {
				const e = sdkEvent as EventSessionCreated
				return { type: 'session.created', directory, receivedAt, sessionId: e.properties.info.id }
			}
			case 'session.updated': {
				const e = sdkEvent as EventSessionUpdated
				return { type: 'session.updated', directory, receivedAt, sessionId: e.properties.info.id }
			}
			case 'session.deleted': {
				const e = sdkEvent as EventSessionDeleted
				return { type: 'session.deleted', directory, receivedAt, sessionId: e.properties.info.id }
			}
			case 'session.status': {
				const e = sdkEvent as EventSessionStatus
				return {
					type: 'session.status',
					directory,
					receivedAt,
					sessionId: e.properties.sessionID,
					status: transformSessionStatus(e.properties.status),
				}
			}
			case 'message.updated': {
				const e = sdkEvent as EventMessageUpdated
				return {
					type: 'message.updated',
					directory,
					receivedAt,
					sessionId: e.properties.info.sessionID,
					messageId: e.properties.info.id,
					role: e.properties.info.role as MessageRole,
				}
			}
			case 'message.part.updated': {
				const e = sdkEvent as EventMessagePartUpdated
				const { part, delta } = e.properties
				// Minimal Message for transformer
				const msg: Message = {
					id: part.messageID,
					sessionID: part.sessionID,
					role: 'assistant',
					time: { created: Date.now() },
					parentID: '',
					modelID: '',
					providerID: '',
					mode: '',
					path: { cwd: '', root: '' },
					cost: 0,
					tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
				}
				const transformed = transformPart(part, msg)
				if (!transformed) return null
				return {
					type: 'message.part.updated',
					directory,
					receivedAt,
					sessionId: part.sessionID,
					messageId: part.messageID,
					partId: part.id,
					message: transformed as InternalMessage,
					delta,
				}
			}
			case 'permission.updated': {
				const e = sdkEvent as EventPermissionUpdated
				return {
					type: 'permission.updated',
					directory,
					receivedAt,
					permission: transformPermission(e.properties),
				}
			}
			case 'permission.replied': {
				const e = sdkEvent as EventPermissionReplied
				return {
					type: 'permission.replied',
					directory,
					receivedAt,
					sessionId: e.properties.sessionID,
					permissionId: e.properties.permissionID,
					response: e.properties.response as PermissionResponse,
				}
			}
			case 'server.connected':
				return { type: 'server.connected', directory, receivedAt }
			default:
				return null
		}
	}

	async function startStream(): Promise<void> {
		if (isRunning) return
		isRunning = true
		abortController = new AbortController()

		try {
			const result = await client.event.subscribe({ query: { directory } })
			for await (const sdkEvent of result.stream) {
				if (!isRunning || abortController?.signal.aborted) break
				const event = mapEvent(sdkEvent)
				if (event) {
					for (const handler of handlers) {
						try {
							handler(event)
						} catch (err) {
							console.error('[EventAdapter] Handler error:', err)
						}
					}
				}
			}
		} catch (err) {
			if (isRunning && !abortController?.signal.aborted) {
				console.error('[EventAdapter] Stream error:', err)
			}
		} finally {
			isRunning = false
		}
	}

	function subscribe(handler: EventHandler): Subscription {
		handlers.add(handler)
		if (handlers.size === 1) startStream()
		return { unsubscribe: () => handlers.delete(handler) }
	}

	function dispose(): void {
		isRunning = false
		handlers.clear()
		if (abortController) {
			abortController.abort()
			abortController = null
		}
	}

	return { subscribe, dispose }
}
