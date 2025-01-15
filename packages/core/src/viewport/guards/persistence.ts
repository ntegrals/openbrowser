import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BaseGuard } from '../guard-base.js';

/**
 * Handles saving and restoring browser storage state (cookies, localStorage).
 * Persists state to a file so it can be restored across sessions.
 */
export class PersistenceGuard extends BaseGuard {
	readonly name = 'storage-state';
	readonly priority = 600;

	private readonly storagePath: string;

	constructor(storagePath: string) {
		super();
		this.storagePath = storagePath;
	}

	protected async setup(): Promise<void> {
		// Try to restore storage state from file if it exists
		try {
			const data = await readFile(this.storagePath, 'utf-8');
			const storageState = JSON.parse(data) as {
				cookies?: Array<{
					name: string;
					value: string;
					domain: string;
					path: string;
					expires?: number;
					httpOnly?: boolean;
					secure?: boolean;
					sameSite?: 'Strict' | 'Lax' | 'None';
				}>;
			};
			if (storageState.cookies) {
				await this.ctx.context.addCookies(storageState.cookies);
			}
		} catch {
			// File doesn't exist or is invalid; start fresh
		}
	}

	/**
	 * Saves the current context storage state to the configured file path.
	 */
	async save(): Promise<void> {
		const storageState = await this.ctx.context.storageState();
		await mkdir(dirname(this.storagePath), { recursive: true });
		await writeFile(this.storagePath, JSON.stringify(storageState, null, 2), 'utf-8');
	}
}
