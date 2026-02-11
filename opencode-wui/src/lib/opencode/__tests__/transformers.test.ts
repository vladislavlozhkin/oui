/**
 * Tests for OpenCode transformers.
 *
 * These tests verify the transformation from OpenCode SDK types
 * to internal UI types.
 */

import { describe, expect, test } from 'bun:test'
import type {
	AssistantMessage,
	Part,
	Permission,
	ReasoningPart,
	Session,
	SessionStatus,
	StepFinishPart,
	TextPart,
	ToolPart,
	UserMessage,
} from '@opencode-ai/sdk'

import {
	aggregateSessionMetrics,
	getSessionStatusText,
	transformMessages,
	transformPart,
	transformPermission,
	transformSession,
	transformSessionStatus,
} from '../transformers'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'session-123',
		projectID: 'project-456',
		directory: '/home/user/project',
		title: 'Test Session',
		version: '1.0.0',
		time: {
			created: 1707667200000, // 2024-02-11T12:00:00.000Z
			updated: 1707670800000, // 2024-02-11T13:00:00.000Z
		},
		...overrides,
	}
}

function createMockUserMessage(overrides: Partial<UserMessage> = {}): UserMessage {
	return {
		id: 'user-msg-1',
		sessionID: 'session-123',
		role: 'user',
		time: { created: 1707667200000 },
		agent: 'code',
		model: {
			providerID: 'anthropic',
			modelID: 'claude-sonnet-4',
		},
		...overrides,
	}
}

function createMockAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		id: 'assistant-msg-1',
		sessionID: 'session-123',
		role: 'assistant',
		time: { created: 1707667200000 },
		parentID: 'user-msg-1',
		modelID: 'claude-sonnet-4',
		providerID: 'anthropic',
		mode: 'agentic',
		path: {
			cwd: '/home/user/project',
			root: '/home/user/project',
		},
		cost: 0.05,
		tokens: {
			input: 1000,
			output: 500,
			reasoning: 100,
			cache: { read: 200, write: 50 },
		},
		...overrides,
	}
}

function createMockTextPart(overrides: Partial<TextPart> = {}): TextPart {
	return {
		id: 'part-text-1',
		sessionID: 'session-123',
		messageID: 'assistant-msg-1',
		type: 'text',
		text: 'Hello, this is a test response.',
		...overrides,
	}
}

function createMockReasoningPart(overrides: Partial<ReasoningPart> = {}): ReasoningPart {
	return {
		id: 'part-reasoning-1',
		sessionID: 'session-123',
		messageID: 'assistant-msg-1',
		type: 'reasoning',
		text: 'I need to think about this...',
		time: {
			start: 1707667200000,
			end: 1707667205000,
		},
		...overrides,
	}
}

function createMockToolPart(overrides: Partial<ToolPart> = {}): ToolPart {
	return {
		id: 'part-tool-1',
		sessionID: 'session-123',
		messageID: 'assistant-msg-1',
		type: 'tool',
		callID: 'call-123',
		tool: 'bash',
		state: {
			status: 'pending',
			input: { command: 'ls -la' },
			raw: '{"command": "ls -la"}',
		},
		...overrides,
	}
}

function createMockPermission(overrides: Partial<Permission> = {}): Permission {
	return {
		id: 'perm-123',
		sessionID: 'session-123',
		messageID: 'assistant-msg-1',
		callID: 'call-123',
		type: 'bash',
		title: 'Run bash: ls -la',
		pattern: 'ls *',
		metadata: { command: 'ls -la' },
		time: { created: 1707667200000 },
		...overrides,
	}
}

// =============================================================================
// Session Transformer Tests
// =============================================================================

