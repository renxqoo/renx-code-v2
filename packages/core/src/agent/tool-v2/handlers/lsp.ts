import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { ToolV2ResourceNotFoundError } from '../errors';
import {
  arraySchema,
  booleanSchema,
  integerSchema,
  objectSchema,
  stringSchema,
} from '../output-schema';
import { assertReadAccess } from '../permissions';
import { StructuredToolHandler } from '../registry';
import { LSP_TOOL_DESCRIPTION } from '../tool-prompts';

const schema = z
  .object({
    operation: z
      .enum(['goToDefinition', 'findReferences', 'hover', 'documentSymbols'])
      .describe('LSP operation to perform'),
    filePath: z.string().min(1).describe('Absolute or relative path to the file'),
    line: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('1-based line number for cursor-targeted operations'),
    character: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('1-based character offset for cursor-targeted operations'),
  })
  .strict()
  .refine(
    (value) => {
      if (value.operation === 'documentSymbols') {
        return true;
      }
      return value.line !== undefined && value.character !== undefined;
    },
    {
      message:
        'line and character are required for goToDefinition, findReferences, and hover operations',
    }
  );

export class LspToolV2 extends StructuredToolHandler<typeof schema> {
  constructor() {
    super({
      name: 'lsp',
      description: LSP_TOOL_DESCRIPTION,
      schema,
      outputSchema: objectSchema(
        {
          found: booleanSchema(),
          definitions: arraySchema(
            objectSchema(
              {
                fileName: stringSchema(),
                start: integerSchema(),
                length: integerSchema(),
                kind: stringSchema(),
                name: stringSchema(),
              },
              {
                required: ['fileName', 'start', 'length', 'kind', 'name'],
              }
            )
          ),
          references: arraySchema(
            objectSchema(
              {
                fileName: stringSchema(),
                start: integerSchema(),
                length: integerSchema(),
                isWrite: booleanSchema(),
              },
              {
                required: ['fileName', 'start', 'length', 'isWrite'],
              }
            )
          ),
          displayParts: stringSchema(),
          documentation: stringSchema(),
          kind: stringSchema(),
          kindModifiers: stringSchema(),
          symbols: arraySchema(
            objectSchema(
              {
                name: stringSchema(),
                kind: stringSchema(),
                line: integerSchema(),
              },
              {
                required: ['name', 'kind', 'line'],
              }
            )
          ),
        },
        {
          required: ['found'],
          additionalProperties: false,
        }
      ),
      supportsParallel: true,
      mutating: false,
      tags: ['code-intelligence', 'typescript'],
    });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    return {
      mutating: false,
      readPaths: [args.filePath],
      concurrency: {
        mode: 'parallel-safe',
        lockKey: `lsp:${args.filePath}`,
      },
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const absolutePath = assertReadAccess(
      args.filePath,
      context.workingDirectory,
      context.fileSystemPolicy
    );
    if (!fs.existsSync(absolutePath)) {
      throw new ToolV2ResourceNotFoundError('Requested file was not found', {
        filePath: args.filePath,
      });
    }

    const service = createLanguageService(absolutePath);
    const line = args.line ?? 1;
    const character = args.character ?? 1;

    switch (args.operation) {
      case 'goToDefinition':
        return executeGoToDefinition(service, absolutePath, line, character);
      case 'findReferences':
        return executeFindReferences(service, absolutePath, line, character);
      case 'hover':
        return executeHover(service, absolutePath, line, character);
      case 'documentSymbols':
        return executeDocumentSymbols(service, absolutePath);
    }
  }
}

function createLanguageService(filePath: string): ts.LanguageService {
  const configPath = findTsConfig(filePath);
  const { options, fileNames } = loadCompilerOptions(configPath);
  const resolvedPath = path.resolve(filePath);
  const allFileNames = fileNames.includes(resolvedPath) ? fileNames : [...fileNames, resolvedPath];
  const host = createServiceHost(options, allFileNames);
  return ts.createLanguageService(host);
}

function findTsConfig(startPath: string): string | undefined {
  let directory = path.dirname(path.resolve(startPath));
  const root = path.parse(directory).root;

  while (directory !== root) {
    const configPath = path.join(directory, 'tsconfig.json');
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    directory = path.dirname(directory);
  }

  return undefined;
}

function loadCompilerOptions(configPath?: string): {
  options: ts.CompilerOptions;
  fileNames: string[];
} {
  if (!configPath) {
    return defaultCompilerOptions();
  }

  const configText = fs.readFileSync(configPath, 'utf8');
  const parsed = ts.parseConfigFileTextToJson(configPath, configText);
  if (parsed.error) {
    return defaultCompilerOptions();
  }

  const result = ts.parseJsonConfigFileContent(parsed.config, ts.sys, path.dirname(configPath));
  return {
    options: result.options,
    fileNames: result.fileNames,
  };
}

function defaultCompilerOptions(): { options: ts.CompilerOptions; fileNames: string[] } {
  return {
    options: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: true,
      strict: false,
      noEmit: true,
      skipLibCheck: true,
    },
    fileNames: [],
  };
}

