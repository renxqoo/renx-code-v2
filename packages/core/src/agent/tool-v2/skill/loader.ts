import * as fs from 'node:fs';
import * as path from 'node:path';

import type { LoadedSkill, SkillLoaderOptions, SkillMetadata } from './types';

interface ParsedSkillDocument {
  readonly metadata: {
    readonly name?: string;
    readonly description?: string;
  };
  readonly content: string;
}

export class SkillLoader {
  private readonly metadataByCanonicalName = new Map<string, SkillMetadata>();

  constructor(private readonly options: SkillLoaderOptions = {}) {
    this.scanRoots();
  }

  hasSkill(name: string): boolean {
    return this.metadataByCanonicalName.has(toCanonicalSkillName(name));
  }

  getAllMetadata(): SkillMetadata[] {
    return Array.from(this.metadataByCanonicalName.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  async loadSkill(name: string): Promise<LoadedSkill | null> {
    const metadata = this.metadataByCanonicalName.get(toCanonicalSkillName(name));
    if (!metadata) {
      return null;
    }

    const skillPath = path.join(metadata.path, 'SKILL.md');
    const raw = await fs.promises.readFile(skillPath, 'utf8');
    const parsed = parseSkillDocument(raw, path.basename(metadata.path));

    return {
      metadata: {
        ...metadata,
        name: parsed.metadata.name?.trim() || metadata.name,
        description: parsed.metadata.description?.trim() || metadata.description,
      },
      content: parsed.content,
      fileRefs: extractFileRefs(parsed.content),
      shellCommands: extractShellCommands(parsed.content),
    };
  }

  private scanRoots(): void {
    for (const root of this.options.skillRoots || []) {
      if (!root || !fs.existsSync(root)) {
        continue;
      }

      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillDir = path.join(root, entry.name);
        const skillFile = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillFile)) {
          continue;
        }

        const raw = fs.readFileSync(skillFile, 'utf8');
        const parsed = parseSkillDocument(raw, entry.name);
        const name = parsed.metadata.name?.trim() || entry.name;
        const description = parsed.metadata.description?.trim() || '';
        const canonicalName = toCanonicalSkillName(name);

        this.metadataByCanonicalName.set(canonicalName, {
          name,
          description,
          path: skillDir,
        });
      }
    }
  }
}

let activeLoader: SkillLoader | null = null;
let activeLoaderKey: string | null = null;

export async function initializeSkillLoader(options?: SkillLoaderOptions): Promise<SkillLoader> {
  const loader = new SkillLoader(options);
  activeLoader = loader;
  activeLoaderKey = toLoaderKey(options);
  return loader;
}

export function getSkillLoader(options?: SkillLoaderOptions): SkillLoader {
  const key = toLoaderKey(options);
  if (!activeLoader || activeLoaderKey !== key) {
    activeLoader = new SkillLoader(options);
    activeLoaderKey = key;
  }
  return activeLoader;
}

export function resetSkillLoader(): void {
  activeLoader = null;
  activeLoaderKey = null;
}

export function listAvailableSkills(options?: SkillLoaderOptions): SkillMetadata[] {
  return getSkillLoader(options).getAllMetadata();
}

function toLoaderKey(options?: SkillLoaderOptions): string {
  return JSON.stringify({
    skillRoots: options?.skillRoots || [],
  });
}

function parseSkillDocument(raw: string, fallbackName: string): ParsedSkillDocument {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return {
      metadata: {
        name: fallbackName,
      },
      content: normalized,
    };
  }

  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return {
      metadata: {
        name: fallbackName,
      },
      content: normalized,
    };
  }

  const frontmatter = normalized.slice(4, end).split('\n');
  const metadata: { name?: string; description?: string } = {};

  for (const line of frontmatter) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === 'name') {
      metadata.name = stripQuotes(value);
    } else if (key === 'description') {
      metadata.description = stripQuotes(value);
    }
  }

  return {
    metadata,
    content: normalized.slice(end + 5),
  };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function extractFileRefs(content: string): string[] {
  const refs = new Set<string>();
  const pattern = /@([A-Za-z0-9_./\\-]+)/g;
  for (const match of content.matchAll(pattern)) {
    const value = normalizeFileRef(match[1]);
    if (value) {
      refs.add(value);
    }
  }
  return [...refs];
}

function extractShellCommands(content: string): string[] {
  const commands = new Set<string>();
  const pattern = /!`([^`]+)`/g;
  for (const match of content.matchAll(pattern)) {
    const value = match[1]?.trim();
    if (value) {
      commands.add(value);
    }
  }
  return [...commands];
}

function normalizeFileRef(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/[.,;:!?]+$/g, '');
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function toCanonicalSkillName(name: string): string {
  return name.trim().toLowerCase();
}