describe('transformSession', () => {
	test('transforms basic session with idle status', () => {
		const session = createMockSession()
		const status: SessionStatus = { type: 'idle' }

		const result = transformSession(session, status)

		expect(result.id).toBe('session-123')
		expect(result.projectId).toBe('project-456')
		expect(result.directory).toBe('/home/user/project')
		expect(result.title).toBe('Test Session')
		expect(result.version).toBe('1.0.0')
		expect(result.createdAt).toBe(1707667200000)
		expect(result.updatedAt).toBe(1707670800000)
		expect(result.status.type).toBe('idle')
		expect(result.isActive).toBe(false)
		expect(result.hasPendingPermissions).toBe(false)
	})

	test('transforms session with busy status', () => {
		const session = createMockSession()
		const status: SessionStatus = { type: 'busy' }

		const result = transformSession(session, status)

		expect(result.status.type).toBe('busy')
		expect(result.isActive).toBe(true)
	})

	test('transforms session with retry status', () => {
		const session = createMockSession()
		const status: SessionStatus = {
			type: 'retry',
			attempt: 3,
			message: 'Rate limit exceeded',
			next: 1707667260000,
		}

		const result = transformSession(session, status)

		expect(result.status.type).toBe('retry')
		expect(result.status.attempt).toBe(3)
		expect(result.status.message).toBe('Rate limit exceeded')
		expect(result.status.nextRetry).toBe(1707667260000)
		expect(result.isActive).toBe(false)
	})

	test('transforms session with summary', () => {
		const session = createMockSession({
			summary: {
				additions: 100,
				deletions: 50,
				files: 5,
				diffs: [
					{ file: 'src/index.ts', before: '', after: '', additions: 50, deletions: 25 },
					{ file: 'src/utils.ts', before: '', after: '', additions: 50, deletions: 25 },
				],
			},
		})

		const result = transformSession(session)

		expect(result.summary).toBeDefined()
		expect(result.summary!.additions).toBe(100)
		expect(result.summary!.deletions).toBe(50)
		expect(result.summary!.files).toBe(5)
		expect(result.summary!.diffs).toHaveLength(2)
	})

	test('transforms session with metrics', () => {
		const session = createMockSession()
		const metrics = {
			cost: 0.15,
			tokens: { input: 3000, output: 1500, reasoning: 300 },
			messageCount: 5,
		}

		const result = transformSession(session, undefined, metrics)

		expect(result.totalCost).toBe(0.15)
		expect(result.totalTokens.input).toBe(3000)
		expect(result.totalTokens.output).toBe(1500)
		expect(result.totalTokens.reasoning).toBe(300)
		expect(result.messageCount).toBe(5)
	})

	test('transforms session with pending permissions flag', () => {
		const session = createMockSession()

		const result = transformSession(session, undefined, undefined, true)

		expect(result.hasPendingPermissions).toBe(true)
	})

	test('transforms session with share URL', () => {
		const session = createMockSession({
			share: { url: 'https://share.opencode.ai/abc123' },
		})

		const result = transformSession(session)

		expect(result.shareUrl).toBe('https://share.opencode.ai/abc123')
	})

	test('transforms session with parent ID', () => {
		const session = createMockSession({
			parentID: 'parent-session-789',
		})

		const result = transformSession(session)

		expect(result.parentId).toBe('parent-session-789')
	})

	test('transforms session with compacting timestamp', () => {
		const session = createMockSession({
			time: {
				created: 1707667200000,
				updated: 1707670800000,
				compacting: 1707671400000,
			},
		})

		const result = transformSession(session)

		expect(result.compactingAt).toBe(1707671400000)
	})
})

describe('transformSessionStatus', () => {
	test('returns idle for undefined status', () => {
		const result = transformSessionStatus(undefined)
		expect(result.type).toBe('idle')
	})

	test('transforms idle status', () => {
		const result = transformSessionStatus({ type: 'idle' })
		expect(result.type).toBe('idle')
	})

	test('transforms busy status', () => {
		const result = transformSessionStatus({ type: 'busy' })
		expect(result.type).toBe('busy')
	})

	test('transforms retry status with all fields', () => {
		const result = transformSessionStatus({
			type: 'retry',
			attempt: 2,
			message: 'Connection timeout',
			next: 1707667260000,
		})

		expect(result.type).toBe('retry')
		expect(result.attempt).toBe(2)
		expect(result.message).toBe('Connection timeout')
		expect(result.nextRetry).toBe(1707667260000)
	})
})

