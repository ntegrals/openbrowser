type Handler<T = unknown> = (payload: T) => void;
type RequestHandler<Req = unknown, Res = unknown> = (payload: Req) => Promise<Res>;

export class EventHub<
	EventMap extends { [K in keyof EventMap]: EventMap[K] } = Record<string, unknown>,
	RequestMap extends { [K in keyof RequestMap]: { request: unknown; response: unknown } } = Record<
		string,
		{ request: unknown; response: unknown }
	>,
> {
	private handlers = new Map<string, Set<Handler>>();
	private requestHandlers = new Map<string, RequestHandler>();
	private history: Array<{ event: string; payload: unknown; timestamp: number }> = [];
	private maxHistory: number;

	constructor(options?: { maxHistory?: number }) {
		this.maxHistory = options?.maxHistory ?? 100;
	}

	on<K extends keyof EventMap & string>(event: K, handler: Handler<EventMap[K]>): () => void {
		if (!this.handlers.has(event)) {
			this.handlers.set(event, new Set());
		}
		this.handlers.get(event)!.add(handler as Handler);

		return () => {
			this.handlers.get(event)?.delete(handler as Handler);
		};
	}

	once<K extends keyof EventMap & string>(event: K, handler: Handler<EventMap[K]>): () => void {
		const wrappedHandler: Handler<EventMap[K]> = (payload) => {
			off();
			handler(payload);
		};
		const off = this.on(event, wrappedHandler);
		return off;
	}

	emit<K extends keyof EventMap & string>(event: K, payload: EventMap[K]): void {
		this.recordHistory(event, payload);
		const handlers = this.handlers.get(event);
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(payload);
				} catch (error) {
					console.error(`Error in event handler for "${event}":`, error);
				}
			}
		}
	}

	onRequest<K extends keyof RequestMap & string>(
		event: K,
		handler: RequestHandler<RequestMap[K]['request'], RequestMap[K]['response']>,
	): () => void {
		this.requestHandlers.set(event, handler as RequestHandler);
		return () => {
			this.requestHandlers.delete(event);
		};
	}

	async request<K extends keyof RequestMap & string>(
		event: K,
		payload: RequestMap[K]['request'],
		timeoutMs = 30000,
	): Promise<RequestMap[K]['response']> {
		const handler = this.requestHandlers.get(event);
		if (!handler) {
			throw new Error(`No handler registered for request "${event}"`);
		}

		const result = await Promise.race([
			handler(payload),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error(`Request "${event}" timed out after ${timeoutMs}ms`)), timeoutMs),
			),
		]);

		return result as RequestMap[K]['response'];
	}

	off<K extends keyof EventMap & string>(event: K, handler?: Handler<EventMap[K]>): void {
		if (handler) {
			this.handlers.get(event)?.delete(handler as Handler);
		} else {
			this.handlers.delete(event);
		}
	}

	removeAllListeners(): void {
		this.handlers.clear();
		this.requestHandlers.clear();
	}

	getHistory(event?: string): Array<{ event: string; payload: unknown; timestamp: number }> {
		if (event) {
			return this.history.filter((h) => h.event === event);
		}
		return [...this.history];
	}

	clearHistory(): void {
		this.history = [];
	}

	private recordHistory(event: string, payload: unknown): void {
		this.history.push({ event, payload, timestamp: Date.now() });
		if (this.history.length > this.maxHistory) {
			this.history = this.history.slice(-this.maxHistory);
		}
	}
}
