import { z, type ZodTypeAny } from 'zod';
import type { CommandExecutor } from '../commands/executor.js';

export interface MCPToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export class BridgeAdapter {
	private tools: CommandExecutor;

	constructor(tools: CommandExecutor) {
		this.tools = tools;
	}

	getToolDefinitions(): MCPToolDefinition[] {
		return this.tools.registry.getAll().map((action) => ({
			name: `browser_${action.name}`,
			description: action.description,
			inputSchema: this.zodToJsonSchema(action.schema),
		}));
	}

	getToolNames(): string[] {
		return this.tools.registry.getNames().map((name) => `browser_${name}`);
	}

	parseToolName(mcpToolName: string): string | null {
		if (mcpToolName.startsWith('browser_')) {
			return mcpToolName.slice(8);
		}
		return null;
	}

	private zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
		const jsonSchema: Record<string, unknown> = { type: 'object' };

		if (schema instanceof z.ZodObject) {
			const shape = schema.shape;
			const properties: Record<string, unknown> = {};
			const required: string[] = [];

			for (const [key, value] of Object.entries(shape)) {
				const fieldSchema = value as ZodTypeAny;
				properties[key] = this.fieldToJsonSchema(fieldSchema);
				if (!(fieldSchema instanceof z.ZodOptional)) {
					required.push(key);
				}
			}

			jsonSchema.properties = properties;
			if (required.length > 0) {
				jsonSchema.required = required;
			}
		}

		return jsonSchema;
	}

	private fieldToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
		if (schema instanceof z.ZodString) {
			return { type: 'string', description: schema.description };
		}
		if (schema instanceof z.ZodNumber) {
			return { type: 'number', description: schema.description };
		}
		if (schema instanceof z.ZodBoolean) {
			return { type: 'boolean', description: schema.description };
		}
		if (schema instanceof z.ZodEnum) {
			return { type: 'string', enum: schema.options, description: schema.description };
		}
		if (schema instanceof z.ZodArray) {
			return {
				type: 'array',
				items: this.fieldToJsonSchema(schema.element),
				description: schema.description,
			};
		}
		if (schema instanceof z.ZodOptional) {
			return this.fieldToJsonSchema(schema.unwrap());
		}
		if (schema instanceof z.ZodDefault) {
			const inner = this.fieldToJsonSchema(schema.removeDefault());
			(inner as any).default = schema._def.defaultValue();
			return inner;
		}
		if (schema instanceof z.ZodLiteral) {
			return { const: schema.value };
		}
		return { type: 'object', description: schema.description };
	}
}
