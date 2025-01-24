export interface CLIRequest {
	id: string;
	command: string;
	args: Record<string, unknown>;
}

export interface CLIResponse {
	id: string;
	success: boolean;
	data?: unknown;
	error?: string;
}

export function serializeRequest(req: CLIRequest): string {
	return JSON.stringify(req) + '\n';
}

export function parseRequest(data: string): CLIRequest | null {
	try {
		return JSON.parse(data.trim()) as CLIRequest;
	} catch {
		return null;
	}
}

export function serializeResponse(res: CLIResponse): string {
	return JSON.stringify(res) + '\n';
}

export function parseResponse(data: string): CLIResponse | null {
	try {
		return JSON.parse(data.trim()) as CLIResponse;
	} catch {
		return null;
	}
}
