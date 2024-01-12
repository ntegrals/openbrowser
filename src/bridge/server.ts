import { createLogger } from '../logging';
import { EventHub } from '../viewport/event-hub';

const logger = createLogger('bridge-server');

export interface BridgeServerOptions {
  port?: number;
  host?: string;
}

/**
 * Bridge server enables external processes to control the browser
 * agent via a WebSocket/HTTP protocol.
 */
export class BridgeServer {
  private readonly port: number;
  private readonly host: string;
  private server: any = null;
  private connections = new Set<any>();
  readonly events = new EventHub();

  constructor(options: BridgeServerOptions = {}) {
    this.port = options.port ?? 9222;
    this.host = options.host ?? 'localhost';
  }

  async start(): Promise<void> {
    logger.info(`Starting bridge server on ${this.host}:${this.port}`);
    // HTTP server with WebSocket upgrade
    this.server = Bun.serve({
      port: this.port,
      hostname: this.host,
      fetch: (req) => this.handleRequest(req),
      websocket: {
        open: (ws) => { this.connections.add(ws); logger.debug('Client connected'); },
        message: (ws, msg) => this.handleMessage(ws, String(msg)),
        close: (ws) => { this.connections.delete(ws); logger.debug('Client disconnected'); },
      },
    });
    logger.info('Bridge server started');
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = null;
      this.connections.clear();
      logger.info('Bridge server stopped');
    }
  }

  broadcast(event: string, data: unknown): void {
    const msg = JSON.stringify({ event, data });
    for (const ws of this.connections) {
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }

  private handleRequest(req: Request): Response {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (this.server?.upgrade(req)) {
      return undefined as any;
    }
    return new Response('Not found', { status: 404 });
  }

  private handleMessage(ws: any, raw: string): void {
    try {
      const msg = JSON.parse(raw);
      logger.debug(`Received: ${msg.type}`);
      this.events.emit('message', msg);
    } catch (err) {
      logger.error('Invalid message:', err);
    }
  }
}
