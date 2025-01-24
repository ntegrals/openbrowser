import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionManager } from './sessions.js';
import { type CLIRequest, type CLIResponse, parseRequest, serializeResponse } from './protocol.js';

const SOCKET_DIR = path.join(os.tmpdir(), 'open-browser');
const SOCKET_PATH = path.join(SOCKET_DIR, 'server.sock');

export class CLIServer {
	private server: net.Server | null = null;
	readonly sessions: SessionManager;

	constructor() {
		this.sessions = new SessionManager();
	}

	async start(): Promise<string> {
		if (!fs.existsSync(SOCKET_DIR)) {
			fs.mkdirSync(SOCKET_DIR, { recursive: true });
		}

		// Clean up stale socket
		if (fs.existsSync(SOCKET_PATH)) {
			fs.unlinkSync(SOCKET_PATH);
		}

		return new Promise((resolve, reject) => {
			this.server = net.createServer((socket) => {
				let buffer = '';

				socket.on('data', async (data) => {
					buffer += data.toString();
					const lines = buffer.split('\n');
					buffer = lines.pop() ?? '';

					for (const line of lines) {
						if (!line.trim()) continue;
						const request = parseRequest(line);
						if (request) {
							const response = await this.handleRequest(request);
							socket.write(serializeResponse(response));
						}
					}
				});

				socket.on('error', () => {
					// Client disconnected
				});
			});

			this.server.on('error', reject);
			this.server.listen(SOCKET_PATH, () => {
				resolve(SOCKET_PATH);
			});
		});
	}

	private async handleRequest(request: CLIRequest): Promise<CLIResponse> {
		try {
			switch (request.command) {
				case 'open': {
					const url = request.args.url as string;
					let sessionId = request.args.session as string | undefined;

					if (!sessionId) {
						sessionId = this.sessions.getDefaultId();
					}

					if (!sessionId) {
						sessionId = await this.sessions.create({
							headless: request.args.headless as boolean | undefined,
						});
					}

					const browser = this.sessions.get(sessionId)!;
					await browser.navigate(url);

					return {
						id: request.id,
						success: true,
						data: { sessionId, url: browser.currentPage.url() },
					};
				}

				case 'tap': {
					const browser = this.getSessionBrowser(request);
					const selector = request.args.selector as string;
					await browser.click(selector);
					return { id: request.id, success: true };
				}

				case 'type': {
					const browser = this.getSessionBrowser(request);
					const selector = request.args.selector as string;
					const text = request.args.text as string;
					await browser.type(selector, text);
					return { id: request.id, success: true };
				}

				case 'state': {
					const browser = this.getSessionBrowser(request);
					const state = await browser.getState();
					return { id: request.id, success: true, data: state };
				}

				case 'capture': {
					const browser = this.getSessionBrowser(request);
					const result = await browser.screenshot(request.args.fullPage as boolean);
					return { id: request.id, success: true, data: result };
				}

				case 'eval': {
					const browser = this.getSessionBrowser(request);
					const expression = request.args.expression as string;
					const result = await browser.evaluate(expression);
					return { id: request.id, success: true, data: result };
				}

				case 'sessions': {
					return {
						id: request.id,
						success: true,
						data: this.sessions.list(),
					};
				}

				case 'close': {
					const sessionId = request.args.session as string | undefined;
					if (sessionId) {
						await this.sessions.close(sessionId);
					} else {
						await this.sessions.closeAll();
					}
					return { id: request.id, success: true };
				}

				default:
					return {
						id: request.id,
						success: false,
						error: `Unknown command: ${request.command}`,
					};
			}
		} catch (error) {
			return {
				id: request.id,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private getSessionBrowser(request: CLIRequest) {
		const sessionId = request.args.session as string | undefined;
		const browser = sessionId
			? this.sessions.get(sessionId)
			: this.sessions.getDefault();

		if (!browser) {
			throw new Error('No active session. Use "open" command first.');
		}

		return browser;
	}

	async stop(): Promise<void> {
		await this.sessions.closeAll();

		if (this.server) {
			return new Promise((resolve) => {
				this.server!.close(() => {
					if (fs.existsSync(SOCKET_PATH)) {
						fs.unlinkSync(SOCKET_PATH);
					}
					resolve();
				});
			});
		}
	}

	static get socketPath(): string {
		return SOCKET_PATH;
	}
}
