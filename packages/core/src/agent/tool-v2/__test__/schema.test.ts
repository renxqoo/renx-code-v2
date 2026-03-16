import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { zodToJsonSchema } from '../schema';

describe('zodToJsonSchema', () => {
  it('preserves descriptions through wrappers and nested schemas', () => {
    const runInBackgroundSchema = z.preprocess((value) => value, z.boolean());

    const schema = z
      .object({
        command: z.string().min(1).describe('Shell command to execute'),
        runInBackground: runInBackgroundSchema
          .optional()
          .describe('Run the command asynchronously and return a task id'),
        mode: z
          .enum(['direct', 'finalize'])
          .default('direct')
          .describe('Write mode for the file operation'),
        metadata: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Free-form metadata attached to the task'),
        nested: z
          .object({
            path: z.string().describe('Path to inspect'),
          })
          .describe('Nested configuration block'),
      })
      .strict()
      .describe('Demo schema');

    expect(zodToJsonSchema(schema)).toMatchObject({
      type: 'object',
      description: 'Demo schema',
      additionalProperties: false,
      required: ['command', 'nested'],
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
          minLength: 1,
        },
        runInBackground: {
          type: 'boolean',
          description: 'Run the command asynchronously and return a task id',
        },
        mode: {
          type: 'string',
          enum: ['direct', 'finalize'],
          default: 'direct',
          description: 'Write mode for the file operation',
        },
        metadata: {
          type: 'object',
          description: 'Free-form metadata attached to the task',
          additionalProperties: {},
        },
        nested: {
          type: 'object',
          description: 'Nested configuration block',
          additionalProperties: false,
          required: ['path'],
          properties: {
            path: {
              type: 'string',
              description: 'Path to inspect',
            },
          },
        },
      },
    });
  });
});
