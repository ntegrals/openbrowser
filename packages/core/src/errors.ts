export class OpenBrowserError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'OpenBrowserError';
	}
}

export class ViewportError extends OpenBrowserError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ViewportError';
	}
}

export class LaunchFailedError extends ViewportError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'LaunchFailedError';
	}
}

export class NavigationFailedError extends ViewportError {
	constructor(
		message: string,
		public readonly url: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'NavigationFailedError';
	}
}

export class ViewportCrashedError extends ViewportError {
	constructor(message = 'Browser has crashed', options?: ErrorOptions) {
		super(message, options);
		this.name = 'ViewportCrashedError';
	}
}

export class AgentError extends OpenBrowserError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'AgentError';
	}
}

export class AgentStalledError extends AgentError {
	constructor(message = 'Agent is stuck in a loop', options?: ErrorOptions) {
		super(message, options);
		this.name = 'AgentStalledError';
	}
}

export class StepLimitExceededError extends AgentError {
	public readonly stepsTaken: number;
	public readonly stepLimit: number;

	constructor(stepsTaken: number, stepLimit: number, options?: ErrorOptions) {
		super(`Agent reached maximum steps (${stepsTaken}/${stepLimit})`, options);
		this.name = 'StepLimitExceededError';
		this.stepsTaken = stepsTaken;
		this.stepLimit = stepLimit;
	}
}

export class UrlBlockedError extends OpenBrowserError {
	public readonly url: string;

	constructor(url: string, options?: ErrorOptions) {
		super(`URL not allowed: ${url}`, options);
		this.name = 'UrlBlockedError';
		this.url = url;
	}
}

export class PageExtractionError extends OpenBrowserError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'PageExtractionError';
	}
}

export class ModelError extends OpenBrowserError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ModelError';
	}
}

export class ModelThrottledError extends ModelError {
	public readonly retryAfterMs?: number;

	constructor(message: string, retryAfterMs?: number, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ModelThrottledError';
		this.retryAfterMs = retryAfterMs;
	}
}

export class CommandFailedError extends OpenBrowserError {
