import { describe, expect, it } from 'vitest';

import {
  CodeBlock,
  extractDiffPath,
  inferCodeFiletype,
  inferFiletypeFromPath,
  looksLikeDiff,
} from './code-block';

type ElementLike = {
  type: unknown;
  props?: {
    children?: unknown;
    [key: string]: unknown;
  };
};

const isElementLike = (value: unknown): value is ElementLike => {
  return (
    Boolean(value) && typeof value === 'object' && 'type' in (value as Record<string, unknown>)
  );
};

const findElementByType = (node: unknown, targetType: string): ElementLike | null => {
  if (!node) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByType(child, targetType);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (!isElementLike(node)) {
    return null;
  }

  if (typeof node.type === 'function') {
    return findElementByType(
      (node.type as (props: object) => unknown)(node.props ?? {}),
      targetType
    );
  }

  if (node.type === targetType) {
    return node;
  }

  return findElementByType(node.props?.children, targetType);
};

describe('CodeBlock', () => {
  it('detects unified diff content and extracts the changed path', () => {
    const diff = [
      'diff --git a/src/App.tsx b/src/App.tsx',
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      '@@ -1,2 +1,2 @@',
      '-const before = true;',
      '+const after = true;',
    ].join('\n');

    expect(looksLikeDiff(diff)).toBe(true);
    expect(extractDiffPath(diff)).toBe('src/App.tsx');
    expect(inferCodeFiletype(diff)).toBe('diff');
    expect(inferFiletypeFromPath('src/App.tsx')).toBe('typescript');
  });

  it('infers json and bash snippets without explicit metadata', () => {
    expect(inferCodeFiletype('{\n  "name": "demo"\n}')).toBe('json');
    expect(inferCodeFiletype('$ pnpm test\n$ pnpm lint')).toBe('bash');
  });

  it('renders diff snippets with the OpenTUI diff component', () => {
    const tree = CodeBlock({
      label: 'output',
      content: ['--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n'),
    });

    const diffNode = findElementByType(tree, 'diff');

    expect(diffNode).not.toBeNull();
    expect(diffNode?.props?.view).toBe('unified');
    expect(diffNode?.props?.showLineNumbers).toBe(true);
  });

  it('collapses diff content when collapsible is enabled', () => {
    const content = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,22 @@',
      '-const oldValue = 1;',
      '+const newValue = 1;',
      ...Array.from({ length: 20 }, (_, index) => `+const line${index + 1} = ${index + 1};`),
    ].join('\n');

    const tree = CodeBlock({
      label: 'output',
      content,
      collapsible: true,
      expanded: false,
    });

    const diffNode = findElementByType(tree, 'diff');
    const codeNode = findElementByType(tree, 'code');
    const treeText = JSON.stringify(tree);

    expect(diffNode).not.toBeNull();
    expect(diffNode?.props?.diff).not.toBe(content);
    expect(codeNode).toBeNull();
    expect(treeText).toContain('hidden');
  });

  it('renders full diff component when a long diff is marked expanded', () => {
    const content = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,22 @@',
      '-const oldValue = 1;',
      '+const newValue = 1;',
      ...Array.from({ length: 20 }, (_, index) => `+const line${index + 1} = ${index + 1};`),
    ].join('\n');

    const tree = CodeBlock({
      label: 'output',
      content,
      collapsible: true,
      expanded: true,
    });

    expect(findElementByType(tree, 'diff')).not.toBeNull();
    expect(findElementByType(tree, 'diff')?.props?.diff).toBe(content);
  });

  it('maps js/ts/jsx/tsx hints and file extensions to OpenTUI parser names', () => {
    expect(inferCodeFiletype('const answer = 42;', 'js')).toBe('javascript');
    expect(inferCodeFiletype('const answer: number = 42;', 'ts')).toBe('typescript');
    expect(inferCodeFiletype('export const App = () => <div />;', 'jsx')).toBe('javascript');
    expect(inferCodeFiletype('export const App = () => <div />;', 'tsx')).toBe('typescript');

    expect(inferFiletypeFromPath('src/app.js')).toBe('javascript');
    expect(inferFiletypeFromPath('src/app.ts')).toBe('typescript');
    expect(inferFiletypeFromPath('src/app.jsx')).toBe('javascript');
    expect(inferFiletypeFromPath('src/app.tsx')).toBe('typescript');
  });

  it('renders tsx snippets with the OpenTUI typescript parser filetype', () => {
    const tree = CodeBlock({
      label: 'code',
      content: 'export const App = () => <div>Hello</div>;',
      languageHint: 'tsx',
    });

    const headerText = findElementByType(tree, 'text');
    const codeNode = findElementByType(tree, 'code');

    expect(headerText?.props?.children).toContain('code');
    expect(codeNode).not.toBeNull();
    expect(codeNode?.props?.filetype).toBe('typescript');
  });

  it('collapses long output to 16 lines by default when enabled', () => {
    const content = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
    const expected = `${Array.from({ length: 16 }, (_, index) => `line ${index + 1}`).join('\n')}\n`;

    const tree = CodeBlock({
      label: 'output',
      content,
      collapsible: true,
      expanded: false,
    });

    const codeNode = findElementByType(tree, 'code');

    expect(codeNode).not.toBeNull();
    expect(codeNode?.props?.content).toBe(expected);
  });

  it('shows full output when expanded is true', () => {
    const content = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
    const expected = content;

    const tree = CodeBlock({
      label: 'output',
      content,
      collapsible: true,
      expanded: true,
    });

    const codeNode = findElementByType(tree, 'code');

    expect(codeNode).not.toBeNull();
    expect(codeNode?.props?.content).toBe(expected);
  });

  it('does not treat diagnostic text followed by a diff as a diff block', () => {
    const content = [
      "Error parsing diff: Hunk at line 5 contained invalid line Line 2');",
      'Index: /tmp/task-errors.test.ts',
      '===================================================================',
      '--- /tmp/task-errors.test.ts original',
      '+++ /tmp/task-errors.test.ts modified',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');

    expect(looksLikeDiff(content)).toBe(false);
    expect(inferCodeFiletype(content)).toBeUndefined();

    const tree = CodeBlock({
      label: 'output',
      content,
    });

    expect(findElementByType(tree, 'diff')).toBeNull();
    expect(findElementByType(tree, 'code')).not.toBeNull();
  });
});
