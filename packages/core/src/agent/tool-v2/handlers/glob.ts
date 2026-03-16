import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { DEFAULT_IGNORE_GLOBS, collectFilesByGlob } from '../filesystem-search';
import {
  arraySchema,
  booleanSchema,
  integerSchema,
  objectSchema,
  stringSchema,
} from '../output-schema';
import { assertReadAccess } from '../permissions';
import { StructuredToolHandler } from '../registry';
import { GLOB_TOOL_DESCRIPTION } from '../tool-prompts';

const schema = z
  .object({
    pattern: z.string().min(1).describe('Glob pattern like **/*.ts or src/**/*.test.ts'),
    path: z
      .string()
      .optional()
      .describe('Base directory to search; defaults to the current workspace'),
    includeHidden: z
      .boolean()
      .optional()
      .describe('Include hidden files and directories when true'),
    ignore: z
      .array(z.string())
      .optional()
      .describe('Additional ignore patterns applied before matching'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe('Maximum number of matched files to return'),
  })
  .strict();

export class GlobToolV2 extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'glob',
      description: GLOB_TOOL_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          rootPath: stringSchema(),
          count: integerSchema(),
          truncated: booleanSchema(),
          files: arraySchema(
            objectSchema(
              {
                absolutePath: stringSchema(),
                relativePath: stringSchema(),
              },
              {
                required: ['absolutePath', 'relativePath'],
              }
            )
          ),
        },
        {
          required: ['rootPath', 'count', 'truncated', 'files'],
        }
      ),
      supportsParallel: true,
      mutating: false,
      tags: ['filesystem', 'search'],
    });
  }

  plan(args: z.infer<typeof schema>, context: ToolExecutionContext): ToolExecutionPlan {
    return {
      mutating: false,
      readPaths: [args.path || context.workingDirectory],
      concurrency: {
        mode: 'parallel-safe',
        lockKey: `glob:${args.path || context.workingDirectory}`,
      },
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const rootPath = assertReadAccess(
      args.path || context.workingDirectory,
      context.workingDirectory,
      context.fileSystemPolicy
    );
    const result = await collectFilesByGlob({
      rootPath,
      pattern: args.pattern,
      includeHidden: args.includeHidden ?? false,
      ignorePatterns: [...DEFAULT_IGNORE_GLOBS, ...(args.ignore || [])],
      maxResults: args.maxResults ?? 200,
    });
    return {
      output: result.files.map((file) => file.absolutePath).join('\n'),
      structured: {
        rootPath,
        count: result.files.length,
        truncated: result.truncated,
        files: result.files,
      },
      metadata: {
        rootPath,
        count: result.files.length,
        truncated: result.truncated,
      },
    };
  }
}
