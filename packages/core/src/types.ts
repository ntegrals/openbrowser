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