describe('getSessionStatusText', () => {
	test("returns 'Idle' for idle status", () => {
		expect(getSessionStatusText({ type: 'idle' })).toBe('Idle')
	})

	test("returns 'Idle' for undefined status", () => {
		expect(getSessionStatusText(undefined)).toBe('Idle')
	})

	test("returns 'Processing...' for busy status", () => {
		expect(getSessionStatusText({ type: 'busy' })).toBe('Processing...')
	})

	test('returns retry message with attempt number', () => {
		expect(
			getSessionStatusText({
				type: 'retry',
				attempt: 3,
				message: 'Error',
				next: 0,
			}),
		).toBe('Retrying (attempt 3)...')
	})
})

// =============================================================================
// Message Transformer Tests
// =============================================================================

describe('transformMessages', () => {
	test('transforms empty messages array', () => {
		const result = transformMessages([])
		expect(result).toEqual([])
	})

	test('transforms user message with text part', () => {
		const userMessage = createMockUserMessage()
		const textPart: TextPart = {
			id: 'part-user-text-1',
			sessionID: 'session-123',
			messageID: 'user-msg-1',
			type: 'text',
			text: 'Please help me fix this bug',
		}

		const result = transformMessages([{ info: userMessage, parts: [textPart] }])

		// Should have user input message + text part
		expect(result).toHaveLength(2)

		// First: synthetic user input message
		expect(result[0].type).toBe('user-input')
		expect(result[0].role).toBe('user')

		// Second: text part
		expect(result[1].type).toBe('text')
		expect((result[1] as any).text).toBe('Please help me fix this bug')
	})

	test('transforms assistant message with text part', () => {
		const assistantMessage = createMockAssistantMessage()
		const textPart = createMockTextPart()

		const result = transformMessages([{ info: assistantMessage, parts: [textPart] }])

		expect(result).toHaveLength(1)
		expect(result[0].type).toBe('text')
		expect(result[0].role).toBe('assistant')
		expect((result[0] as any).text).toBe('Hello, this is a test response.')
	})

	test('transforms multiple parts in order', () => {
		const assistantMessage = createMockAssistantMessage()
		const reasoningPart = createMockReasoningPart()
		const textPart = createMockTextPart({
			id: 'part-text-2',
			time: { start: 1707667210000 },
		})

		const result = transformMessages([{ info: assistantMessage, parts: [reasoningPart, textPart] }])

		expect(result).toHaveLength(2)
		expect(result[0].type).toBe('reasoning')
		expect(result[1].type).toBe('text')
	})

	test('transforms tool part with pending status', () => {
		const assistantMessage = createMockAssistantMessage()
		const toolPart = createMockToolPart()

		const result = transformMessages([{ info: assistantMessage, parts: [toolPart] }])

		expect(result).toHaveLength(1)
		expect(result[0].type).toBe('tool')
		expect((result[0] as any).status).toBe('pending')
		expect((result[0] as any).toolName).toBe('bash')
		expect((result[0] as any).input).toEqual({ command: 'ls -la' })
	})

	test('transforms tool part with running status', () => {
		const assistantMessage = createMockAssistantMessage()
		const toolPart = createMockToolPart({
			state: {
				status: 'running',
				input: { command: 'npm install' },
				title: 'Installing dependencies',
				time: { start: 1707667200000 },
			},
		})

		const result = transformMessages([{ info: assistantMessage, parts: [toolPart] }])

		expect(result).toHaveLength(1)
		expect((result[0] as any).status).toBe('running')
		expect((result[0] as any).title).toBe('Installing dependencies')
		expect((result[0] as any).startTime).toBe(1707667200000)
	})

	test('transforms tool part with completed status', () => {
		const assistantMessage = createMockAssistantMessage()
		const toolPart = createMockToolPart({
			state: {
				status: 'completed',
				input: { command: 'ls -la' },
				output: 'file1.txt\nfile2.txt',
				title: 'Listed files',
				metadata: { exitCode: 0 },
				time: { start: 1707667200000, end: 1707667205000 },
			},
		})

		const result = transformMessages([{ info: assistantMessage, parts: [toolPart] }])

		expect(result).toHaveLength(1)
		expect((result[0] as any).status).toBe('completed')
		expect((result[0] as any).output).toBe('file1.txt\nfile2.txt')
		expect((result[0] as any).endTime).toBe(1707667205000)
	})

	test('transforms tool part with error status', () => {
		const assistantMessage = createMockAssistantMessage()
		const toolPart = createMockToolPart({
			state: {
				status: 'error',
				input: { command: 'rm -rf /' },
				error: 'Permission denied',
				time: { start: 1707667200000, end: 1707667201000 },
			},
		})

		const result = transformMessages([{ info: assistantMessage, parts: [toolPart] }])

		expect(result).toHaveLength(1)
		expect((result[0] as any).status).toBe('error')
		expect((result[0] as any).error).toBe('Permission denied')
	})

	test('transforms reasoning part', () => {
		const assistantMessage = createMockAssistantMessage()
		const reasoningPart = createMockReasoningPart()

		const result = transformMessages([{ info: assistantMessage, parts: [reasoningPart] }])

		expect(result).toHaveLength(1)
		expect(result[0].type).toBe('reasoning')
		expect((result[0] as any).text).toBe('I need to think about this...')
		expect((result[0] as any).startTime).toBe(1707667200000)
		expect((result[0] as any).endTime).toBe(1707667205000)
	})

	test('sorts messages by timestamp', () => {
		const userMessage = createMockUserMessage({
			time: { created: 1707667200000 },
		})
		const assistantMessage = createMockAssistantMessage({
			time: { created: 1707667210000 },
		})

		const userTextPart: TextPart = {
			id: 'user-text',
			sessionID: 'session-123',
			messageID: 'user-msg-1',
			type: 'text',
			text: 'Help me',
		}

		const assistantTextPart = createMockTextPart({
			id: 'assistant-text',
			time: { start: 1707667220000 },
		})

		const result = transformMessages([
			{ info: assistantMessage, parts: [assistantTextPart] },
			{ info: userMessage, parts: [userTextPart] },
		])

		// Should be sorted by timestamp: user input, user text, assistant text
		expect(result[0].timestamp).toBeLessThanOrEqual(result[1].timestamp)
		expect(result[1].timestamp).toBeLessThanOrEqual(result[2].timestamp)
	})
})

