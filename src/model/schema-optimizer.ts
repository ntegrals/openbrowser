import { createLogger } from '../logging';

const logger = createLogger('schema-optimizer');

/**
 * Optimizes Zod schemas for use with LLM tool calling.
 * Removes unnecessary complexity, adds descriptions,
 * and ensures JSON Schema compatibility.
 */
export function optimizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = { ...schema };

  // Remove Zod-specific metadata
  delete result['$schema'];
  delete result['$id'];

  // Recursively process properties
  if (result.properties && typeof result.properties === 'object') {
    const props = result.properties as Record<string, any>;
    for (const key of Object.keys(props)) {
      props[key] = optimizeSchema(props[key]);
    }
  }

  // Simplify enum with single value to const
  if (Array.isArray(result.enum) && result.enum.length === 1) {
    result.const = result.enum[0];
    delete result.enum;
  }

  // Remove empty descriptions
  if (result.description === '') {
    delete result.description;
  }

  return result;
}

/**
 * Strip descriptions from a schema to reduce token usage.
 */
export function stripDescriptions(schema: Record<string, unknown>): Record<string, unknown> {
  const result = { ...schema };
  delete result.description;

  if (result.properties && typeof result.properties === 'object') {
    const props = result.properties as Record<string, any>;
    for (const key of Object.keys(props)) {
      props[key] = stripDescriptions(props[key]);
    }
  }

  if (result.items && typeof result.items === 'object') {
    result.items = stripDescriptions(result.items as Record<string, unknown>);
  }

  return result;
}
