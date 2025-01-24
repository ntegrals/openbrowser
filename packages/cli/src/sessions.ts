import { Viewport, type ViewportOptions } from 'open-browser';
import { nanoid } from 'nanoid';

interface ManagedSession {
	id: string;
	browser: Viewport;
	createdAt: number;
	lastAccessedAt: number;
}

export class SessionManager {
	private sessions = new Map<string, ManagedSession>();

	async create(options?: ViewportOptions): Promise<string> {
		const id = nanoid(8);
		const browser = new Viewport(options);
		await browser.start();

		this.sessions.set(id, {
			id,
			browser,
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
		});

		return id;
	}

	get(id: string): Viewport | undefined {
		const session = this.sessions.get(id);
		if (session) {
			session.lastAccessedAt = Date.now();
			return session.browser;
		}
		return undefined;
	}

	async close(id: string): Promise<boolean> {
		const session = this.sessions.get(id);
		if (!session) return false;

		await session.browser.close();
		this.sessions.delete(id);
		return true;
	}

	async closeAll(): Promise<void> {
		for (const session of this.sessions.values()) {
			await session.browser.close();
		}
		this.sessions.clear();
	}

	list(): Array<{ id: string; createdAt: number; lastAccessedAt: number }> {
		return [...this.sessions.values()].map((s) => ({
			id: s.id,
			createdAt: s.createdAt,
			lastAccessedAt: s.lastAccessedAt,
		}));
	}

	get activeCount(): number {
		return this.sessions.size;
	}

	getDefault(): Viewport | undefined {
		const first = this.sessions.values().next();
		if (first.done) return undefined;
		first.value.lastAccessedAt = Date.now();
		return first.value.browser;
	}

	getDefaultId(): string | undefined {
		const first = this.sessions.keys().next();
		return first.done ? undefined : first.value;
	}
}