describe('transformPart', () => {
	test('returns null for unknown part type', () => {
		const unknownPart = {
			id: 'unknown',
			sessionID: 'session-123',
			messageID: 'msg-1',
			type: 'unknown-type',
		} as unknown as Part

		const result = transformPart(unknownPart, createMockAssistantMessage())
		expect(result).toBeNull()
	})

	test('transforms step-finish part', () => {
		const stepFinishPart: StepFinishPart = {
			id: 'step-finish-1',
			sessionID: 'session-123',
			messageID: 'assistant-msg-1',
			type: 'step-finish',
			reason: 'stop',
			snapshot: 'abc123',
			cost: 0.02,
			tokens: {
				input: 500,
				output: 250,
				reasoning: 50,
				cache: { read: 100, write: 25 },
			},
		}

		const result = transformPart(stepFinishPart, createMockAssistantMessage())

		expect(result).not.toBeNull()
		expect(result!.type).toBe('step-finish')
		expect((result as any).reason).toBe('stop')
		expect((result as any).cost).toBe(0.02)
		expect((result as any).tokens.input).toBe(500)
	})
})

// =============================================================================
// Permission Transformer Tests
// =============================================================================

describe('transformPermission', () => {
	test('transforms basic permission', () => {
		const permission = createMockPermission()

		const result = transformPermission(permission)

		expect(result.id).toBe('perm-123')
		expect(result.sessionId).toBe('session-123')
		expect(result.messageId).toBe('assistant-msg-1')
		expect(result.callId).toBe('call-123')
		expect(result.type).toBe('bash')
		expect(result.title).toBe('Run bash: ls -la')
		expect(result.pattern).toBe('ls *')
		expect(result.metadata).toEqual({ command: 'ls -la' })
		expect(result.createdAt).toBe(1707667200000)
		expect(result.responded).toBe(false)
		expect(result.response).toBeUndefined()
	})

	test('transforms permission without callID', () => {
		const permission = createMockPermission({ callID: undefined })

		const result = transformPermission(permission)

		expect(result.callId).toBeUndefined()
	})

	test('transforms permission with array pattern', () => {
		const permission = createMockPermission({
			pattern: ['git *', 'npm *'],
		})

		const result = transformPermission(permission)

		expect(result.pattern).toEqual(['git *', 'npm *'])
	})
})