function createServiceHost(
  options: ts.CompilerOptions,
  fileNames: string[]
): ts.LanguageServiceHost {
  const knownFiles = new Set(fileNames.map((fileName) => path.resolve(fileName)));

  const readContent = (fileName: string): string | undefined => {
    try {
      return fs.readFileSync(path.resolve(fileName), 'utf8');
    } catch {
      return undefined;
    }
  };

  return {
    getCompilationSettings: () => options,
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    getScriptFileNames: () => [...knownFiles],
    getScriptVersion: () => '0',
    getScriptSnapshot: (fileName) => {
      const content = readContent(fileName);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    fileExists: (fileName) => fs.existsSync(fileName),
    readFile: readContent,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
}

function getPosition(
  service: ts.LanguageService,
  fileName: string,
  line: number,
  character: number
): number {
  const sourceFile = service.getProgram()?.getSourceFile(fileName);
  if (!sourceFile) {
    return 0;
  }
  return sourceFile.getPositionOfLineAndCharacter(line - 1, character - 1);
}

function getLineAndCharacter(
  service: ts.LanguageService,
  fileName: string,
  position: number
): { line: number; character: number } {
  if (typeof service.toLineColumnOffset === 'function') {
    return service.toLineColumnOffset(fileName, position);
  }

  const sourceFile = service.getProgram()?.getSourceFile(fileName);
  if (!sourceFile) {
    return { line: 0, character: 0 };
  }

  const result = ts.getLineAndCharacterOfPosition(sourceFile, position);
  return {
    line: result.line,
    character: result.character,
  };
}

function executeGoToDefinition(
  service: ts.LanguageService,
  filePath: string,
  line: number,
  character: number
): ToolHandlerResult {
  const position = getPosition(service, filePath, line, character);
  const definition = service.getDefinitionAndBoundSpan(filePath, position);
  const definitions = definition?.definitions || [];

  return {
    output:
      definitions.length === 0
        ? 'No definition found'
        : definitions
            .map((entry) => {
              const start = getLineAndCharacter(service, entry.fileName, entry.textSpan.start);
              return `${entry.fileName}:${start.line + 1}:${start.character + 1}`;
            })
            .join('\n'),
    structured: {
      found: definitions.length > 0,
      definitions: definitions.map((entry) => ({
        fileName: entry.fileName,
        start: entry.textSpan.start,
        length: entry.textSpan.length,
        kind: entry.kind,
        name: entry.name,
      })),
    },
  };
}

function executeFindReferences(
  service: ts.LanguageService,
  filePath: string,
  line: number,
  character: number
): ToolHandlerResult {
  const position = getPosition(service, filePath, line, character);
  const references = service.getReferencesAtPosition(filePath, position) || [];
  return {
    output:
      references.length === 0
        ? 'No references found'
        : references
            .map((entry) => {
              const start = getLineAndCharacter(service, entry.fileName, entry.textSpan.start);
              return `${entry.fileName}:${start.line + 1}:${start.character + 1}${
                entry.isWriteAccess ? ' (write)' : ' (read)'
              }`;
            })
            .join('\n'),
    structured: {
      found: references.length > 0,
      references: references.map((entry) => ({
        fileName: entry.fileName,
        start: entry.textSpan.start,
        length: entry.textSpan.length,
        isWrite: entry.isWriteAccess,
      })),
    },
  };
}

function executeHover(
  service: ts.LanguageService,
  filePath: string,
  line: number,
  character: number
): ToolHandlerResult {
  const position = getPosition(service, filePath, line, character);
  const hover = service.getQuickInfoAtPosition(filePath, position);
  if (!hover) {
    return {
      output: 'No hover information available',
      structured: { found: false },
    };
  }

  const displayParts = hover.displayParts?.map((entry) => entry.text).join('') || '';
  const documentation = hover.documentation?.map((entry) => entry.text).join('\n') || '';
  const tags =
    hover.tags
      ?.map((tag) => `@${tag.name} ${tag.text?.map((part) => part.text).join('') || ''}`)
      .join('\n') || '';

  return {
    output: [displayParts, documentation, tags].filter(Boolean).join('\n\n') || 'No information',
    structured: {
      found: true,
      displayParts,
      documentation,
      kind: hover.kind,
      kindModifiers: hover.kindModifiers,
    },
  };
}

function executeDocumentSymbols(service: ts.LanguageService, filePath: string): ToolHandlerResult {
  const tree = service.getNavigationTree(filePath);
  const symbols: Array<{ name: string; kind: string; line: number }> = [];

  const walk = (node: ts.NavigationTree, depth = 0): void => {
    const span = node.spans[0];
    if (span) {
      const start = getLineAndCharacter(service, filePath, span.start);
      symbols.push({
        name: `${'  '.repeat(depth)}${node.text}`,
        kind: node.kind,
        line: start.line + 1,
      });
    }
    for (const child of node.childItems || []) {
      walk(child, depth + 1);
    }
  };

  walk(tree);

  return {
    output: symbols
      .map((symbol) => `${symbol.name} (${symbol.kind}) - Line ${symbol.line}`)
      .join('\n'),
    structured: {
      found: symbols.length > 0,
      symbols,
    },
  };
}
