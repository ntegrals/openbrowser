import { z } from 'zod';

// ── Individual action schemas ──

export const TapCommandSchema = z.object({
	action: z.literal('tap'),
	index: z.number().describe('Element index to click'),
	clickCount: z.number().optional().default(1).describe('Number of clicks'),
	coordinateX: z.number().optional().describe('X coordinate for coordinate-based clicking'),
	coordinateY: z.number().optional().describe('Y coordinate for coordinate-based clicking'),
});

export const TypeTextCommandSchema = z.object({
	action: z.literal('type_text'),
	index: z.number().describe('Element index to type into'),
	text: z.string().describe('Text to input'),
	clearFirst: z.boolean().optional().default(true).describe('Clear existing text first'),
});

export const NavigateCommandSchema = z.object({
	action: z.literal('navigate'),
	url: z.string().describe('URL to navigate to'),
});

export const BackCommandSchema = z.object({
	action: z.literal('back'),
});

export const ScrollCommandSchema = z.object({
	action: z.literal('scroll'),
	direction: z.enum(['up', 'down']).describe('Scroll direction'),
	amount: z.number().optional().describe('Scroll amount in pixels or pages'),
	index: z.number().optional().describe('Element index to scroll within'),
	pages: z.number().optional().describe('Number of pages to scroll (fractional allowed)'),
});

export const PressKeysCommandSchema = z.object({
	action: z.literal('press_keys'),
	keys: z.string().describe('Keys to send (e.g., "Enter", "Escape", "Control+a")'),
});

export const ExtractCommandSchema = z.object({
	action: z.literal('extract'),
	goal: z.string().describe('What information to extract from the page'),
	outputSchema: z.record(z.unknown()).optional().describe('Optional JSON schema for structured output'),
});

export const FinishCommandSchema = z.object({
	action: z.literal('finish'),
	text: z.string().describe('Final result text'),
	success: z.boolean().optional().default(true),
});

export const FocusTabCommandSchema = z.object({
	action: z.literal('focus_tab'),
	tabIndex: z.number().describe('Tab index to switch to'),
});

export const NewTabCommandSchema = z.object({
	action: z.literal('new_tab'),
	url: z.string().describe('URL to open in new tab'),
});

export const CloseTabCommandSchema = z.object({
	action: z.literal('close_tab'),
	tabIndex: z.number().optional().describe('Tab index to close (current if omitted)'),
});

export const WebSearchCommandSchema = z.object({
	action: z.literal('web_search'),
	query: z.string().describe('Search query'),
});

export const UploadCommandSchema = z.object({
	action: z.literal('upload'),
	index: z.number().describe('File input element index'),
	filePaths: z.array(z.string()).describe('File paths to upload'),
});

export const SelectCommandSchema = z.object({
	action: z.literal('select'),
	index: z.number().describe('Select element index'),
	value: z.string().describe('Option value to select'),
});

export const CaptureCommandSchema = z.object({
	action: z.literal('capture'),
	fullPage: z.boolean().optional().default(false),
});

export const ReadPageCommandSchema = z.object({
	action: z.literal('read_page'),
});

export const WaitCommandSchema = z.object({
	action: z.literal('wait'),
	seconds: z.number().optional().default(3).describe('Seconds to wait'),
});

// ── New action schemas ──

export const ScrollToCommandSchema = z.object({
	action: z.literal('scroll_to'),
	text: z.string().describe('Text to scroll to on the page'),
});

export const FindCommandSchema = z.object({
	action: z.literal('find'),
	query: z.string().describe('Description of elements to find (e.g., "all submit buttons")'),
});

export const SearchCommandSchema = z.object({
	action: z.literal('search'),
	query: z.string().describe('Search query'),
	engine: z.enum(['google', 'duckduckgo', 'bing']).optional().default('google'),
});

export const ListOptionsCommandSchema = z.object({
	action: z.literal('list_options'),
	index: z.number().describe('Select element index'),
});

export const PickOptionCommandSchema = z.object({
	action: z.literal('pick_option'),
	index: z.number().describe('Select element index'),
	optionText: z.string().describe('Text of the option to select'),
});

export const ExtractStructuredCommandSchema = z.object({
	action: z.literal('extract_structured'),
	goal: z.string().describe('Description of what data to extract from the page'),
	outputSchema: z
		.record(z.unknown())
		.describe(
			'JSON Schema describing the structure of the expected output. The LLM will return data conforming to this schema.',
		),
	maxContentLength: z
		.number()
		.optional()
		.default(8000)
		.describe('Maximum number of characters of page content to send to the LLM'),
});

// ── Discriminated union of all actions ──

export const CommandSchema = z.discriminatedUnion('action', [
	TapCommandSchema,
	TypeTextCommandSchema,
	NavigateCommandSchema,
	BackCommandSchema,
	ScrollCommandSchema,
	PressKeysCommandSchema,
	ExtractCommandSchema,
	FinishCommandSchema,
	FocusTabCommandSchema,
	NewTabCommandSchema,
	CloseTabCommandSchema,
	WebSearchCommandSchema,
	UploadCommandSchema,
	SelectCommandSchema,
	CaptureCommandSchema,
	ReadPageCommandSchema,
	WaitCommandSchema,
	ScrollToCommandSchema,
	FindCommandSchema,
	SearchCommandSchema,
	ListOptionsCommandSchema,
	PickOptionCommandSchema,
	ExtractStructuredCommandSchema,
]);

export type Command = z.infer<typeof CommandSchema>;

export type CommandName = Command['action'];

// ── Action result ──

export interface CommandResult {
	success: boolean;
	extractedContent?: string;
	error?: string;
	isDone?: boolean;
	includeInMemory?: boolean;
}

// ── Browser error categories ──

export type ViewportErrorCategory =
	| 'navigation'
	| 'element_not_found'
	| 'element_stale'
	| 'element_not_interactable'
	| 'timeout'
	| 'permission'
	| 'network'
	| 'crash'
	| 'unknown';

export interface InterpretedViewportError {
	category: ViewportErrorCategory;
	message: string;
	suggestion: string;
	isRetryable: boolean;
}

// ── Custom action definition ──

export interface CustomCommandSpec {
	name: string;
	description: string;
	schema: z.ZodObject<any>;
	handler: (params: Record<string, unknown>, context: ExecutionContext) => Promise<CommandResult>;
	terminatesSequence?: boolean;
}

export interface ExecutionContext {
	page: import('playwright').Page;
	cdpSession: import('playwright').CDPSession;
	domService: import('../page/page-analyzer.js').PageAnalyzer;
	browserSession: import('../viewport/viewport.js').Viewport;
	extractionLlm?: import('../model/interface.js').LanguageModel;
	fileSystem?: import('../sandbox/file-access.js').FileAccess;
	maskedValues?: Record<string, string>;
}
