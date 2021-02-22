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

export const GlobalConfigSchema = z.object({
  browser: ViewportConfigSchema.default({}),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
