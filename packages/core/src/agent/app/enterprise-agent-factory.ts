import type { LLMProvider } from '../../providers';
import { StatelessAgent, type AgentConfig } from '../agent';
import { AgentAppService, type AgentAppServiceDeps } from './agent-app-service';
import type {
  EventStorePort,
  ExecutionStorePort,
  MessageProjectionStorePort,
  PendingInputStorePort,
  RunLogStorePort,
} from './ports';
import { SqliteAgentAppStore } from './sqlite-agent-app-store';
import {
  createDefaultToolExecutionBaseline,
  createReadOnlyFileSystemPolicy,
  createRestrictedNetworkPolicy,
  createWorkspaceFileSystemPolicy,
  createEnterpriseToolSystemV2,
  createEnabledNetworkPolicy,
  createUnrestrictedFileSystemPolicy,
  EnterpriseToolExecutor,
  mergeOrganizationPolicyConfigs,
  SHELL_POLICY_PROFILES,
  type CreateToolSystemV2Options,
  type EnterpriseToolExecutorOptions,
  type EnterpriseToolSystem,
  type OrganizationPolicyConfig,
} from '../tool-v2';
import { loadOrganizationPolicy } from '../tool-v2/organization-policy-loader';

export const AGENT_FULL_ACCESS_ENV = 'AGENT_FULL_ACCESS';
export const AGENT_DEFAULT_APPROVAL_POLICY_ENV = 'AGENT_DEFAULT_APPROVAL_POLICY';
export const AGENT_DEFAULT_TRUST_LEVEL_ENV = 'AGENT_DEFAULT_TRUST_LEVEL';
export const AGENT_DEFAULT_FILESYSTEM_MODE_ENV = 'AGENT_DEFAULT_FILESYSTEM_MODE';
export const AGENT_DEFAULT_NETWORK_MODE_ENV = 'AGENT_DEFAULT_NETWORK_MODE';

export interface CreateEnterpriseAgentRuntimeOptions {
  readonly llmProvider: LLMProvider;
  readonly toolSystem?: EnterpriseToolSystem;
  readonly toolSystemOptions?: CreateToolSystemV2Options;
  readonly toolExecutorOptions?: Omit<EnterpriseToolExecutorOptions, 'system'>;
  readonly organizationPolicy?: OrganizationPolicyConfig;
  readonly organizationPolicyFilePath?: string;
  readonly projectRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly agentConfig?: AgentConfig;
}

export interface EnterpriseAgentRuntime {
  readonly toolSystem: EnterpriseToolSystem;
  readonly toolExecutor: EnterpriseToolExecutor;
  readonly agent: StatelessAgent;
}

export interface CreateEnterpriseAgentAppServiceOptions extends CreateEnterpriseAgentRuntimeOptions {
  readonly store?: SqliteAgentAppStore;
  readonly storePath?: string;
  readonly executionStore?: ExecutionStorePort;
  readonly eventStore?: EventStorePort;
  readonly messageStore?: MessageProjectionStorePort;
  readonly runLogStore?: RunLogStorePort;
  readonly pendingInputStore?: PendingInputStorePort;
}

export interface EnterpriseAgentAppComposition extends EnterpriseAgentRuntime {
  readonly appService: AgentAppService;
  readonly store?: SqliteAgentAppStore;
}

