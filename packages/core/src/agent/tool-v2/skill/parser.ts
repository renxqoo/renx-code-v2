import type { LoadedSkill, SkillMetadata } from './types';

export function formatSkillForContext(skill: LoadedSkill): string {
  const lines = [`## Skill: ${skill.metadata.name}`];

  if (skill.metadata.description.trim().length > 0) {
    lines.push('', `Description: ${skill.metadata.description}`);
  }

  lines.push('', 'Content:', '', skill.content.trim());

  if (skill.fileRefs.length > 0) {
    lines.push('', 'File References:');
    for (const fileRef of skill.fileRefs) {
      lines.push(`- ${fileRef}`);
    }
  }

  if (skill.shellCommands.length > 0) {
    lines.push('', 'Shell Commands:');
    for (const command of skill.shellCommands) {
      lines.push(`- ${command}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function formatAvailableSkillsForBootstrap(skills: SkillMetadata[]): string {
  return `Available skills: ${skills.map((skill) => skill.name).join(', ')}.`;
}
