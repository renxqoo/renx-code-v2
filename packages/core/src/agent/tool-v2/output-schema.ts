export type JsonSchema = Record<string, unknown>;

export function stringSchema(description?: string): JsonSchema {
  return description ? { type: 'string', description } : { type: 'string' };
}

export function integerSchema(description?: string): JsonSchema {
  return description ? { type: 'integer', description } : { type: 'integer' };
}

export function numberSchema(description?: string): JsonSchema {
  return description ? { type: 'number', description } : { type: 'number' };
}

export function booleanSchema(description?: string): JsonSchema {
  return description ? { type: 'boolean', description } : { type: 'boolean' };
}

export function enumSchema(values: readonly string[], description?: string): JsonSchema {
  return description
    ? { type: 'string', enum: [...values], description }
    : { type: 'string', enum: [...values] };
}

export function arraySchema(items: JsonSchema, description?: string): JsonSchema {
  return description ? { type: 'array', items, description } : { type: 'array', items };
}

export function recordSchema(valueSchema: JsonSchema = {}, description?: string): JsonSchema {
  return description
    ? { type: 'object', additionalProperties: valueSchema, description }
    : { type: 'object', additionalProperties: valueSchema };
}

export function objectSchema(
  properties: Record<string, JsonSchema>,
  options: {
    required?: string[];
    description?: string;
    additionalProperties?: boolean | JsonSchema;
  } = {}
): JsonSchema {
  return {
    type: 'object',
    properties,
    additionalProperties: options.additionalProperties ?? false,
    ...(options.required && options.required.length > 0 ? { required: options.required } : {}),
    ...(options.description ? { description: options.description } : {}),
  };
}

export function oneOfSchema(schemas: JsonSchema[], description?: string): JsonSchema {
  return description ? { oneOf: schemas, description } : { oneOf: schemas };
}

export function nullableSchema(schema: JsonSchema): JsonSchema {
  return {
    ...schema,
    nullable: true,
  };
}

export const unknownSchema: JsonSchema = {};
export const metadataSchema = recordSchema();
export const timestampSchema = integerSchema('Unix timestamp in milliseconds');

export const taskStatusSchema = enumSchema(
  ['pending', 'in_progress', 'completed', 'cancelled', 'failed'],
  'Task status'
);

export const taskPrioritySchema = enumSchema(
  ['critical', 'high', 'normal', 'low'],
  'Task priority'
);

export const subagentStatusSchema = enumSchema(
  ['queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out'],
  'Subagent execution status'
);

export const shellBackgroundStatusSchema = enumSchema(
  ['running', 'completed', 'failed', 'cancelled', 'timed_out'],
  'Background shell task status'
);

export const taskCheckpointSchema = objectSchema(
  {
    id: stringSchema(),
    name: stringSchema(),
    completed: booleanSchema(),
    completedAt: timestampSchema,
  },
  {
    required: ['id', 'name', 'completed'],
  }
);

export const taskTagSchema = objectSchema(
  {
    name: stringSchema(),
    color: stringSchema(),
    category: stringSchema(),
  },
  {
    required: ['name'],
  }
);

export const retryConfigSchema = objectSchema(
  {
    maxRetries: integerSchema(),
    retryDelayMs: integerSchema(),
    backoffMultiplier: numberSchema(),
    retryOn: arraySchema(stringSchema()),
  },
  {
    required: ['maxRetries', 'retryDelayMs', 'backoffMultiplier', 'retryOn'],
  }
);

export const taskHistoryEntrySchema = objectSchema(
  {
    timestamp: timestampSchema,
    action: stringSchema(),
    fromStatus: taskStatusSchema,
    toStatus: taskStatusSchema,
    actor: nullableSchema(stringSchema()),
    reason: stringSchema(),
    metadata: metadataSchema,
  },
  {
    required: ['timestamp', 'action'],
  }
);

