import type { ToolSchemaLike } from './source-modules';

export function filterToolSchemas(
  schemas: ToolSchemaLike[],
  options?: {
    allowedTools?: string[];
    hiddenToolNames?: Set<string>;
  }
): ToolSchemaLike[] {
  const hiddenToolNames = options?.hiddenToolNames;
  const allowedTools = options?.allowedTools;

  const visibleSchemas = schemas.filter((schema) => {
    const name = schema.function?.name;
    return typeof name === 'string' && !hiddenToolNames?.has(name);
  });

  if (!allowedTools || allowedTools.length === 0) {
    return visibleSchemas;
  }

  const allowed = new Set(allowedTools);
  return visibleSchemas.filter((schema) => {
    const name = schema.function?.name;
    return typeof name === 'string' && allowed.has(name);
  });
}
