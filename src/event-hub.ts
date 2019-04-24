type Handler<T = any> = (payload: T) => void;

/**
 * A simple typed event emitter.
 *
 * Usage:
 *   interface MyEvents {
 *     'page-loaded': { url: string };
 *     'error': Error;
 *   }
 *   const hub = new EventHub<MyEvents>();
 *   hub.on('page-loaded', ({ url }) => console.log(url));
 *   hub.emit('page-loaded', { url: 'https://example.com' });
 */
export class EventHub<EventMap extends Record<string, any> = Record<string, any>> {
  private handlers = new Map<string, Set<Handler>>();

  /**
   * Register a handler for an event. Returns an unsubscribe function.
   */
  on<K extends keyof EventMap & string>(
    event: K,
    handler: Handler<EventMap[K]>,
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  /**
   * Register a one-time handler for an event.
   */
  once<K extends keyof EventMap & string>(
    event: K,
    handler: Handler<EventMap[K]>,
  ): () => void {
    const wrapper: Handler<EventMap[K]> = (payload) => {
      unsub();
      handler(payload);
    };
    const unsub = this.on(event, wrapper);
    return unsub;
  }

  /**
