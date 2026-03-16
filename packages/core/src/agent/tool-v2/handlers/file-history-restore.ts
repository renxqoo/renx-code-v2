import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import {
  booleanSchema,
  fileHistoryVersionSchema,
  objectSchema,
  stringSchema,
} from '../output-schema';
import { ToolV2ExecutionError, ToolV2ResourceNotFoundError } from '../errors';
import { assertReadAccess, assertWriteAccess } from '../permissions';
import { StructuredToolHandler } from '../registry';
import { createConfiguredFileHistoryStore } from '../../storage/file-history-store';
import { FILE_HISTORY_RESTORE_TOOL_DESCRIPTION } from '../tool-prompts';

const schema = z
  .object({
    path: z.string().min(1).describe('Path to the file that should be restored'),
    versionId: z
      .string()
      .min(1)
      .optional()
      .describe('Specific saved version id to restore; defaults to the latest version'),
  })
  .strict();

export class FileHistoryRestoreToolV2 extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'file_history_restore',
      description: FILE_HISTORY_RESTORE_TOOL_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          path: stringSchema(),
          restored: booleanSchema(),
          version: fileHistoryVersionSchema,
        },
        {
          required: ['path', 'restored', 'version'],
        }
      ),
      supportsParallel: false,
      mutating: true,
      tags: ['filesystem', 'history', 'write'],
    });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    return {
      mutating: true,
      readPaths: [args.path],
      writePaths: [args.path],
      approval: {
        required: true,
        reason: `Restore file history for ${args.path}`,
        key: `file-history-restore:${args.path}`,
      },
      preferredSandbox: 'workspace-write',
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const readablePath = assertReadAccess(
      args.path,
      context.workingDirectory,
      context.fileSystemPolicy
    );
    const writablePath = assertWriteAccess(
      args.path,
      context.workingDirectory,
      context.fileSystemPolicy
    );

    const historyStore = createConfiguredFileHistoryStore();
    const versions = await historyStore.listVersions(readablePath);
    const version = args.versionId
      ? versions.find((entry) => entry.versionId === args.versionId)
      : versions[0];

    if (!version) {
      throw new ToolV2ResourceNotFoundError(
        args.versionId
          ? 'Requested file history version was not found'
          : 'No file history exists for the requested path',
        {
          path: args.path,
          versionId: args.versionId,
        }
      );
    }

    const restored = await historyStore.restoreVersion(writablePath, version.versionId);
    if (!restored) {
      throw new ToolV2ExecutionError('Failed to restore the requested file history version', {
        path: args.path,
        versionId: version.versionId,
      });
    }

    return {
      output: JSON.stringify({
        path: writablePath,
        restored: true,
        version,
      }),
      structured: {
        path: writablePath,
        restored: true,
        version,
      },
      metadata: {
        path: writablePath,
        versionId: version.versionId,
      },
    };
  }
}
