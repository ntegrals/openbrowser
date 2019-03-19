/** Unique identifier for an element on the page */
export type ElementRef = number;

/** A point on the page */
export interface Position {
  x: number;
  y: number;
}

/** A rectangle on the page */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

