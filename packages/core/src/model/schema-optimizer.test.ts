import { describe, test, expect } from 'bun:test';
import { z } from 'zod';
import {
	optimizeSchemaForModel,
	optimizeJsonSchemaForModel,
	zodToJsonSchema,
	type SchemaOptimizationOptions,
} from './schema-optimizer.js';

// ── zodToJsonSchema ──

describe('zodToJsonSchema', () => {
	test('converts ZodObject with required and optional fields', () => {
		const schema = z.object({
			name: z.string(),
			age: z.number(),
			email: z.string().optional(),
		});

		const result = zodToJsonSchema(schema);

		expect(result.type).toBe('object');
		expect(result.properties).toBeDefined();
		const props = result.properties as Record<string, Record<string, unknown>>;
		expect(props.name.type).toBe('string');
		expect(props.age.type).toBe('number');
		expect(props.email.type).toBe('string');
		expect(result.required).toEqual(['name', 'age']);
	});

	test('converts primitive types', () => {
		expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' });
		expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' });
		expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' });
	});

	test('converts ZodArray', () => {
		const schema = z.array(z.string());
		const result = zodToJsonSchema(schema);

		expect(result.type).toBe('array');
		expect(result.items).toEqual({ type: 'string' });
	});

	test('converts ZodEnum', () => {
		const schema = z.enum(['a', 'b', 'c']);
		const result = zodToJsonSchema(schema);

		expect(result.type).toBe('string');
		expect(result.enum).toEqual(['a', 'b', 'c']);
	});

	test('converts ZodLiteral', () => {
		const schema = z.literal('hello');
		const result = zodToJsonSchema(schema);

		expect(result.const).toBe('hello');
	});

	test('converts ZodUnion to oneOf', () => {
		const schema = z.union([z.string(), z.number()]);
		const result = zodToJsonSchema(schema);

		expect(result.oneOf).toEqual([{ type: 'string' }, { type: 'number' }]);
	});

	test('unwraps ZodOptional', () => {
		const schema = z.string().optional();
		const result = zodToJsonSchema(schema);

		expect(result.type).toBe('string');
	});

	test('unwraps ZodDefault and includes default value', () => {
		const schema = z.number().default(42);
		const result = zodToJsonSchema(schema);

		expect(result.type).toBe('number');
		expect(result.default).toBe(42);
	});

	test('converts ZodNullable to oneOf with null', () => {
		const schema = z.string().nullable();
		const result = zodToJsonSchema(schema);

		expect(result.oneOf).toEqual([{ type: 'string' }, { type: 'null' }]);
	});

	test('converts ZodRecord', () => {
		const schema = z.record(z.number());
		const result = zodToJsonSchema(schema);

		expect(result.type).toBe('object');
		expect(result.additionalProperties).toEqual({ type: 'number' });
	});

	test('preserves description', () => {
		const schema = z.string().describe('A name');
		const result = zodToJsonSchema(schema);

		expect(result.type).toBe('string');
		expect(result.description).toBe('A name');
	});

	test('converts nested objects', () => {
		const schema = z.object({
			address: z.object({
				street: z.string(),
				city: z.string(),
			}),
		});

		const result = zodToJsonSchema(schema);
		const props = result.properties as Record<string, Record<string, unknown>>;
		expect(props.address.type).toBe('object');
		const addressProps = props.address.properties as Record<string, Record<string, unknown>>;
		expect(addressProps.street.type).toBe('string');
		expect(addressProps.city.type).toBe('string');
	});

	test('converts ZodDiscriminatedUnion to oneOf', () => {
		const schema = z.discriminatedUnion('type', [
			z.object({ type: z.literal('a'), value: z.string() }),
			z.object({ type: z.literal('b'), count: z.number() }),
		]);

		const result = zodToJsonSchema(schema);
		expect(result.oneOf).toBeDefined();
		expect((result.oneOf as unknown[]).length).toBe(2);
	});

	test('falls back to object for unknown types', () => {
		// ZodAny produces a fallback
		const schema = z.any();
		const result = zodToJsonSchema(schema);
		expect(result.type).toBe('object');
	});
});

// ── optimizeSchemaForModel (Zod level) ──

describe('optimizeSchemaForModel', () => {
	test('returns schema unchanged when under variant limit', () => {
		const schema = z.union([z.string(), z.number(), z.boolean()]);
		const result = optimizeSchemaForModel(schema, { maxUnionVariants: 5 });

		// Should be the same schema (not collapsed)
		expect(result).toBe(schema);
	});

	test('collapses union when variants exceed limit', () => {
		const variants: [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]] = [
			z.object({ type: z.literal('a') }),
			z.object({ type: z.literal('b') }),
			z.object({ type: z.literal('c') }),
			z.object({ type: z.literal('d') }),
			z.object({ type: z.literal('e') }),
		];
		const schema = z.union(variants);
		const result = optimizeSchemaForModel(schema, { maxUnionVariants: 3 });

		// Result should be a different schema (collapsed)
		expect(result).not.toBe(schema);
	});

	test('collapses discriminated union when variants exceed limit', () => {
		const schema = z.discriminatedUnion('action', [
			z.object({ action: z.literal('a'), x: z.string() }),
			z.object({ action: z.literal('b'), y: z.number() }),
			z.object({ action: z.literal('c'), z: z.boolean() }),
			z.object({ action: z.literal('d'), w: z.string() }),
		]);
		const result = optimizeSchemaForModel(schema, { maxUnionVariants: 2 });

		expect(result).not.toBe(schema);
	});

	test('passes through non-union schemas unchanged', () => {
		const schema = z.object({ name: z.string() });
		const result = optimizeSchemaForModel(schema);

		expect(result).toBe(schema);
	});
});

