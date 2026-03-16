import { describe, expect, it } from 'vitest';

import { filterToolSchemas } from './tool-catalog';
import type { ToolSchemaLike } from './source-modules';

const schemas: ToolSchemaLike[] = [
  { type: 'function', function: { name: 'local_shell' } },
  { type: 'function', function: { name: 'write_file' } },
  { type: 'function', function: { name: 'read_file' } },
  { type: 'function', function: { name: 'file_edit' } },
  { type: 'function', function: { name: 'file_history_list' } },
  { type: 'function', function: { name: 'file_history_restore' } },
  { type: 'function', function: { name: 'glob' } },
  { type: 'function', function: { name: 'grep' } },
  { type: 'function', function: { name: 'skill' } },
  { type: 'function', function: { name: 'spawn_agent' } },
  { type: 'function', function: { name: 'task_output' } },
];

describe('filterToolSchemas', () => {
  it('returns visible schemas when no allow list is provided', () => {
    expect(
      filterToolSchemas(schemas, {
        hiddenToolNames: new Set(['file_history_list', 'file_history_restore']),
      }).map((schema) => schema.function.name)
    ).toEqual([
      'local_shell',
      'write_file',
      'read_file',
      'file_edit',
      'glob',
      'grep',
      'skill',
      'spawn_agent',
      'task_output',
    ]);
  });

  it('applies allow list after hidden-name filtering', () => {
    expect(
      filterToolSchemas(schemas, {
        allowedTools: ['local_shell', 'spawn_agent', 'task_output', 'missing'],
        hiddenToolNames: new Set(['task_output']),
      }).map((schema) => schema.function.name)
    ).toEqual(['local_shell', 'spawn_agent']);
  });
});
