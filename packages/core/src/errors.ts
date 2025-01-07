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
