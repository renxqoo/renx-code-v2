/**
 * @renx-code/weixin-agent
 *
 * Standalone WeChat agent application.
 *
 * Lifecycle:
 *   1. Initialize LLM provider + agent runtime from @renx-code/core
 *   2. QR code login via @renx-code/weixin-adapter
 *   3. Start long-poll monitor (startWeixinMonitor)
 *   4. On each inbound message → run agent → send reply back
 *
 * Each WeChat peer gets their own conversationId so the agent retains
 * per-user conversation context across messages.
 */

import {
  startWeixinLoginWithQr,
  waitForWeixinLogin,
  startWeixinMonitor,
  normalizeAccountId,
  saveAccount,
  registerAccountId,
  resolveAccount,
  getFirstConfiguredAccount,
  sendMessageWeixin,
  getContextToken,
  setContextToken,
  setLogLevel,
  type WeixinInboundEvent,
} from "../../weixin-adapter/src/index";
import {
  ProviderRegistry,
  createEnterpriseAgentAppService,
  loadEnvFiles,
  resolveRenxDatabasePath,
  type EnterpriseAgentAppComposition,
} from "../../core/src/index";
// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
import dotenv from 'dotenv';
dotenv.config();
const MODEL_ID ="glm-5.1";
const MAX_STEPS = parseInt(process.env.WEIXIN_AGENT_MAX_STEPS || "300000", 10);
const QR_TIMEOUT_MS = parseInt(process.env.WEIXIN_AGENT_QR_TIMEOUT || "300000", 10);
const LOG_LEVEL = (process.env.WEIXIN_AGENT_LOG_LEVEL || "debug") as "debug" | "info" | "warn" | "error";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level: string, msg: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (level === "error") {
    console.error(prefix, msg, ...args);
  } else if (level === "warn") {
    console.warn(prefix, msg, ...args);
  } else {
    console.log(prefix, msg, ...args);
  }
}

// ---------------------------------------------------------------------------
// Step 1: Initialize agent runtime
// ---------------------------------------------------------------------------

async function initAgent(workspaceRoot: string): Promise<EnterpriseAgentAppComposition> {
  await loadEnvFiles(workspaceRoot);

  const modelId = MODEL_ID || ProviderRegistry.getModelIds()[0];
  if (!modelId) {
    throw new Error("No model configured. Set WEIXIN_AGENT_MODEL or AGENT_MODEL env var.");
  }

  const provider = ProviderRegistry.createFromEnv(modelId);
  const storePath = resolveRenxDatabasePath(process.env);

  log("info", `Initializing agent with model=${modelId}`);
 
  const composition = createEnterpriseAgentAppService({
    llmProvider: provider,
    projectRoot: workspaceRoot,
    env: process.env,
    storePath,
    toolExecutorOptions: {
      workingDirectory: workspaceRoot,
      fileSystemPolicy: { mode: "unrestricted", readRoots: [], writeRoots: [] },
      networkPolicy: { mode: "enabled", allowedHosts: [], deniedHosts: [] },
      approvalPolicy: "unless-trusted",
      trustLevel: "trusted",
    },
  
    agentConfig: {
      maxRetryCount: 10,
      enableCompaction: true,
    },
  });

  const preparable = composition.store as typeof composition.store & {
    prepare?: () => Promise<void>;
  };
  if (typeof preparable.prepare === "function") {
    await preparable.prepare();
  }

  log("info", `Agent initialized. model=${modelId} store=${storePath}`);
  return composition;
}

// ---------------------------------------------------------------------------
// Step 2: QR code login
// ---------------------------------------------------------------------------

async function ensureLoggedIn(): Promise<string> {
  // Check for existing configured account first
  const existing = getFirstConfiguredAccount();
  if (existing) {
    log("info", `Found existing account: ${existing.accountId}`);
    return existing.accountId;
  }

  log("info", "No configured account found. Starting QR login...");

  // Step 2a: Get QR code
  const startResult = await startWeixinLoginWithQr({});
  if (!startResult.qrcodeUrl) {
    throw new Error(`Failed to get QR code: ${startResult.message}`);
  }

  log("info", "Scan this QR code with WeChat:");
  log("info", `QR URL: ${startResult.qrcodeUrl}`);

  // Step 2b: Wait for scan
  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    timeoutMs: QR_TIMEOUT_MS,
  });

  if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId) {
    throw new Error(`Login failed: ${waitResult.message}`);
  }

  // Step 2c: Save account
  const accountId = normalizeAccountId(waitResult.accountId);
  saveAccount(accountId, {
    token: waitResult.botToken,
    baseUrl: waitResult.baseUrl,
    userId: waitResult.userId,
  });
  registerAccountId(accountId);

  log("info", `Login successful! accountId=${accountId}`);
  return accountId;
}

// ---------------------------------------------------------------------------
// Step 3: Run agent for a single message and return the text reply
// ---------------------------------------------------------------------------