// ── optimizeJsonSchemaForModel (JSON Schema level) ──

describe('optimizeJsonSchemaForModel', () => {
	test('collapses oneOf with too many variants', () => {
		const schema: Record<string, unknown> = {
			oneOf: Array.from({ length: 20 }, (_, i) => ({
				type: 'object',
				properties: { id: { type: 'number', const: i } },
			})),
		};

		const result = optimizeJsonSchemaForModel(schema, { maxUnionVariants: 5 });
		const oneOf = result.oneOf as unknown[];

		expect(oneOf.length).toBe(5);
		// Last variant should be a catch-all
		const catchAll = oneOf[4] as Record<string, unknown>;
		expect(catchAll.additionalProperties).toBe(true);
		expect((catchAll.description as string)).toContain('additional variants');
	});

	test('collapses anyOf with too many variants', () => {
		const schema: Record<string, unknown> = {
			anyOf: Array.from({ length: 10 }, (_, i) => ({
				type: 'string',
				const: `val${i}`,
			})),
		};

		const result = optimizeJsonSchemaForModel(schema, { maxUnionVariants: 3 });
		const anyOf = result.anyOf as unknown[];

		expect(anyOf.length).toBe(3);
	});

	test('leaves unions under the limit untouched', () => {
		const schema: Record<string, unknown> = {
			oneOf: [{ type: 'string' }, { type: 'number' }],
		};

		const result = optimizeJsonSchemaForModel(schema, { maxUnionVariants: 15 });
		const oneOf = result.oneOf as unknown[];

		expect(oneOf.length).toBe(2);
	});

	test('collapses enums with too many values', () => {
		const schema: Record<string, unknown> = {
			type: 'string',
			enum: Array.from({ length: 50 }, (_, i) => `value_${i}`),
		};

		const result = optimizeJsonSchemaForModel(schema, { maxEnumValues: 10 });

		expect((result.enum as unknown[]).length).toBe(10);
		expect((result.description as string)).toContain('omitted');
	});

	test('deduplicates enum values by case when over limit', () => {
		// Deduplication only kicks in when values.length > maxEnumValues
		const schema: Record<string, unknown> = {
			type: 'string',
			enum: ['Apple', 'apple', 'APPLE', 'Banana', 'banana', 'BANANA'],
		};

		const result = optimizeJsonSchemaForModel(schema, { maxEnumValues: 3 });

		// Deduplicates to 2 unique values (Apple, Banana) which is under the limit
		expect((result.enum as unknown[]).length).toBe(2);
	});

	test('flattens deeply nested objects beyond max depth', () => {
		// Flattening kicks in when currentDepth >= maxDepth.
		// At maxNestingDepth=0, even top-level nested objects get flattened.
		const schema: Record<string, unknown> = {
			type: 'object',
			properties: {
				level1: {
					type: 'object',
					properties: {
						value: { type: 'string' },
					},
					required: ['value'],
				},
			},
			required: ['level1'],
		};

		const result = optimizeJsonSchemaForModel(schema, { maxNestingDepth: 0 });
		const props = result.properties as Record<string, Record<string, unknown>>;

		// level1's child properties should be flattened up with dot notation
		expect(props['level1.value']).toBeDefined();
		expect(props['level1.value'].type).toBe('string');
		expect(props.level1).toBeUndefined();
	});

	test('adds descriptions for Gemini provider', () => {
		const schema: Record<string, unknown> = {
			type: 'object',
			properties: {
				myField: { type: 'string' },
				describedField: { type: 'number', description: 'Already has one' },
			},
		};

		const result = optimizeJsonSchemaForModel(schema, { provider: 'google' });
		const props = result.properties as Record<string, Record<string, unknown>>;

		expect(props.myField.description).toBe('My field');
		expect(props.describedField.description).toBe('Already has one');
	});

	test('removes additionalProperties: false for OpenAI', () => {
		const schema: Record<string, unknown> = {
			type: 'object',
			properties: { name: { type: 'string' } },
			additionalProperties: false,
		};

		const result = optimizeJsonSchemaForModel(schema, { provider: 'openai' });

		expect(result.additionalProperties).toBeUndefined();
	});

	test('adds required array for OpenAI when missing', () => {
		const schema: Record<string, unknown> = {
			type: 'object',
			properties: {
				name: { type: 'string' },
				age: { type: 'number' },
			},
		};

		const result = optimizeJsonSchemaForModel(schema, { provider: 'openai' });

		expect(result.required).toEqual(['name', 'age']);
	});

	test('walks into nested properties for optimization', () => {
		const schema: Record<string, unknown> = {
			type: 'object',
			properties: {
				nested: {
					type: 'object',
					properties: {
						field: { type: 'string' },
					},
				},
			},
		};

		const result = optimizeJsonSchemaForModel(schema, { provider: 'google' });
		const nested = (result.properties as Record<string, Record<string, unknown>>).nested;
		const nestedProps = nested.properties as Record<string, Record<string, unknown>>;

		expect(nestedProps.field.description).toBe('Field');
	});

	test('walks into array items for optimization', () => {
		const schema: Record<string, unknown> = {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					value: { type: 'string' },
				},
			},
		};

		const result = optimizeJsonSchemaForModel(schema, { provider: 'google' });
		const items = result.items as Record<string, unknown>;
		const itemProps = items.properties as Record<string, Record<string, unknown>>;

		expect(itemProps.value.description).toBe('Value');
	});

	test('returns schema unchanged with no options', () => {
		const schema: Record<string, unknown> = {
			type: 'object',
			properties: { name: { type: 'string' } },
		};

		const result = optimizeJsonSchemaForModel(schema);

		expect(result.type).toBe('object');
		expect((result.properties as Record<string, unknown>).name).toBeDefined();
	});
});