// =============================================================================
// Metrics Aggregation Tests
// =============================================================================

describe('aggregateSessionMetrics', () => {
	test('returns zero metrics for empty messages', () => {
		const result = aggregateSessionMetrics([])

		expect(result.cost).toBe(0)
		expect(result.tokens.input).toBe(0)
		expect(result.tokens.output).toBe(0)
		expect(result.tokens.reasoning).toBe(0)
		expect(result.messageCount).toBe(0)
	})

	test('aggregates metrics from single assistant message', () => {
		const assistantMessage = createMockAssistantMessage({
			cost: 0.05,
			tokens: {
				input: 1000,
				output: 500,
				reasoning: 100,
				cache: { read: 200, write: 50 },
			},
		})

		const result = aggregateSessionMetrics([{ info: assistantMessage, parts: [] }])

		expect(result.cost).toBe(0.05)
		expect(result.tokens.input).toBe(1000)
		expect(result.tokens.output).toBe(500)
		expect(result.tokens.reasoning).toBe(100)
		expect(result.messageCount).toBe(1)
	})

	test('aggregates metrics from multiple messages', () => {
		const userMessage = createMockUserMessage()
		const assistantMessage1 = createMockAssistantMessage({
			id: 'assistant-1',
			cost: 0.05,
			tokens: {
				input: 1000,
				output: 500,
				reasoning: 100,
				cache: { read: 200, write: 50 },
			},
		})
		const assistantMessage2 = createMockAssistantMessage({
			id: 'assistant-2',
			cost: 0.1,
			tokens: {
				input: 2000,
				output: 1000,
				reasoning: 200,
				cache: { read: 400, write: 100 },
			},
		})

		const result = aggregateSessionMetrics([
			{ info: userMessage, parts: [] },
			{ info: assistantMessage1, parts: [] },
			{ info: assistantMessage2, parts: [] },
		])

		expect(result.cost).toBeCloseTo(0.15)
		expect(result.tokens.input).toBe(3000)
		expect(result.tokens.output).toBe(1500)
		expect(result.tokens.reasoning).toBe(300)
		expect(result.messageCount).toBe(3)
	})

	test('only counts cost/tokens from assistant messages', () => {
		const userMessage1 = createMockUserMessage({ id: 'user-1' })
		const userMessage2 = createMockUserMessage({ id: 'user-2' })
		const assistantMessage = createMockAssistantMessage({
			cost: 0.05,
			tokens: {
				input: 1000,
				output: 500,
				reasoning: 100,
				cache: { read: 200, write: 50 },
			},
		})

		const result = aggregateSessionMetrics([
			{ info: userMessage1, parts: [] },
			{ info: assistantMessage, parts: [] },
			{ info: userMessage2, parts: [] },
		])

		// Cost and tokens only from assistant message
		expect(result.cost).toBe(0.05)
		expect(result.tokens.input).toBe(1000)
		// But message count includes all messages
		expect(result.messageCount).toBe(3)
	})
})
