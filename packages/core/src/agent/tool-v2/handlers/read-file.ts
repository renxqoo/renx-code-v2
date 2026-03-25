import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { booleanSchema, enumSchema, objectSchema, stringSchema } from '../output-schema';
import { ToolV2ArgumentsError } from '../errors';
import { assertReadAccess } from '../permissions';
import { StructuredToolHandler } from '../registry';

const READ_FILE_TOOL_V2_DESCRIPTION = `Read a file from the local filesystem.

Usage:
- path is required and may be absolute or workspace-relative.
- startLine is optional and 0-based.
- limit is optional and defaults to 1000 lines.
- mode is optional and defaults to text; use image mode for supported image files.
- Results are returned with line numbers prefixed as L1, L2, ...
- Use this tool before file_edit when you need the latest file contents.`;

const SUPPORTED_IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const schema = z
  .object({
    path: z.string().min(1).describe('Absolute or relative path to the file'),
    startLine: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('0-based line number to start reading from'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(4000)
      .optional()
      .describe('Maximum number of lines to return'),
    mode: z
      .enum(['text', 'image'])
      .optional()
      .describe('Read mode: text (default) or image for supported image files'),
  })
  .strict();

export class ReadFileToolV2 extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'read_file',
      description: READ_FILE_TOOL_V2_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          path: stringSchema(),
          etag: stringSchema(),
          truncated: booleanSchema(),
          media: objectSchema(
            {
              kind: enumSchema(['image']),
              mimeType: stringSchema(),
              dataUrl: stringSchema(),
            },
            {
              required: ['kind', 'mimeType', 'dataUrl'],
              additionalProperties: true,
            }
          ),
        },
        {
          required: ['path', 'etag', 'truncated'],
          additionalProperties: true,
        }
      ),
      supportsParallel: true,
      mutating: false,
      tags: ['filesystem', 'read'],
    });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    return {
      mutating: false,
      readPaths: [args.path],
      concurrency: {
        mode: 'parallel-safe',
        lockKey: `read_file:${args.path}`,
      },
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const resolvedPath = assertReadAccess(
      args.path,
      context.workingDirectory,
      context.fileSystemPolicy
    );

    if (args.mode === 'image') {
      if (args.startLine !== undefined || args.limit !== undefined) {
        throw new ToolV2ArgumentsError(
          'read_file',
          'mode=image does not support startLine or limit'
        );
      }
      return executeImageMode(resolvedPath);
    }

    const content = await fs.readFile(resolvedPath, 'utf8');
    const sliced = sliceLines(content, args.startLine ?? 0, args.limit ?? 1000);
    return {
      output: sliced.output,
      structured: {
        path: resolvedPath,
        etag: createHash('sha256').update(content).digest('hex'),
        truncated: sliced.truncated,
      },
      metadata: {
        path: resolvedPath,
        truncated: sliced.truncated,
      },
    };
  }
}

const inferImageMimeType = (path: string): string | undefined => {
  return SUPPORTED_IMAGE_MIME_BY_EXTENSION[extname(path).toLowerCase()];
};

const buildImageDataUrl = (mimeType: string, buffer: Uint8Array): string => {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
};

const executeImageMode = async (resolvedPath: string): Promise<ToolHandlerResult> => {
  const mimeType = inferImageMimeType(resolvedPath);
  if (!mimeType) {
    throw new ToolV2ArgumentsError(
      'read_file',
      'mode=image only supports .png, .jpg, .jpeg, .gif, and .webp files'
    );
  }

  const buffer = await fs.readFile(resolvedPath);
  const etag = createHash('sha256').update(buffer).digest('hex');
  const dataUrl = buildImageDataUrl(mimeType, buffer);

  return {
    output: `Read image: ${resolvedPath}`,
    structured: {
      path: resolvedPath,
      etag,
      truncated: false,
      media: {
        kind: 'image',
        mimeType,
        dataUrl,
      },
    },
    metadata: {
      path: resolvedPath,
      truncated: false,
      mode: 'image',
    },
  };
};

function sliceLines(
  content: string,
  startLine: number,
  limit: number
): { output: string; truncated: boolean } {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const selected = lines.slice(startLine, startLine + limit);
  const output = selected.map((line, index) => `L${startLine + index + 1}: ${line}`).join('\n');
  return {
    output,
    truncated: startLine + limit < lines.length,
  };
}
