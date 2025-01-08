import { config as loadDotenv } from 'dotenv';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { type GlobalConfig, GlobalConfigSchema, type ConfigFileContents } from './types.js';
import type { DeepPartial } from '../types.js';
import { createLogger } from '../logging.js';

const logger = createLogger('config');

let _instance: Config | undefined;

export class Config {
	readonly config: GlobalConfig;

	private constructor(overrides: DeepPartial<GlobalConfig> = {}) {
		loadDotenv();

		// Load from config file first, then merge env and overrides
		const fileConfig = Config.loadConfigFile();
		const merged = this.deepMerge(
			this.mergeEnvDefaults({}),
			fileConfig,
			overrides,
		);
		this.config = GlobalConfigSchema.parse(merged);
	}

	static instance(overrides?: DeepPartial<GlobalConfig>): Config {
		if (!_instance) {
			_instance = new Config(overrides);
		}
		return _instance;
	}

	static reset(): void {
		_instance = undefined;
	}

	private mergeEnvDefaults(overrides: DeepPartial<GlobalConfig>): DeepPartial<GlobalConfig> {
		const env = process.env;

		const proxy = env.OPEN_BROWSER_PROXY_SERVER
			? {
					server: env.OPEN_BROWSER_PROXY_SERVER,
					username: env.OPEN_BROWSER_PROXY_USERNAME,
					password: env.OPEN_BROWSER_PROXY_PASSWORD,
				}
			: (env.HTTP_PROXY || env.HTTPS_PROXY)
				? { server: (env.HTTPS_PROXY || env.HTTP_PROXY)! }
				: undefined;

		return {
			browser: {
				headless: env.BROWSER_HEADLESS !== 'false',
				relaxedSecurity: env.BROWSER_DISABLE_SECURITY === 'true',
				browserBinaryPath: env.BROWSER_BINARY_PATH ?? undefined,
				userDataDir: env.BROWSER_USER_DATA_DIR ?? undefined,
				...(proxy ? { proxy } : {}),
				...overrides.browser,
			},
			tracePath: env.OPEN_BROWSER_TRACE_PATH ?? overrides.tracePath,
			recordingPath: env.OPEN_BROWSER_SAVE_RECORDING_PATH ?? overrides.recordingPath,
			...overrides,
		};
	}

	private deepMerge(...objects: DeepPartial<GlobalConfig>[]): DeepPartial<GlobalConfig> {
		const result: Record<string, unknown> = {};

		for (const obj of objects) {
			if (!obj) continue;
			for (const [key, value] of Object.entries(obj)) {
				if (
					value !== null &&
					value !== undefined &&
					typeof value === 'object' &&
					!Array.isArray(value) &&
					typeof result[key] === 'object' &&
					result[key] !== null &&
					!Array.isArray(result[key])
				) {
					result[key] = this.deepMerge(
						result[key] as DeepPartial<GlobalConfig>,
						value as DeepPartial<GlobalConfig>,
					);
				} else if (value !== undefined) {
					result[key] = value;
				}
			}
		}

		return result as DeepPartial<GlobalConfig>;
	}

	get browser() {
		return this.config.browser;
	}

	get agent() {
		return this.config.agent;
	}

	static get configDir(): string {
		const dir = path.join(os.homedir(), '.open-browser');
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	static get tmpDir(): string {
		const dir = path.join(Config.configDir, 'tmp');
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	static get configFilePath(): string {
		return path.join(Config.configDir, 'config.json');
	}

	static loadConfigFile(): DeepPartial<GlobalConfig> {
		try {
			const filePath = Config.configFilePath;
			if (fs.existsSync(filePath)) {
				const raw = fs.readFileSync(filePath, 'utf-8');
				const parsed = JSON.parse(raw) as ConfigFileContents;
				logger.debug(`Loaded config from ${filePath}`);
				return parsed;
			}
		} catch (error) {
			logger.warn(`Failed to load config file: ${error}`);
		}
		return {};
	}

	static saveConfigFile(config: ConfigFileContents): void {
		const filePath = Config.configFilePath;
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
		logger.info(`Config saved to ${filePath}`);
	}

	static isDocker(): boolean {
		try {
			if (fs.existsSync('/.dockerenv')) return true;
			if (fs.existsSync('/proc/1/cgroup')) {
				const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf-8');
				return cgroup.includes('docker') || cgroup.includes('kubepods');
			}
		} catch {
			// Not on Linux, definitely not Docker
		}
		return false;
	}

	static hasDisplay(): boolean {
		if (process.platform === 'win32') return true;
		if (process.platform === 'darwin') return true;
		return !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
	}
}
