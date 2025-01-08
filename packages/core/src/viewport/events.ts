import type { ElementRef } from '../types.js';

// ── Event payload types ──

export interface NavigateEvent {
	url: string;
	waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ClickEvent {
	elementIndex: ElementRef;
	clickCount?: number;
}

export interface InputEvent {
	elementIndex: ElementRef;
	text: string;
	clearFirst?: boolean;
}

export interface SelectOptionEvent {
	elementIndex: ElementRef;
	value: string;
}

export interface ScrollEvent {
	direction: 'up' | 'down';
	amount?: number;
	elementIndex?: ElementRef;
}

export interface ScreenshotEvent {
	fullPage?: boolean;
}

export interface ScreenshotResult {
	base64: string;
	width: number;
	height: number;
}

export interface TabSwitchEvent {
	tabIndex: number;
}

export interface FileUploadEvent {
	elementIndex: ElementRef;
	filePaths: string[];
}

export interface KeyPressEvent {
	key: string;
}

export interface BrowserStateEvent {
	url: string;
	title: string;
	tabCount: number;
}

export interface DownloadEvent {
	url: string;
	suggestedFilename: string;
	path?: string;
}

export interface PopupEvent {
	url: string;
	type: 'popup' | 'dialog';
}

export interface SecurityEvent {
	type: 'navigation-blocked' | 'download-blocked' | 'popup-blocked';
	url: string;
	reason: string;
}

export interface CrashEvent {
	reason: string;
}

// ── Event map ──

export interface ViewportEventMap {
	'navigation': NavigateEvent;
	'click': ClickEvent;
	'input': InputEvent;
	'selection': SelectOptionEvent;
	'scroll': ScrollEvent;
	'capture': ScreenshotEvent;
	'capture-result': ScreenshotResult;
	'tab-changed': TabSwitchEvent;
	'tab-closed': { tabIndex: number };
	'tab-opened': { url: string };
	'file-uploaded': FileUploadEvent;
	'keystroke': KeyPressEvent;
	'viewport-state': BrowserStateEvent;
	'download': DownloadEvent;
	'popup': PopupEvent;
	'policy-violation': SecurityEvent;
	'crash': CrashEvent;
	'page-ready': { url: string };
	'content-ready': void;
	'shutdown': void;
}

// ── Request-response event map ──

export interface ViewportRequestMap {
	'get-screenshot': { request: ScreenshotEvent; response: ScreenshotResult };
	'get-state': { request: void; response: BrowserStateEvent };
}
