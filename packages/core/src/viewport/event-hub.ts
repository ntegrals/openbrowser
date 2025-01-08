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
