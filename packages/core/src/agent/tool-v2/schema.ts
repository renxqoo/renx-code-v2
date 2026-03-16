import { z } from 'zod';

interface ZodDef {
  typeName?: string;
  shape?: unknown;
  description?: string;
  checks?: Array<{
    kind?: string;
    value?: number;
    regex?: { source: string };
    check?: string;
    minimum?: number;
    maximum?: number;
    pattern?: string | RegExp;
    format?: string;
    inclusive?: boolean;
  }>;
  values?: unknown[] | Record<string, unknown>;
  value?: unknown;
  innerType?: z.ZodType;
  defaultValue?: unknown;
  type?: unknown;
  options?: z.ZodType[];
  element?: z.ZodType;
  items?: z.ZodType[];
  entries?: Record<string, unknown>;
  left?: z.ZodType;
  right?: z.ZodType;
  valueType?: z.ZodType;
  schema?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
}

function getDef(schema: unknown): ZodDef | undefined {
  const schemaWithDef = schema as { def?: ZodDef; _def?: ZodDef; _zod_def?: ZodDef };
  const primary = schemaWithDef.def || schemaWithDef._def;
  const secondary = schemaWithDef._zod_def;
  if (primary && secondary) {
    return {
      ...secondary,
      ...primary,
      shape: primary.shape ?? secondary.shape,
      description: primary.description ?? secondary.description,
      checks: primary.checks ?? secondary.checks,
      values: primary.values ?? secondary.values,
      value: primary.value ?? secondary.value,
      innerType: primary.innerType ?? secondary.innerType,
      defaultValue: primary.defaultValue ?? secondary.defaultValue,
      type: primary.type ?? secondary.type,
      options: primary.options ?? secondary.options,
      element: primary.element ?? secondary.element,
      items: primary.items ?? secondary.items,
      entries: primary.entries ?? secondary.entries,
      left: primary.left ?? secondary.left,
      right: primary.right ?? secondary.right,
      valueType: primary.valueType ?? secondary.valueType,
      schema: primary.schema ?? secondary.schema,
      in: primary.in ?? secondary.in,
      out: primary.out ?? secondary.out,
    };
  }
  return primary || secondary;
}

function normalizeTypeName(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith('Zod') ? trimmed.slice(3).toLowerCase() : trimmed.toLowerCase();
}

function getTypeName(schema: unknown): string | undefined {
  const def = getDef(schema);
  const rawType = typeof def?.type === 'string' ? def.type : undefined;
  return normalizeTypeName(def?.typeName || rawType);
}

function getDescription(schema: unknown): string | undefined {
  const schemaWithMeta = schema as {
    description?: unknown;
    meta?: () => { description?: unknown } | undefined;
  };
  if (typeof schemaWithMeta.description === 'string' && schemaWithMeta.description.length > 0) {
    return schemaWithMeta.description;
  }
  const meta = typeof schemaWithMeta.meta === 'function' ? schemaWithMeta.meta() : undefined;
  if (typeof meta?.description === 'string' && meta.description.length > 0) {
    return meta.description;
  }
  return getDef(schema)?.description;
}

function withDescription(json: Record<string, unknown>, schema: unknown): Record<string, unknown> {
  if (!schema) {
    return json;
  }
  const description = getDescription(schema);
  if (!description) {
    return json;
  }
  return {
    ...json,
    description,
  };
}

