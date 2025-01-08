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
	windowWidth: z.number().default(1280),
	windowHeight: z.number().default(1100),
	proxy: ProxyConfigSchema.optional(),
	minWaitPageLoadMs: z.number().default(500),
	waitForNetworkIdleMs: z.number().default(1000),
	maxWaitPageLoadMs: z.number().default(5000),
	cookieFile: z.string().optional(),
	minimumWaitBetweenActions: z.number().default(1000),
	maxErrorLength: z.number().default(400),
	commandsPerStep: z.number().default(10),
	browserBinaryPath: z.string().optional(),
	userDataDir: z.string().optional(),
	persistAfterClose: z.boolean().default(false),
	channelName: z.string().optional(),
	deterministicRendering: z.boolean().default(false),
	maxIframes: z.number().default(3),
	downloadsPath: z.string().optional(),
});

export type ViewportConfig = z.infer<typeof ViewportConfigSchema>;

export const AgentConfigSchema = z.object({
	stepLimit: z.number().default(100),
	commandsPerStep: z.number().default(10),
	failureThreshold: z.number().default(5),
	retryDelay: z.number().default(10),
	enableScreenshots: z.boolean().default(true),
	enableScreenshotsForTextExtraction: z.boolean().default(false),
	contextWindowSize: z.number().default(128000),
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
	commandDelayMs: z.number().default(1),
	allowedUrls: z.array(z.string()).optional(),
	blockedUrls: z.array(z.string()).optional(),
	traceOutputPath: z.string().optional(),
	replayOutputPath: z.string().optional(),
	strategyInterval: z.number().default(0),
	plannerModel: z.any().optional(),
	enableStrategy: z.boolean().default(false),
	enableEvaluation: z.boolean().default(false),
	stepTimeout: z.number().default(60000),
	llmTimeout: z.number().default(30000),
	maxElementsInDom: z.number().default(2000),
	coordinateClicking: z.boolean().default(false),
	compactMode: z.boolean().default(false),
});

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
