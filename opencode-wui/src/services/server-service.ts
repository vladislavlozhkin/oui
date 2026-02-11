import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logging'

export interface ServerInfo {
	port: number
	pid: number
	base_url: string // e.g., "http://127.0.0.1:4096"
	is_running: boolean
}

class ServerService {
	private static instance: ServerService

	static getInstance(): ServerService {
		if (!ServerService.instance) {
			ServerService.instance = new ServerService()
		}
		return ServerService.instance
	}

	async startServer(isDev: boolean = false, configContent?: string): Promise<ServerInfo> {
		try {
			return await invoke<ServerInfo>('start_server', { isDev, configContent })
		} catch (error) {
			throw new Error(`Failed to start server: ${error}`)
		}
	}

	async stopServer(): Promise<void> {
		try {
			await invoke('stop_server')
		} catch (error) {
			throw new Error(`Failed to stop server: ${error}`)
		}
	}

	async getServerInfo(isDev: boolean = import.meta.env.DEV): Promise<ServerInfo | null> {
		try {
			return await invoke<ServerInfo | null>('get_server_info', { isDev })
		} catch (error) {
			logger.error('Failed to get server info:', error)
			return null
		}
	}

	async isServerRunning(): Promise<boolean> {
		try {
			return await invoke<boolean>('is_server_running')
		} catch (error) {
			logger.error('Failed to check server status:', error)
			return false
		}
	}

	/**
	 * Get the base URL for the opencode server.
	 * Returns the URL from managed server info, or external URL if configured.
	 */
	async getBaseUrl(): Promise<string | null> {
		// Check for external server URL first
		const externalUrl = (window as unknown as { __OPENCODE_SERVER_URL?: string }).__OPENCODE_SERVER_URL
		if (externalUrl) {
			return externalUrl
		}

		// Get managed server info
		const info = await this.getServerInfo()
		return info?.base_url ?? null
	}

	/**
	 * Connect to an externally managed opencode server.
	 */
	async connectToExternal(url: string): Promise<void> {
		// Validate URL format
		try {
			new URL(url)
		} catch {
			throw new Error(`Invalid URL format: ${url}`)
		}
		// Store the custom URL temporarily (not in Tauri store)
		;(window as unknown as { __OPENCODE_SERVER_URL?: string }).__OPENCODE_SERVER_URL = url
		;(window as unknown as { __OPENCODE_SERVER_TYPE?: string }).__OPENCODE_SERVER_TYPE = 'external'
	}

	async switchToManagedServer(): Promise<void> {
		// Clear the custom URL to switch back to managed server
		delete (window as unknown as { __OPENCODE_SERVER_URL?: string }).__OPENCODE_SERVER_URL
		delete (window as unknown as { __OPENCODE_SERVER_TYPE?: string }).__OPENCODE_SERVER_TYPE
	}

	getServerType(): 'managed' | 'external' {
		return ((window as unknown as { __OPENCODE_SERVER_TYPE?: string }).__OPENCODE_SERVER_TYPE || 'managed') as
			| 'managed'
			| 'external'
	}

	/**
	 * Get default headers for opencode API requests.
	 * Includes x-opencode-directory header if OPENCODE_DIR is set.
	 */
	getDefaultHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		}

		// Add opencode directory header if available
		const openCodeDir = (window as unknown as { __OPENCODE_DIR?: string }).__OPENCODE_DIR
		if (openCodeDir) {
			headers['x-opencode-directory'] = openCodeDir
		}

		return headers
	}

	/**
	 * Set the opencode working directory for API requests.
	 */
	setWorkingDirectory(dir: string): void {
		;(window as unknown as { __OPENCODE_DIR?: string }).__OPENCODE_DIR = dir
	}

	/**
	 * Check server health by calling /global/health endpoint.
	 */
	async checkHealth(): Promise<{ healthy: boolean; version?: string }> {
		const baseUrl = await this.getBaseUrl()
		if (!baseUrl) {
			return { healthy: false }
		}

		try {
			const response = await fetch(`${baseUrl}/global/health`, {
				headers: this.getDefaultHeaders(),
			})
			if (response.ok) {
				const data = await response.json()
				return { healthy: data.healthy ?? true, version: data.version }
			}
			return { healthy: false }
		} catch (error) {
			logger.error('Health check failed:', error)
			return { healthy: false }
		}
	}
}

export const serverService = ServerService.getInstance()

// Re-export for backwards compatibility during migration
export { ServerService as DaemonService }
export type { ServerInfo as DaemonInfo }