export function createEnterpriseAgentRuntime(
  options: CreateEnterpriseAgentRuntimeOptions
): EnterpriseAgentRuntime {
  const env = options.env || process.env;
  const fullAccessEnabled = isFullAccessEnabled(env);
  const loadedPolicy = fullAccessEnabled
    ? {
        policy: undefined,
        policyVersion: 'full-access',
        sources: {
          explicit: null,
          project: null,
          global: null,
        },
      }
    : loadOrganizationPolicy({
        filePath: options.organizationPolicyFilePath,
        projectRoot: options.projectRoot || options.toolExecutorOptions?.workingDirectory,
        env,
      });
  const organizationPolicy = mergeOrganizationPolicyConfigs(
    loadedPolicy.policy,
    options.organizationPolicy
  );
  const effectivePolicy =
    !fullAccessEnabled &&
    organizationPolicy &&
    loadedPolicy.policyVersion &&
    !organizationPolicy.version
      ? {
          ...organizationPolicy,
          version: loadedPolicy.policyVersion,
        }
      : organizationPolicy;
  const toolSystem =
    options.toolSystem ||
    createEnterpriseToolSystemV2(
      resolveToolSystemOptions(options.toolSystemOptions, fullAccessEnabled)
    );
  const toolExecutorOptions = resolveToolExecutorOptions(
    options.toolExecutorOptions,
    loadedPolicy.policyVersion,
    effectivePolicy,
    fullAccessEnabled,
    env
  );
  const toolExecutor = new EnterpriseToolExecutor({
    ...toolExecutorOptions,
    system: toolSystem,
  });
  const agent = new StatelessAgent(options.llmProvider, toolExecutor, options.agentConfig || {});

  return {
    toolSystem,
    toolExecutor,
    agent,
  };
}

export function createEnterpriseAgentAppService(
  options: CreateEnterpriseAgentAppServiceOptions
): EnterpriseAgentAppComposition {
  const runtime = createEnterpriseAgentRuntime(options);
  const ownedStore =
    options.store || (options.storePath ? new SqliteAgentAppStore(options.storePath) : undefined);
  const deps = resolveAgentAppServiceDeps(options, runtime.agent, ownedStore);

  return {
    ...runtime,
    appService: new AgentAppService(deps),
    store: ownedStore,
  };
}

function resolveToolSystemOptions(
  toolSystemOptions: CreateToolSystemV2Options | undefined,
  fullAccessEnabled: boolean
): CreateToolSystemV2Options | undefined {
  if (!fullAccessEnabled) {
    return toolSystemOptions;
  }

  return {
    ...(toolSystemOptions || {}),
    builtIns: {
      ...(toolSystemOptions?.builtIns || {}),
      shell: {
        ...(toolSystemOptions?.builtIns?.shell || {}),
        profile: SHELL_POLICY_PROFILES.fullAccess,
      },
    },
  };
}

function resolveToolExecutorOptions(
  toolExecutorOptions: Omit<EnterpriseToolExecutorOptions, 'system'> | undefined,
  policyVersion: string | undefined,
  organizationPolicy: OrganizationPolicyConfig | undefined,
  fullAccessEnabled: boolean,
  env: NodeJS.ProcessEnv | undefined
): Omit<EnterpriseToolExecutorOptions, 'system'> {
  if (!fullAccessEnabled) {
    const configuredDefaults = resolveConfiguredToolExecutorDefaults(
      env,
      toolExecutorOptions?.workingDirectory,
      toolExecutorOptions?.trustLevel
    );
    return {
      ...(toolExecutorOptions || {}),
      fileSystemPolicy:
        toolExecutorOptions?.fileSystemPolicy || configuredDefaults.fileSystemPolicy,
      networkPolicy: toolExecutorOptions?.networkPolicy || configuredDefaults.networkPolicy,
      approvalPolicy: toolExecutorOptions?.approvalPolicy || configuredDefaults.approvalPolicy,
      trustLevel: toolExecutorOptions?.trustLevel || configuredDefaults.trustLevel,
      authorizationPolicyVersion: toolExecutorOptions?.authorizationPolicyVersion || policyVersion,
      organizationPolicy: toolExecutorOptions?.organizationPolicy || organizationPolicy,
    };
  }

  return {
    ...(toolExecutorOptions || {}),
    fileSystemPolicy: toolExecutorOptions?.fileSystemPolicy || createUnrestrictedFileSystemPolicy(),
    networkPolicy: toolExecutorOptions?.networkPolicy || createEnabledNetworkPolicy(),
    approvalPolicy: toolExecutorOptions?.approvalPolicy || 'unless-trusted',
    trustLevel: toolExecutorOptions?.trustLevel || 'trusted',
    authorizationPolicyVersion:
      toolExecutorOptions?.authorizationPolicyVersion || policyVersion || 'full-access',
    organizationPolicy: undefined,
  };
}

