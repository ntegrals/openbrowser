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
			registry.register({
				name: 'test_action',
				description: 'A test action',
				schema: testSchema,
				handler: makeHandler(),
			});

			expect(registry.has('test_action')).toBe(true);
			expect(registry.size).toBe(1);
		});

		test('unregisters an action', () => {
			registry.register({
				name: 'test_action',
				description: 'A test action',
				schema: testSchema,
				handler: makeHandler(),
			});

			registry.unregister('test_action');
			expect(registry.has('test_action')).toBe(false);
			expect(registry.size).toBe(0);
		});

		test('get returns registered action', () => {
			registry.register({
				name: 'my_action',
				description: 'Mine',
				schema: testSchema,
				handler: makeHandler(),
			});

			const action = registry.get('my_action');
			expect(action).toBeDefined();
			expect(action!.name).toBe('my_action');
			expect(action!.description).toBe('Mine');
		});

		test('get returns undefined for unregistered action', () => {
			expect(registry.get('nonexistent')).toBeUndefined();