async function runAgentForMessage(
  app: EnterpriseAgentAppComposition,
  conversationId: string,
  userText: string,
): Promise<string> {
  log("info", `runAgentForMessage: conversationId=${conversationId} text=${userText.substring(0, 80)}`);

  let result;
  try {
    result = await app.appService.runForeground({
      conversationId,
      userInput: userText,
      maxSteps: MAX_STEPS,
    });
  } catch (err) {
    log("error", `runForeground failed: ${String(err)}`);
    return "";
  }

  log("info", `runForeground completed: finishReason=${result.finishReason} steps=${result.steps} messages=${result.messages.length}`);

  // Log error details if finishReason is error
  if (result.finishReason === 'error') {
    for (const evt of result.events) {
      if (evt.eventType === 'error') {
        log("error", `Agent error event: ${JSON.stringify(evt.data)}`);
      }
    }
  }

  // Log all messages for debugging
  for (let i = 0; i < result.messages.length; i++) {
    const msg = result.messages[i];
    const contentPreview = typeof msg.content === "string" ? msg.content.substring(0, 120) : JSON.stringify(msg.content)?.substring(0, 120);
    log("debug", `  msg[${i}] role=${msg.role} type=${msg.type} content=${contentPreview}`);
  }

  // Extract the last assistant text message
  for (let i = result.messages.length - 1; i >= 0; i--) {
    const msg = result.messages[i];
    if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.trim()) {
      return msg.content.trim();
    }
  }

  log("warn", `No assistant text message found in ${result.messages.length} messages`);
  return "";
}

// ---------------------------------------------------------------------------
// Step 4: Send reply back via WeChat
// ---------------------------------------------------------------------------

async function sendReply(
  accountId: string,
  fromUserId: string,
  text: string,
): Promise<void> {
  const account = resolveAccount(accountId);
  if (!account.token) {
    log("error", `Cannot send reply: account ${accountId} has no token`);
    return;
  }

  const contextToken = getContextToken(accountId, fromUserId);

  try {
    await sendMessageWeixin({
      to: fromUserId,
      text,
      opts: {
        baseUrl: account.baseUrl,
        token: account.token,
        contextToken,
      },
    });
    log("info", `Reply sent to ${fromUserId} (${text.length} chars)`);
  } catch (err) {
    log("error", `Failed to send reply to ${fromUserId}: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Step 5: Start monitor and dispatch inbound messages to agent
// ---------------------------------------------------------------------------

async function startMessageLoop(
  app: EnterpriseAgentAppComposition,
  accountId: string,
): Promise<void> {
  const account = resolveAccount(accountId);
  if (!account.token) {
    throw new Error(`Account ${accountId} is not configured`);
  }

  log("info", `Starting message monitor for account ${accountId}...`);

  // Track in-flight agent runs per user to avoid double-processing
  const inFlight = new Map<string, Promise<void>>();

  await startWeixinMonitor({
    baseUrl: account.baseUrl,
    token: account.token,
    accountId,
    onMessage: async (event: WeixinInboundEvent) => {
      const { body, fromUserId } = event;
      if (!body || !body.trim()) {
        return; // skip empty messages
      }

      log("info", `Inbound message from ${fromUserId}: ${body.substring(0, 100)}`);

      // Save context token from the inbound message
      if (event.contextToken && fromUserId) {
        setContextToken(accountId, fromUserId, event.contextToken);
      }

      // One conversation per WeChat peer
      const conversationId = `weixin:${accountId}:${fromUserId}`;

      // Deduplicate: if this user already has an in-flight run, queue behind it
      const previous = inFlight.get(fromUserId);
      const run = (previous || Promise.resolve())
        .then(() => runAgentForMessage(app, conversationId, body))
        .then(async (reply) => {
          if (reply) {
            await sendReply(accountId, fromUserId, reply);
          } else {
            log("warn", `No reply generated for message from ${fromUserId}`);
          }
        })
        .catch((err) => {
          log("error", `Agent run failed for ${fromUserId}: ${String(err)}`);
        })
        .finally(() => {
          if (inFlight.get(fromUserId) === run) {
            inFlight.delete(fromUserId);
          }
        });

      inFlight.set(fromUserId, run);
    },
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  setLogLevel(LOG_LEVEL);

  const workspaceRoot = process.cwd();
  log("info", "=== renx-code WeChat Agent ===");
  log("info", `Workspace: ${workspaceRoot}`);

  // 1. Initialize agent runtime
  const app = await initAgent(workspaceRoot);

  // 2. QR login (or reuse existing account)
  const accountId = await ensureLoggedIn();

  // 3. Start message loop (blocks forever)
  log("info", "Agent ready. Waiting for WeChat messages...");
  await startMessageLoop(app, accountId);
}

main().catch((err) => {
  log("error", `Fatal error: ${String(err)}`);
  process.exit(1);
});
