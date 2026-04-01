import { z } from 'zod';

export const ProxyConfigSchema = z.object({
	server: z.string(),
	username: z.string().optional(),
	password: z.string().optional(),
	bypass: z.array(z.string()).optional(),
});

export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;

export const ViewportConfigSchema = z.object({
	headless: z.boolean().default(true),
	relaxedSecurity: z.boolean().default(false),
	extraChromiumArgs: z.array(z.string()).default([]),
	windowWidth: z.number().int().min(200).max(7680).default(1280),
	windowHeight: z.number().int().min(200).max(4320).default(1100),
	proxy: ProxyConfigSchema.optional(),
	minWaitPageLoadMs: z.number().int().min(0).max(30000).default(500),
	waitForNetworkIdleMs: z.number().int().min(0).max(30000).default(1000),
	maxWaitPageLoadMs: z.number().int().min(0).max(120000).default(5000),
	cookieFile: z.string().optional(),
	minimumWaitBetweenActions: z.number().int().min(0).max(30000).default(1000),
	maxErrorLength: z.number().int().min(50).max(10000).default(400),
	commandsPerStep: z.number().int().min(1).max(50).default(10),
	browserBinaryPath: z.string().optional(),
	userDataDir: z.string().optional(),
	persistAfterClose: z.boolean().default(false),
	channelName: z.string().optional(),
	deterministicRendering: z.boolean().default(false),
	maxIframes: z.number().int().min(0).max(20).default(3),
	downloadsPath: z.string().optional(),
}).refine(
	(data) => data.minWaitPageLoadMs <= data.maxWaitPageLoadMs,
	{ message: 'minWaitPageLoadMs must be <= maxWaitPageLoadMs' },
);

export type ViewportConfig = z.infer<typeof ViewportConfigSchema>;

export const AgentConfigSchema = z.object({
	stepLimit: z.number().int().min(1).max(1000).default(100),
	commandsPerStep: z.number().int().min(1).max(50).default(10),
	failureThreshold: z.number().int().min(1).max(100).default(5),
	retryDelay: z.number().int().min(0).max(60000).default(10),
	enableScreenshots: z.boolean().default(true),
	enableScreenshotsForTextExtraction: z.boolean().default(false),
	contextWindowSize: z.number().int().min(1000).max(2000000).default(128000),
	inlineCommands: z.boolean().default(true),
	capturedAttributes: z.array(z.string()).default([
		'title',
		'type',
		'name',
		'role',
		'tabindex',
		'aria-label',
		'placeholder',
		'value',
		'alt',
		'aria-expanded',
	]),
	commandDelayMs: z.number().int().min(0).max(10000).default(1),
	allowedUrls: z.array(z.string()).optional(),
	blockedUrls: z.array(z.string()).optional(),
	traceOutputPath: z.string().optional(),
	replayOutputPath: z.string().optional(),
	strategyInterval: z.number().int().min(0).max(100).default(0),
	plannerModel: z.unknown().optional(),
	enableStrategy: z.boolean().default(false),
	enableEvaluation: z.boolean().default(false),
	stepTimeout: z.number().int().min(1000).max(600000).default(60000),
	llmTimeout: z.number().int().min(1000).max(600000).default(30000),
	maxElementsInDom: z.number().int().min(100).max(50000).default(2000),
	coordinateClicking: z.boolean().default(false),
	compactMode: z.boolean().default(false),
}).refine(
	(data) => data.stepTimeout >= data.llmTimeout,
	{ message: 'stepTimeout must be >= llmTimeout' },
);

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const GlobalConfigSchema = z.object({
	browser: ViewportConfigSchema.default({}),
	agent: AgentConfigSchema.default({}),
	tracePath: z.string().default('./traces'),
	recordingPath: z.string().default('./recordings'),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export interface ConfigFileContents {
	browser?: Partial<ViewportConfig>;
	agent?: Partial<AgentConfig>;
	tracePath?: string;
	recordingPath?: string;
}
