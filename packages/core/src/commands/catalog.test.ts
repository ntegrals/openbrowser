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
		});

		test('respects excludeActions option', () => {
			const filtered = new CommandCatalog({ excludeActions: ['blocked'] });

			filtered.register({
				name: 'blocked',
				description: 'Should not register',
				schema: testSchema,
				handler: makeHandler(),
			});

			filtered.register({
				name: 'allowed',
				description: 'Should register',
				schema: testSchema,
				handler: makeHandler(),
			});

			expect(filtered.has('blocked')).toBe(false);
			expect(filtered.has('allowed')).toBe(true);
		});

		test('respects includeActions option', () => {
			const filtered = new CommandCatalog({ includeActions: ['only_this'] });

			filtered.register({
				name: 'only_this',
				description: 'Should register',
				schema: testSchema,
				handler: makeHandler(),
			});

			filtered.register({
				name: 'other',
				description: 'Should not register',
				schema: testSchema,
				handler: makeHandler(),
			});

			expect(filtered.has('only_this')).toBe(true);
			expect(filtered.has('other')).toBe(false);
		});
	});

	describe('getAll and getNames', () => {
		test('returns all registered actions', () => {
			registry.register({
				name: 'alpha',
				description: 'Alpha',
				schema: testSchema,
				handler: makeHandler(),
			});
			registry.register({
				name: 'beta',
				description: 'Beta',
				schema: testSchema,
				handler: makeHandler(),
			});

			const all = registry.getAll();
			expect(all).toHaveLength(2);

			const names = registry.getNames();
			expect(names).toContain('alpha');
			expect(names).toContain('beta');
		});
	});

	describe('execute', () => {
		test('executes registered action with valid params', async () => {
			const handler = makeHandler({ success: true, extractedContent: 'result' });
			registry.register({
				name: 'exec_test',
				description: 'Test execute',
				schema: testSchema,
				handler,
			});

			const ctx = makeContext();
			const result = await registry.execute('exec_test', { value: 'hello' }, ctx);

			expect(result.success).toBe(true);
			expect(result.extractedContent).toBe('result');
			expect(handler).toHaveBeenCalledTimes(1);
		});

		test('throws CommandFailedError for unregistered action', async () => {
			const ctx = makeContext();

			await expect(
				registry.execute('nonexistent', {}, ctx),
			).rejects.toThrow(CommandFailedError);
		});

		test('throws CommandFailedError when schema validation fails', async () => {
			registry.register({
				name: 'strict',
				description: 'Strict schema',
				schema: z.object({ required: z.string() }),
				handler: makeHandler(),
			});

			const ctx = makeContext();

			await expect(
				registry.execute('strict', { wrong: 'param' }, ctx),
			).rejects.toThrow(CommandFailedError);
		});

		test('wraps handler errors in CommandFailedError', async () => {
			registry.register({
				name: 'failing',
				description: 'Fails',
				schema: testSchema,
				handler: async () => {
					throw new Error('Internal failure');
				},
			});

			const ctx = makeContext();

			await expect(
				registry.execute('failing', { value: 'x' }, ctx),
			).rejects.toThrow(CommandFailedError);
		});

		test('re-throws CommandFailedError without wrapping', async () => {
			const original = new CommandFailedError('tool', 'original error');
			registry.register({
				name: 'rethrow',
				description: 'Rethrow',
				schema: testSchema,
				handler: async () => {
					throw original;
				},
			});

			const ctx = makeContext();

			try {
				await registry.execute('rethrow', { value: 'x' }, ctx);
				expect.unreachable('Should have thrown');
			} catch (error) {
				expect(error).toBe(original);
			}
		});
	});

	describe('domain-based filtering', () => {
		test('returns universal actions for any domain', () => {
			registry.register({
				name: 'universal',
				description: 'No filter',
				schema: testSchema,
				handler: makeHandler(),
			});

			const actions = registry.getActionsForDomain('example.com');
			expect(actions.map((a) => a.name)).toContain('universal');
