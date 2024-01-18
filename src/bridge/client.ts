import { createLogger } from '../logging';

const logger = createLogger('bridge-client');

export interface BridgeClientOptions {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * Client for connecting to a bridge server.
 * Handles reconnection and message queuing.
 */
export class BridgeClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly reconnectInterval: number;
  private readonly maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private messageQueue: string[] = [];
  private connected = false;

  constructor(options: BridgeClientOptions) {
    this.url = options.url;
    this.reconnectInterval = options.reconnectInterval ?? 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          logger.info('Connected to bridge server');
          this.flushQueue();
          resolve();
        };
        this.ws.onclose = () => {
          this.connected = false;
          logger.warn('Disconnected from bridge server');
          this.attemptReconnect();
        };
        this.ws.onerror = (err) => {
          logger.error('WebSocket error:', err);
          if (!this.connected) reject(err);
        };
        this.ws.onmessage = (event) => {
          this.handleMessage(String(event.data));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  send(event: string, data: unknown): void {
    const msg = JSON.stringify({ type: event, data });
    if (this.connected && this.ws) {
      this.ws.send(msg);
    } else {
      this.messageQueue.push(msg);
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.connected && this.ws) {
      this.ws.send(this.messageQueue.shift()!);
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached');
      return;
    }
    this.reconnectAttempts++;
    setTimeout(() => this.connect().catch(() => {}), this.reconnectInterval);
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);
      logger.debug(`Received: ${msg.event}`);
    } catch {
      logger.error('Invalid message');
    }
  }
}
