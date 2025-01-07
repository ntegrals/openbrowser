import { z } from 'zod';

// ── Branded types for compile-time safety ──

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type TargetId = Brand<string, 'TargetId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type ElementRef = Brand<number, 'ElementRef'>;
export type TabId = Brand<number, 'TabId'>;

export function targetId(id: string): TargetId {
	return id as TargetId;
}

export function sessionId(id: string): SessionId {
	return id as SessionId;
}

export function elementIndex(index: number): ElementRef {
	return index as ElementRef;
}

export function tabId(id: number): TabId {
	return id as TabId;
}

// ── Result type for error handling ──

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
	return { ok: false, error };
}

// ── Position & geometry ──

export const PositionSchema = z.object({
	x: z.number(),
	y: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

export const RectSchema = z.object({
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
});
export type Rect = z.infer<typeof RectSchema>;

// ── Common enums ──

export const LogLevel = {
	DEBUG: 0,
	INFO: 1,
	WARN: 2,
	ERROR: 3,
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

// ── Utility types ──

export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Awaitable<T> = T | Promise<T>;
