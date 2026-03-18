import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuthorizationService } from '../../auth/authorization-service';
import { createSystemPrincipal } from '../../auth/principal';
import { EnterpriseToolSystem } from '../tool-system';
import { SkillToolV2 } from '../handlers/skill';
import { ToolSessionState, type ToolExecutionContext } from '../context';
import { createRestrictedNetworkPolicy, createWorkspaceFileSystemPolicy } from '../permissions';
import { getSkillLoader, initializeSkillLoader, resetSkillLoader } from '../skill/loader';

describe('SkillToolV2', () => {
  let rootDir: string;
  let skillsRoot: string;

  beforeEach(async () => {
    resetSkillLoader();
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-skill-tool-v2-'));
    skillsRoot = path.join(rootDir, 'skills');

    await fs.mkdir(path.join(skillsRoot, 'test-skill'), { recursive: true });
    await fs.mkdir(path.join(skillsRoot, 'plain-skill'), { recursive: true });

    await fs.writeFile(
      path.join(skillsRoot, 'test-skill', 'SKILL.md'),
      `---
name: test-skill
description: Test workflow skill
---
# Test Skill

Use @src/app.ts.

Run !\`pnpm test\`.`,
      'utf8'
    );

    await fs.writeFile(
      path.join(skillsRoot, 'plain-skill', 'SKILL.md'),
      `# Plain Skill

This is a plain skill without frontmatter.`,
      'utf8'
    );
  });

  afterEach(async () => {
    resetSkillLoader();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('loads skill content by name through tool-v2 orchestration', async () => {
    const system = new EnterpriseToolSystem([
      new SkillToolV2({ loaderOptions: { skillRoots: [skillsRoot] } }),
    ]);

    const result = await system.execute(
      {
        toolCallId: 'skill-1',
        toolName: 'skill',
        arguments: JSON.stringify({ name: 'test-skill' }),
      },
      createContext(rootDir)
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.output).toContain('## Skill: test-skill');
    expect(result.structured).toMatchObject({
      name: 'test-skill',
      fileRefs: ['src/app.ts'],
      shellCommands: ['pnpm test'],
    });
  });

  it('returns SKILL_NOT_FOUND with available skills suggestion', async () => {
    const system = new EnterpriseToolSystem([
      new SkillToolV2({ loaderOptions: { skillRoots: [skillsRoot] } }),
    ]);

    const result = await system.execute(
      {
        toolCallId: 'skill-2',
        toolName: 'skill',
        arguments: JSON.stringify({ name: 'missing-skill' }),
      },
      createContext(rootDir)
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.output).toContain('SKILL_NOT_FOUND');
    expect(result.metadata).toMatchObject({
      error: 'SKILL_NOT_FOUND',
    });
    expect(String(result.metadata?.suggestion || '')).toContain('test-skill');
  });

  it('can include available skills in the model-visible description after loader initialization', async () => {
    await initializeSkillLoader({ skillRoots: [skillsRoot] });
    const tool = new SkillToolV2({ loaderOptions: { skillRoots: [skillsRoot] } });

    expect(tool.spec.description).toContain('Available skills');
    expect(tool.spec.description).toContain('test-skill');
    expect(tool.spec.description).toContain('plain-skill');
  });

  it('loads from global and project roots with project precedence and case-insensitive dedupe', async () => {
    const globalSkillsRoot = path.join(rootDir, 'global-skills');
    const projectSkillsRoot = path.join(rootDir, 'project-skills');
    await fs.mkdir(path.join(globalSkillsRoot, 'shared-skill'), { recursive: true });
    await fs.mkdir(path.join(projectSkillsRoot, 'shared-skill'), { recursive: true });

    await fs.writeFile(
      path.join(globalSkillsRoot, 'shared-skill', 'SKILL.md'),
      `---
name: Shared-Skill
description: Global shared skill
---
# Global Shared Skill

Use the global version.`,
      'utf8'
    );

    await fs.writeFile(
      path.join(projectSkillsRoot, 'shared-skill', 'SKILL.md'),
      `---
name: shared-skill
description: Project shared skill
---
# Project Shared Skill

Use the project version.`,
      'utf8'
    );

    await initializeSkillLoader({ skillRoots: [globalSkillsRoot, projectSkillsRoot] });
    const loader = getSkillLoader({ skillRoots: [globalSkillsRoot, projectSkillsRoot] });

    expect(loader.getAllMetadata()).toHaveLength(1);
    expect(loader.getAllMetadata()[0]).toMatchObject({
      name: 'shared-skill',
      description: 'Project shared skill',
      path: path.join(projectSkillsRoot, 'shared-skill'),
    });

    const system = new EnterpriseToolSystem([
      new SkillToolV2({ loaderOptions: { skillRoots: [globalSkillsRoot, projectSkillsRoot] } }),
    ]);

    const result = await system.execute(
      {
        toolCallId: 'skill-3',
        toolName: 'skill',
        arguments: JSON.stringify({ name: 'SHARED-SKILL' }),
      },
      createContext(rootDir)
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.structured).toMatchObject({
      name: 'shared-skill',
      description: 'Project shared skill',
      baseDir: path.join(projectSkillsRoot, 'shared-skill'),
    });
    expect(result.output).toContain('Project Shared Skill');
    expect(result.output).toContain('Use the project version.');
  });
});

function createContext(workspaceDir: string): ToolExecutionContext {
  return {
    workingDirectory: workspaceDir,
    sessionState: new ToolSessionState(),
    authorization: {
      service: new AuthorizationService(),
      principal: createSystemPrincipal('tool-v2-skill-test'),
    },
    fileSystemPolicy: createWorkspaceFileSystemPolicy(workspaceDir),
    networkPolicy: createRestrictedNetworkPolicy(),
    approvalPolicy: 'on-request',
  };
}
