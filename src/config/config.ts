import { ViewportConfigSchema, GlobalConfigSchema } from './types';
import type { ViewportConfig, GlobalConfig } from './types';

let currentConfig: GlobalConfig = GlobalConfigSchema.parse({});

export function getConfig(): GlobalConfig {
  return currentConfig;
}

export function updateConfig(partial: Partial<GlobalConfig>): GlobalConfig {
  currentConfig = GlobalConfigSchema.parse({ ...currentConfig, ...partial });
  return currentConfig;
}

export function parseViewportConfig(raw: unknown): ViewportConfig {
  return ViewportConfigSchema.parse(raw);
}

export function resetConfig(): void {
  currentConfig = GlobalConfigSchema.parse({});
}
