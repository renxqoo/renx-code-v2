export interface SkillLoaderOptions {
  readonly skillRoots?: string[];
}

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly path: string;
}

export interface LoadedSkill {
  readonly metadata: SkillMetadata;
  readonly content: string;
  readonly fileRefs: string[];
  readonly shellCommands: string[];
}
