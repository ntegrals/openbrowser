import { z } from 'zod';

export const ViewportConfigSchema = z.object({
  headless: z.boolean().default(true),
  windowWidth: z.number().default(1280),
  windowHeight: z.number().default(800),
  navigationTimeout: z.number().default(30000),
  commandTimeout: z.number().default(10000),
  extraArgs: z.array(z.string()).default([]),
  userDataDir: z.string().optional(),
  executablePath: z.string().optional(),
  disableSecurity: z.boolean().default(false),
});

export type ViewportConfig = z.infer<typeof ViewportConfigSchema>;

export const AgentConfigSchema = z.object({
  stepLimit: z.number().default(100),
  failureThreshold: z.number().default(5),
  enableScreenshots: z.boolean().default(true),
  contextWindowSize: z.number().default(128000),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const GlobalConfigSchema = z.object({
  browser: ViewportConfigSchema.default({}),
  agent: AgentConfigSchema.default({}),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
