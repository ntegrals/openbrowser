/**
 * Experimental MCP (Model Context Protocol) server types.
 * @experimental
 */

export interface MCPServerOptions {
	port?: number;
	host?: string;
	capabilities?: MCPCapability[];
}

export type MCPCapability = 'browse' | 'extract' | 'screenshot' | 'interact';

export interface MCPRequest {
	method: string;
	params: Record<string, unknown>;
}

export interface MCPResponse {
	result?: unknown;
	error?: { code: number; message: string };
}
