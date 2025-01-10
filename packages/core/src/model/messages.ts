export interface TextContent {
	type: 'text';
	text: string;
}

export interface ImageContent {
	type: 'image';
	source:
		| { type: 'base64'; mediaType: string; data: string }
		| { type: 'url'; url: string };
}

export type ContentPart = TextContent | ImageContent;

export interface SystemMessage {
	role: 'system';
	content: string;
}

export interface UserMessage {
	role: 'user';
	content: string | ContentPart[];
}

export interface AssistantMessage {
	role: 'assistant';
	content: string | ContentPart[];
	toolCalls?: ToolCall[];
}

export interface ToolResultMessage {
	role: 'tool';
	toolCallId: string;
	content: string;
}

export interface ToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

// ── Helpers ──

export function systemMessage(content: string): SystemMessage {
	return { role: 'system', content };
}

export function userMessage(content: string | ContentPart[]): UserMessage {
	return { role: 'user', content };
}

export function assistantMessage(
	content: string | ContentPart[],
	toolCalls?: ToolCall[],
): AssistantMessage {
	return { role: 'assistant', content, toolCalls };
}

export function toolResultMessage(toolCallId: string, content: string): ToolResultMessage {
	return { role: 'tool', toolCallId, content };
}

export function textContent(text: string): TextContent {
	return { type: 'text', text };
}

export function imageContent(base64: string, mediaType = 'image/png'): ImageContent {
	return {
		type: 'image',
		source: { type: 'base64', mediaType, data: base64 },
	};
}
