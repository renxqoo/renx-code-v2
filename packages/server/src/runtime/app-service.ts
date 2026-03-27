import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  createEnterpriseAgentAppService,
  ProviderRegistry,
  type EnterpriseAgentAppComposition,
} from '@renx-code/core';

import type { ServerConfig } from '../config/schema';

export async function createServerAppComposition(
  config: ServerConfig
): Promise<EnterpriseAgentAppComposition> {
  await fs.mkdir(config.stateDir, { recursive: true });
  await fs.mkdir(config.workspaceDir, { recursive: true });

  const provider = ProviderRegistry.createFromEnv(config.modelId as never);
  return createEnterpriseAgentAppService({
    llmProvider: provider,
    storePath: path.join(config.stateDir, 'agent.db'),
    toolExecutorOptions: {
      workingDirectory: config.workspaceDir,
    },
  });
}
