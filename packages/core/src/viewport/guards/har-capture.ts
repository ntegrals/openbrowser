import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CDPSession } from 'playwright';
import { BaseGuard } from '../guard-base.js';

// ── HAR 1.2 types ──

interface HarRequest {
	method: string;
	url: string;
	httpVersion: string;
	headers: Array<{ name: string; value: string }>;
	queryString: Array<{ name: string; value: string }>;
	headersSize: number;
	bodySize: number;
}

interface HarResponse {
	status: number;
	statusText: string;
	httpVersion: string;
	headers: Array<{ name: string; value: string }>;
	content: {
		size: number;
		mimeType: string;
	};
	headersSize: number;
	bodySize: number;
	redirectURL: string;
}

interface HarEntry {
	startedDateTime: string;
	time: number;
	request: HarRequest;
	response: HarResponse;
	cache: Record<string, never>;
	timings: {
		send: number;
		wait: number;
		receive: number;
	};
}

interface PendingRequest {
	requestId: string;
	startTime: number;
	method: string;
	url: string;
	headers: Record<string, string>;
}

interface ResponseInfo {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	mimeType: string;
	encodedDataLength: number;
}

/**
 * Records network traffic in HAR 1.2 format using CDP Network domain events.
 * On teardown, writes the complete HAR log to the configured output path.
 */
export class HarCaptureGuard extends BaseGuard {
	readonly name = 'har-recording';
	readonly priority = 500;

	private readonly outputPath: string;
	private cdpSession: CDPSession | null = null;
	private pendingRequests = new Map<string, PendingRequest>();
	private responses = new Map<string, ResponseInfo>();
	private entries: HarEntry[] = [];

	constructor(outputPath: string) {
		super();
		this.outputPath = outputPath;
	}

	protected async setup(): Promise<void> {
		this.cdpSession = await this.ctx.page.context().newCDPSession(this.ctx.page);

		await this.cdpSession.send('Network.enable');

		this.cdpSession.on('Network.requestWillBeSent', (params) => {
			const { requestId, request, timestamp } = params as {
				requestId: string;
				request: { method: string; url: string; headers: Record<string, string> };
				timestamp: number;
			};

			this.pendingRequests.set(requestId, {
				requestId,
				startTime: timestamp,
				method: request.method,
				url: request.url,
				headers: request.headers,
			});
		});

		this.cdpSession.on('Network.responseReceived', (params) => {
			const { requestId, response } = params as {
				requestId: string;
				response: {
					status: number;
					statusText: string;
					headers: Record<string, string>;
					mimeType: string;
					encodedDataLength: number;
				};
			};

			this.responses.set(requestId, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
				mimeType: response.mimeType,
				encodedDataLength: response.encodedDataLength,
			});
		});

		this.cdpSession.on('Network.loadingFinished', (params) => {
			const { requestId, timestamp, encodedDataLength } = params as {
				requestId: string;
				timestamp: number;
				encodedDataLength: number;
			};

			this.finalizeEntry(requestId, timestamp, encodedDataLength);
		});

		this.cdpSession.on('Network.loadingFailed', (params) => {
			const { requestId, timestamp } = params as {
				requestId: string;
				timestamp: number;
			};

			// Still record failed requests with a zero-length response
			this.finalizeEntry(requestId, timestamp, 0);
		});

		this.cleanupFns.push(() => {
			this.cdpSession?.detach().catch(() => {
				// Ignore detach errors during cleanup
			});
		});
	}

	private finalizeEntry(requestId: string, endTimestamp: number, encodedDataLength: number): void {
		const pending = this.pendingRequests.get(requestId);
		if (!pending) return;

		const response = this.responses.get(requestId);
		const elapsedMs = (endTimestamp - pending.startTime) * 1000;

		const harRequest: HarRequest = {
			method: pending.method,
			url: pending.url,
			httpVersion: 'HTTP/1.1',
			headers: toHeaderArray(pending.headers),
			queryString: parseQueryString(pending.url),
			headersSize: -1,
			bodySize: -1,
		};

		const harResponse: HarResponse = response
			? {
					status: response.status,
					statusText: response.statusText,
					httpVersion: 'HTTP/1.1',
					headers: toHeaderArray(response.headers),
					content: {
						size: encodedDataLength,
						mimeType: response.mimeType,
					},
					headersSize: -1,
					bodySize: encodedDataLength,
					redirectURL: response.headers['location'] ?? '',
				}
			: {
					status: 0,
					statusText: '',
					httpVersion: 'HTTP/1.1',
					headers: [],
					content: { size: 0, mimeType: '' },
					headersSize: -1,
					bodySize: 0,
					redirectURL: '',
				};

		this.entries.push({
			startedDateTime: new Date(pending.startTime * 1000).toISOString(),
			time: Math.max(0, elapsedMs),
			request: harRequest,
			response: harResponse,
			cache: {},
			timings: {
				send: 0,
				wait: Math.max(0, elapsedMs),
				receive: 0,
			},
		});

		this.pendingRequests.delete(requestId);
		this.responses.delete(requestId);
	}

	protected override async teardown(): Promise<void> {
		const har = {
			log: {
				version: '1.2',
				creator: {
					name: 'open-browser',
					version: '1.0.0',
				},
				entries: this.entries,
			},
		};

		await mkdir(dirname(this.outputPath), { recursive: true });
		await writeFile(this.outputPath, JSON.stringify(har, null, 2), 'utf-8');
	}
}

// ── Helpers ──

function toHeaderArray(headers: Record<string, string>): Array<{ name: string; value: string }> {
	return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function parseQueryString(url: string): Array<{ name: string; value: string }> {
	try {
		const parsed = new URL(url);
		return [...parsed.searchParams.entries()].map(([name, value]) => ({ name, value }));
	} catch {
		return [];
	}
}
