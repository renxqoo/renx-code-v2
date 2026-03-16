import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import {
  arraySchema,
  fileHistoryVersionSchema,
  objectSchema,
  stringSchema,
} from '../output-schema';
import { assertReadAccess } from '../permissions';
import { StructuredToolHandler } from '../registry';
import { createConfiguredFileHistoryStore } from '../../storage/file-history-store';
import { FILE_HISTORY_LIST_TOOL_DESCRIPTION } from '../tool-prompts';

const schema = z
  .object({
    path: z.string().min(1).describe('Path to the file whose saved history should be listed'),
  })
  .strict();

export class FileHistoryListToolV2 extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'file_history_list',
      description: FILE_HISTORY_LIST_TOOL_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          path: stringSchema(),
          versions: arraySchema(fileHistoryVersionSchema),
        },
        {
          required: ['path', 'versions'],
        }
      ),
      supportsParallel: true,
      mutating: false,
      tags: ['filesystem', 'history'],
    });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    return {
      mutating: false,
      readPaths: [args.path],
      concurrency: {
        mode: 'parallel-safe',
        lockKey: `file_history_list:${args.path}`,
      },
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const targetPath = assertReadAccess(
      args.path,
      context.workingDirectory,
      context.fileSystemPolicy
    );
    const historyStore = createConfiguredFileHistoryStore();
    const versions = await historyStore.listVersions(targetPath);
    return {
      output: JSON.stringify({ path: targetPath, versions }),
      structured: {
        path: targetPath,
        versions,
      },
      metadata: {
        path: targetPath,
        count: versions.length,
      },
    };
  }
}
