import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import { ToolV2ExecutionError } from '../errors';
import { arraySchema, objectSchema, stringSchema, unknownSchema } from '../output-schema';
import { StructuredToolHandler } from '../registry';
import { formatSkillForContext } from '../skill/parser';
import { getSkillLoader, initializeSkillLoader } from '../skill/loader';
import type { SkillLoaderOptions } from '../skill/types';
import { SKILL_TOOL_BASE_DESCRIPTION } from '../tool-prompts';

const schema = z
  .object({
    name: z.string().min(1).describe('Skill identifier from the available skills list'),
  })
  .strict();

export interface SkillToolV2Options {
  readonly includeSkillList?: boolean;
  readonly loaderOptions?: SkillLoaderOptions;
}

export class SkillToolV2 extends StructuredToolHandler<typeof schema> {
  private readonly loaderOptions?: SkillLoaderOptions;

  constructor(options: SkillToolV2Options = {}) {
    const includeSkillList = options.includeSkillList ?? true;
    super({
      name: 'skill',
      description: buildDescription(includeSkillList, options.loaderOptions),
      schema,
      outputSchema: objectSchema(
        {
          name: stringSchema(),
          description: stringSchema(),
          baseDir: stringSchema(),
          content: stringSchema(),
          fileRefs: arraySchema(unknownSchema),
          shellCommands: arraySchema(stringSchema()),
        },
        {
          required: ['name', 'description', 'baseDir', 'content', 'fileRefs', 'shellCommands'],
        }
      ),
      supportsParallel: true,
      mutating: false,
      tags: ['skill', 'knowledge'],
    });
    this.loaderOptions = options.loaderOptions;
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    return {
      mutating: false,
      concurrency: {
        mode: 'parallel-safe',
        lockKey: `skill:${args.name}`,
      },
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    _context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    try {
      await initializeSkillLoader(this.loaderOptions);
      const loader = getSkillLoader(this.loaderOptions);

      if (!loader.hasSkill(args.name)) {
        const availableSkills = loader.getAllMetadata().map((item: { name: string }) => item.name);
        const suggestion =
          availableSkills.length > 0
            ? `Available skills: ${availableSkills.join(', ')}`
            : 'No skills are currently available.';
        throw new ToolV2ExecutionError(
          `SKILL_NOT_FOUND: Skill "${args.name}" not found. ${suggestion}`,
          {
            error: 'SKILL_NOT_FOUND',
            suggestion,
            requested_name: args.name,
          }
        );
      }

      const skill = await loader.loadSkill(args.name);
      if (!skill) {
        throw new ToolV2ExecutionError(`SKILL_LOAD_FAILED: Failed to load skill "${args.name}"`, {
          error: 'SKILL_LOAD_FAILED',
          requested_name: args.name,
        });
      }

      return {
        output: formatSkillForContext(skill),
        structured: {
          name: skill.metadata.name,
          description: skill.metadata.description,
          baseDir: skill.metadata.path,
          content: skill.content,
          fileRefs: skill.fileRefs,
          shellCommands: skill.shellCommands,
        },
        metadata: {
          name: skill.metadata.name,
          baseDir: skill.metadata.path,
          fileRefs: skill.fileRefs,
          shellCommands: skill.shellCommands,
        },
      };
    } catch (error) {
      if (error instanceof ToolV2ExecutionError) {
        throw error;
      }
      throw new ToolV2ExecutionError(error instanceof Error ? error.message : String(error));
    }
  }
}

function buildDescription(includeSkillList: boolean, loaderOptions?: SkillLoaderOptions): string {
  const base = `${SKILL_TOOL_BASE_DESCRIPTION}\n\n`;
  if (!includeSkillList) {
    return base;
  }

  const loader = getSkillLoader(loaderOptions);
  const skills = loader.getAllMetadata();
  if (skills.length === 0) {
    return `${base}No skills are currently available.`;
  }

  const lines = skills.map(
    (skill: { name: string; description: string }) => `- ${skill.name}: ${skill.description}`
  );
  return `${base}Available skills:\n${lines.join('\n')}`;
}