function isFullAccessEnabled(env: NodeJS.ProcessEnv | undefined): boolean {
  const raw = env?.[AGENT_FULL_ACCESS_ENV]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function resolveConfiguredToolExecutorDefaults(
  env: NodeJS.ProcessEnv | undefined,
  workingDirectory?: string,
  explicitTrustLevel?: EnterpriseToolExecutorOptions['trustLevel']
): Pick<
  EnterpriseToolExecutorOptions,
  'fileSystemPolicy' | 'networkPolicy' | 'approvalPolicy' | 'trustLevel'
> {
  const trustLevel = explicitTrustLevel || parseTrustLevel(env?.[AGENT_DEFAULT_TRUST_LEVEL_ENV]);
  const baseline = createDefaultToolExecutionBaseline({
    workingDirectory,
    trustLevel,
  });

  return {
    trustLevel: baseline.trustLevel,
    approvalPolicy:
      parseApprovalPolicy(env?.[AGENT_DEFAULT_APPROVAL_POLICY_ENV]) || baseline.approvalPolicy,
    fileSystemPolicy:
      resolveFileSystemPolicyFromEnv(env?.[AGENT_DEFAULT_FILESYSTEM_MODE_ENV], workingDirectory) ||
      baseline.fileSystemPolicy,
    networkPolicy:
      resolveNetworkPolicyFromEnv(env?.[AGENT_DEFAULT_NETWORK_MODE_ENV]) || baseline.networkPolicy,
  };
}

function parseApprovalPolicy(raw: string | undefined) {
  const normalized = raw?.trim().toLowerCase();
  if (
    normalized === 'never' ||
    normalized === 'on-request' ||
    normalized === 'on-failure' ||
    normalized === 'unless-trusted'
  ) {
    return normalized;
  }
  return undefined;
}

function parseTrustLevel(raw: string | undefined) {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'unknown' || normalized === 'trusted' || normalized === 'untrusted') {
    return normalized;
  }
  return undefined;
}

function resolveFileSystemPolicyFromEnv(raw: string | undefined, workingDirectory?: string) {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'read-only') {
    return createReadOnlyFileSystemPolicy(workingDirectory);
  }
  if (normalized === 'workspace-write') {
    return createWorkspaceFileSystemPolicy(workingDirectory);
  }
  if (normalized === 'unrestricted') {
    return createUnrestrictedFileSystemPolicy();
  }
  return undefined;
}

function resolveNetworkPolicyFromEnv(raw: string | undefined) {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'enabled') {
    return createEnabledNetworkPolicy();
  }
  if (normalized === 'restricted') {
    return createRestrictedNetworkPolicy();
  }
  return undefined;
}

function resolveAgentAppServiceDeps(
  options: CreateEnterpriseAgentAppServiceOptions,
  agent: StatelessAgent,
  ownedStore?: SqliteAgentAppStore
): AgentAppServiceDeps {
  const sharedStore = options.store || ownedStore;
  const executionStore = options.executionStore || sharedStore;
  const eventStore = options.eventStore || sharedStore;
  const messageStore = options.messageStore || sharedStore;
  const runLogStore = options.runLogStore || sharedStore;
  const pendingInputStore = options.pendingInputStore || sharedStore;

  if (!executionStore || !eventStore) {
    throw new Error(
      'createEnterpriseAgentAppService requires either store/storePath or explicit executionStore and eventStore'
    );
  }

  return {
    agent,
    executionStore,
    eventStore,
    messageStore,
    runLogStore,
    pendingInputStore,
  };
}
