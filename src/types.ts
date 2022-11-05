// ── Branded types for compile-time safety ──

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type TargetId = Brand<string, 'TargetId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type ElementRef = Brand<number, 'ElementRef'>;

export function targetId(id: string): TargetId {
  return id as TargetId;
}

export function elementIndex(index: number): ElementRef {
  return index as ElementRef;
}

import { z } from 'zod';

/** A point on the page */
export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

/** A rectangle on the page */
export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.infer<typeof RectSchema>;

/** Result type for operations that can fail */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Viewport size configuration */
export interface ViewportSize {
  width: number;
  height: number;
}

/** Information about a DOM element */
export interface ElementInfo {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
  href?: string;
  rect: Rect;
  visible: boolean;
  attributes: Record<string, string>;
}

/** The result of executing a command */
export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
  duration: number;
}

/** Utility types */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Awaitable<T> = T | Promise<T>;

/** Screenshot data */
export interface ScreenshotData {
  buffer: Buffer;
  width: number;
  height: number;
}

/** Page metadata */
export interface PageInfo {
  url: string;
  title: string;
  viewport: ViewportSize;
}
