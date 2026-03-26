export type TreeSitterHighlightResult = {
  highlights?: Array<unknown>;
  warning?: string;
  error?: string;
};

export type TreeSitterClientLike = {
  preloadParser(language: string): Promise<boolean>;
  highlightOnce(source: string, language: string): Promise<TreeSitterHighlightResult>;
  destroy(): Promise<void>;
};

export type TreeSitterDiagnosticResult = {
  ok: boolean;
  env: {
    platform: string;
    arch: string;
    otuiWorkerPath: string | null;
  };
  preload: boolean | null;
  preloadError?: string;
  highlight?: TreeSitterHighlightResult;
  highlightError?: string;
};

export const createTreeSitterDiagnosticResult = async (
  client: TreeSitterClientLike,
  env: NodeJS.ProcessEnv = process.env
): Promise<TreeSitterDiagnosticResult> => {
  const result: TreeSitterDiagnosticResult = {
    ok: false,
    env: {
      platform: process.platform,
      arch: process.arch,
      otuiWorkerPath: env.OTUI_TREE_SITTER_WORKER_PATH ?? null,
    },
    preload: null,
  };

  try {
    try {
      result.preload = await client.preloadParser('markdown');
    } catch (error) {
      result.preloadError = error instanceof Error ? error.message : String(error);
    }

    try {
      result.highlight = await client.highlightOnce(
        '# Title\n\n**bold**\n\n```ts\nconst x = 1\n```',
        'markdown'
      );
    } catch (error) {
      result.highlightError = error instanceof Error ? error.message : String(error);
    }

    const highlightCount = result.highlight?.highlights?.length ?? 0;
    result.ok = highlightCount > 0;
    return result;
  } finally {
    try {
      await client.destroy();
    } catch {
      // ignore cleanup errors in diagnostics
    }
  }
};

export const runTreeSitterDiagnostic = async (): Promise<TreeSitterDiagnosticResult> => {
  const { getTreeSitterClient } = await import('@opentui/core');
  return createTreeSitterDiagnosticResult(getTreeSitterClient(), process.env);
};