export const taskRecordSchema = objectSchema(
  {
    id: stringSchema(),
    subject: stringSchema(),
    description: stringSchema(),
    activeForm: stringSchema(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    owner: nullableSchema(stringSchema()),
    blockedBy: arraySchema(stringSchema()),
    blocks: arraySchema(stringSchema()),
    progress: integerSchema(),
    checkpoints: arraySchema(taskCheckpointSchema),
    retryConfig: retryConfigSchema,
    retryCount: integerSchema(),
    lastError: stringSchema(),
    lastErrorAt: timestampSchema,
    timeoutMs: integerSchema(),
    tags: arraySchema(taskTagSchema),
    metadata: metadataSchema,
    history: arraySchema(taskHistoryEntrySchema),
    agentId: stringSchema(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    cancelledAt: timestampSchema,
    version: integerSchema(),
  },
  {
    required: [
      'id',
      'subject',
      'description',
      'activeForm',
      'status',
      'priority',
      'owner',
      'blockedBy',
      'blocks',
      'progress',
      'checkpoints',
      'retryConfig',
      'retryCount',
      'tags',
      'metadata',
      'history',
      'createdAt',
      'updatedAt',
      'version',
    ],
  }
);

export const taskSummarySchema = objectSchema(
  {
    id: stringSchema(),
    subject: stringSchema(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    owner: nullableSchema(stringSchema()),
    blockedBy: arraySchema(stringSchema()),
    blocks: arraySchema(stringSchema()),
    progress: integerSchema(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  },
  {
    required: [
      'id',
      'subject',
      'status',
      'priority',
      'owner',
      'blockedBy',
      'blocks',
      'progress',
      'createdAt',
      'updatedAt',
    ],
  }
);

export const taskReferenceSchema = objectSchema(
  {
    id: stringSchema(),
    subject: stringSchema(),
    status: stringSchema(),
  },
  {
    required: ['id', 'subject', 'status'],
  }
);

export const taskCanStartSchema = objectSchema(
  {
    canStart: booleanSchema(),
    reason: stringSchema(),
  },
  {
    required: ['canStart'],
  }
);

export const subagentRecordSchema = objectSchema(
  {
    agentId: stringSchema(),
    role: stringSchema(),
    prompt: stringSchema(),
    description: stringSchema(),
    status: subagentStatusSchema,
    conversationId: stringSchema(),
    executionId: stringSchema(),
    model: stringSchema(),
    maxSteps: integerSchema(),
    output: stringSchema(),
    error: stringSchema(),
    metadata: metadataSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    startedAt: timestampSchema,
    endedAt: timestampSchema,
    version: integerSchema(),
  },
  {
    required: [
      'agentId',
      'role',
      'prompt',
      'status',
      'conversationId',
      'executionId',
      'metadata',
      'createdAt',
      'updatedAt',
      'version',
    ],
  }
);

export const shellBackgroundRecordSchema = objectSchema(
  {
    taskId: stringSchema(),
    command: stringSchema(),
    cwd: stringSchema(),
    pid: integerSchema(),
    logPath: stringSchema(),
    statusPath: stringSchema(),
    status: shellBackgroundStatusSchema,
    sandbox: enumSchema(['restricted', 'workspace-write', 'full-access']),
    sandboxProfile: stringSchema(),
    policyProfile: stringSchema(),
    executionMode: enumSchema(['sandboxed', 'escalated']),
    exitCode: integerSchema(),
    output: stringSchema(),
    error: stringSchema(),
    timeoutMs: integerSchema(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    startedAt: timestampSchema,
    endedAt: timestampSchema,
    metadata: metadataSchema,
  },
  {
    required: [
      'taskId',
      'command',
      'cwd',
      'logPath',
      'statusPath',
      'status',
      'sandbox',
      'executionMode',
      'timeoutMs',
      'createdAt',
      'updatedAt',
    ],
  }
);

export const fileHistoryVersionSchema = objectSchema(
  {
    versionId: stringSchema(),
    createdAt: timestampSchema,
    byteSize: integerSchema(),
    contentHash: stringSchema(),
    source: stringSchema(),
    snapshotFile: stringSchema(),
  },
  {
    required: ['versionId', 'createdAt', 'byteSize', 'contentHash', 'source', 'snapshotFile'],
  }
);

export const writeFileProtocolSchema = objectSchema(
  {
    ok: booleanSchema(),
    code: enumSchema([
      'OK',
      'WRITE_FILE_PARTIAL_BUFFERED',
      'WRITE_FILE_NEED_FINALIZE',
      'WRITE_FILE_FINALIZE_OK',
    ]),
    message: stringSchema(),
    buffer: objectSchema(
      {
        bufferId: stringSchema(),
        path: stringSchema(),
        bufferedBytes: integerSchema(),
        maxChunkBytes: integerSchema(),
      },
      {
        required: ['bufferId', 'path', 'bufferedBytes', 'maxChunkBytes'],
      }
    ),
    nextArgs: objectSchema(
      {
        mode: enumSchema(['finalize']),
        bufferId: stringSchema(),
        path: stringSchema(),
      },
      {
        required: ['mode', 'bufferId'],
      }
    ),
    nextAction: enumSchema(['finalize', 'none']),
  },
  {
    required: ['ok', 'code', 'nextAction'],
  }
);
