import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { ToolV2ConflictError } from '../errors';
import { booleanSchema, objectSchema, stringSchema } from '../output-schema';
import { assertReadAccess, assertWriteAccess } from '../permissions';
import { StructuredToolHandler } from '../registry';
import { createConfiguredFileHistoryStore } from '../../storage/file-history-store';
import { writeTextFileWithHistory } from '../../storage/file-write-service';

const FILE_EDIT_TOOL_V2_DESCRIPTION = `Apply one or more old/new text replacements to a single file and return a unified diff.

Recommended workflow:
1. Read latest content with read_file.
2. Build all intended replacements in one file_edit call.
3. Use dryRun=true to preview before writing when risk is high.

Notes:
- Edits are applied in order.
- If oldText is not found, the tool returns EDIT_CONFLICT so you can re-read and retry.
- Prefer this tool over write_file for precise incremental edits to existing files.`;

const editSchema = z
  .object({
    oldText: z.string().describe('Exact or near-exact text segment to replace'),
    newText: z.string().describe('Replacement text to write in place of oldText'),
  })
  .strict();

const schema = z
  .object({
    path: z.string().min(1).describe('Path to the file that should be modified'),
    edits: z.array(editSchema).min(1).describe('Ordered list of replacements to apply'),
    dryRun: z.boolean().optional().describe('When true, return the diff preview without writing'),
  })
  .strict();

export class FileEditToolV2 extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'file_edit',
      description: FILE_EDIT_TOOL_V2_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          path: stringSchema(),
          changed: booleanSchema(),
          dryRun: booleanSchema(),
          etag: stringSchema(),
        },
        {
          required: ['path', 'changed', 'etag'],
        }
      ),
      supportsParallel: false,
      mutating: true,
      tags: ['filesystem', 'write'],
    });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    return {
      mutating: true,
      readPaths: [args.path],
      writePaths: [args.path],
      approval: {
        required: true,
        reason: `Edit file ${args.path}`,
        key: `file-edit:${args.path}`,
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

    const originalContent = await fs.readFile(readablePath, 'utf8');
    const updatedContent = applyEdits(originalContent, args.edits);
    const changed = updatedContent !== originalContent;
    const diff = createUnifiedDiff(originalContent, updatedContent, writablePath);

    if (!changed || args.dryRun) {
      return {
        output: diff,
        structured: {
          path: writablePath,
          changed,
          dryRun: args.dryRun === true,
          etag: createHash('sha256').update(originalContent).digest('hex'),
        },
        metadata: {
          path: writablePath,
          changed,
          dryRun: args.dryRun === true,
        },
      };
    }

    await writeTextFileWithHistory(writablePath, updatedContent, {
      source: 'tool-v2.file_edit',
      historyStore: createConfiguredFileHistoryStore(),
    });

    return {
      output: diff,
      structured: {
        path: writablePath,
        changed: true,
        etag: createHash('sha256').update(updatedContent).digest('hex'),
      },
      metadata: {
        path: writablePath,
        changed: true,
      },
    };
  }
}

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, '\n');
}

function createUnifiedDiff(originalContent: string, newContent: string, filePath: string): string {
  return createTwoFilesPatch(
    filePath,
    filePath,
    normalizeLineEndings(originalContent),
    normalizeLineEndings(newContent),
    'original',
    'modified'
  );
}

function applyEdits(content: string, edits: Array<{ oldText: string; newText: string }>): string {
  let nextContent = normalizeLineEndings(content);

  for (const edit of edits) {
    const oldText = normalizeLineEndings(edit.oldText);
    const newText = normalizeLineEndings(edit.newText);

    if (nextContent.includes(oldText)) {
      nextContent = nextContent.replace(oldText, newText);
      continue;
    }

    const oldLines = oldText.split('\n');
    const contentLines = nextContent.split('\n');
    let matched = false;

    for (let index = 0; index <= contentLines.length - oldLines.length; index += 1) {
      const window = contentLines.slice(index, index + oldLines.length);
      const isMatch = oldLines.every(
        (oldLine, lineIndex) => oldLine.trim() === window[lineIndex]?.trim()
      );
      if (!isMatch) {
        continue;
      }

      const originalIndent = /^\s*/.exec(contentLines[index] || '')?.[0] || '';
      const replacementLines = newText.split('\n').map((line, lineIndex) => {
        if (lineIndex === 0) {
          return `${originalIndent}${line.trimStart()}`;
        }

        const oldIndent = oldLines[lineIndex]?.match(/^\s*/)?.[0] || '';
        const newIndent = line.match(/^\s*/)?.[0] || '';
        if (oldIndent && newIndent) {
          const relativeIndent = newIndent.length - oldIndent.length;
          return `${originalIndent}${' '.repeat(Math.max(0, relativeIndent))}${line.trimStart()}`;
        }
        return line;
      });

      contentLines.splice(index, oldLines.length, ...replacementLines);
      nextContent = contentLines.join('\n');
      matched = true;
      break;
    }

    if (!matched) {
      const message = `EDIT_CONFLICT: Could not find exact match for edit:\n${edit.oldText}`;
      throw new ToolV2ConflictError(message, {
        error: 'EDIT_CONFLICT',
        code: 'EDIT_CONFLICT',
        conflict: true,
        recoverable: true,
        message,
        agent_hint:
          'Edit oldText was not found in latest file content. Read latest content, update oldText anchor, then retry edit.',
        next_actions: ['read_file', 'file_edit'],
      });
    }
  }

  return nextContent;
}
