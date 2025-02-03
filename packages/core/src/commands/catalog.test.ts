import { test, expect, describe, beforeEach, mock } from 'bun:test';
import { z } from 'zod';
import { CommandCatalog } from './catalog/catalog.js';
import { CommandFailedError } from '../errors.js';
import type { ExecutionContext, CommandResult } from './types.js';

// ── Helpers ──

function makeHandler(
	result: CommandResult = { success: true },
): (params: Record<string, unknown>, ctx: ExecutionContext) => Promise<CommandResult> {
	return mock(() => Promise.resolve(result));
}

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
	return {
		page: {} as any,
		cdpSession: {} as any,
		domService: {} as any,
		browserSession: {} as any,
		...overrides,
	};
}

const testSchema = z.object({
	value: z.string(),
	count: z.number().optional(),
});

// ── Tests ──

describe('CommandCatalog', () => {
	let registry: CommandCatalog

	beforeEach(() => {
		registry = new CommandCatalog();
	});

	describe('register and unregister', () => {
		test('registers an action', () => {