function withDefault(
  json: Record<string, unknown>,
  defaultValue: unknown
): Record<string, unknown> {
  return {
    ...json,
    default: typeof defaultValue === 'function' ? (defaultValue as () => unknown)() : defaultValue,
  };
}

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const typeName = getTypeName(schema);
  const def = getDef(schema);
  const schemaAny = schema as {
    minLength?: number | null;
    maxLength?: number | null;
    minValue?: number;
    maxValue?: number;
    isInt?: boolean;
    format?: string | null;
    options?: unknown[];
  };

  if (typeName === 'object') {
    const shape = typeof def?.shape === 'function' ? def.shape() : def?.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries((shape || {}) as Record<string, z.ZodType>)) {
      properties[key] = zodToJsonSchema(value);
      const valueType = getTypeName(value);
      if (valueType !== 'optional' && valueType !== 'default') {
        required.push(key);
      }
    }
    return withDescription(
      {
        type: 'object',
        properties,
        additionalProperties: false,
        ...(required.length > 0 ? { required } : {}),
      },
      schema
    );
  }

  if (typeName === 'string') {
    const json: Record<string, unknown> = { type: 'string' };
    if (typeof schemaAny.minLength === 'number') json.minLength = schemaAny.minLength;
    if (typeof schemaAny.maxLength === 'number') json.maxLength = schemaAny.maxLength;
    if (schemaAny.format === 'url') json.format = 'uri';
    if (schemaAny.format === 'email') json.format = 'email';
    if (schemaAny.format === 'uuid') json.format = 'uuid';
    for (const check of def?.checks || []) {
      const checkKind = check.kind || check.check;
      if (checkKind === 'min') json.minLength = check.value;
      if (checkKind === 'max') json.maxLength = check.value;
      if (checkKind === 'regex') json.pattern = check.regex?.source;
      if (checkKind === 'url') json.format = 'uri';
      if (checkKind === 'email') json.format = 'email';
      if (checkKind === 'uuid') json.format = 'uuid';
      if (checkKind === 'min_length') json.minLength = check.minimum;
      if (checkKind === 'max_length') json.maxLength = check.maximum;
      if (checkKind === 'string_format' && check.format === 'regex') {
        json.pattern =
          typeof check.pattern === 'string'
            ? check.pattern
            : check.pattern instanceof RegExp
              ? check.pattern.source
              : undefined;
      }
    }
    return withDescription(json, schema);
  }

  if (typeName === 'number') {
    const json: Record<string, unknown> = { type: 'number' };
    if (schemaAny.isInt) {
      json.type = 'integer';
    }
    if (typeof schemaAny.minValue === 'number' && Number.isFinite(schemaAny.minValue)) {
      json.minimum = schemaAny.minValue;
    }
    if (typeof schemaAny.maxValue === 'number' && Number.isFinite(schemaAny.maxValue)) {
      json.maximum = schemaAny.maxValue;
    }
    for (const check of def?.checks || []) {
      const checkKind = check.kind || check.check;
      if (checkKind === 'int' || checkKind === 'number_format') {
        json.type = 'integer';
      }
      if (checkKind === 'min') {
        if (check.inclusive === false) {
          json.exclusiveMinimum = check.value;
        } else {
          json.minimum = check.value;
        }
      }
      if (checkKind === 'max') {
        if (check.inclusive === false) {
          json.exclusiveMaximum = check.value;
        } else {
          json.maximum = check.value;
        }
      }
    }
    return withDescription(json, schema);
  }

  if (typeName === 'boolean') {
    return withDescription({ type: 'boolean' }, schema);
  }

  if (typeName === 'array') {
    return withDescription(
      {
        type: 'array',
        items: def?.element ? zodToJsonSchema(def.element) : {},
      },
      schema
    );
  }

  if (typeName === 'enum') {
    return withDescription(
      {
        type: 'string',
        enum: Array.isArray(def?.values)
          ? def.values
          : def?.entries
            ? Object.values(def.entries)
            : Array.isArray(schemaAny.options)
              ? schemaAny.options
              : [],
      },
      schema
    );
  }

  if (typeName === 'literal') {
    const value = def?.value;
    if (typeof value === 'string') {
      return withDescription({ type: 'string', const: value }, schema);
    }
    if (typeof value === 'number') {
      return withDescription({ type: 'number', const: value }, schema);
    }
    if (typeof value === 'boolean') {
      return withDescription({ type: 'boolean', const: value }, schema);
    }
    return withDescription({ const: value }, schema);
  }

  if (typeName === 'optional') {
    return withDescription(def?.innerType ? zodToJsonSchema(def.innerType) : {}, schema);
  }

  if (typeName === 'default') {
    const inner = def?.innerType ? zodToJsonSchema(def.innerType) : {};
    return withDescription(withDefault(inner, def?.defaultValue), schema);
  }

  if (typeName === 'nullable') {
    return withDescription(
      {
        ...(def?.innerType ? zodToJsonSchema(def.innerType) : {}),
        nullable: true,
      },
      schema
    );
  }

  if (typeName === 'effects') {
    return withDescription(def?.schema ? zodToJsonSchema(def.schema) : {}, schema);
  }

  if (typeName === 'pipe') {
    return withDescription(def?.out ? zodToJsonSchema(def.out) : {}, schema);
  }

  if (typeName === 'union') {
    return withDescription(
      {
        oneOf: (def?.options || []).map((option) => zodToJsonSchema(option)),
      },
      schema
    );
  }

  if (typeName === 'tuple') {
    return withDescription(
      {
        type: 'array',
        items: (def?.items || []).map((item) => zodToJsonSchema(item)),
      },
      schema
    );
  }

  if (typeName === 'intersection') {
    return withDescription(
      {
        allOf: [
          def?.left ? zodToJsonSchema(def.left) : {},
          def?.right ? zodToJsonSchema(def.right) : {},
        ],
      },
      schema
    );
  }

  if (typeName === 'record') {
    return withDescription(
      {
        type: 'object',
        additionalProperties: def?.valueType ? zodToJsonSchema(def.valueType) : {},
      },
      schema
    );
  }

  if (typeName === 'null') {
    return withDescription({ type: 'null' }, schema);
  }

  return withDescription({}, schema);
}
