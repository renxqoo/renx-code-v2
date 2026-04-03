#!/usr/bin/env node
/**
 * Prana 股票分析客户端
 * 
 * 使用流程:
 * 1. 调用 agent-run 执行分析
 * 2. 若返回 404 (skill not found)，自动获取付费链接并输出
 * 3. 若成功，返回分析结果
 */

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const DEFAULT_BASE_URL = "https://claw-uat.ebonex.io";
const PURCHASE_PAGE_URL = "https://claw-uat.ebonex.io/skill-payment";
const DEFAULT_SKILL_KEY = "stock_scoring_analysis_v2";
const AGENT_RUN_TIMEOUT_MS = 150000;
const AGENT_RESULT_RETRY_TIMES = 3;
const AGENT_RESULT_RETRY_INTERVAL_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(error) {
  if (!error) return false;
  return error.name === "TimeoutError" || error.name === "AbortError";
}

async function postJson(url, payload, xApiKey, timeoutMs) {
  const requestId = payload && typeof payload === "object" ? payload.request_id || "" : "";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": xApiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}: ${text}`);
    error.status = res.status;
    error.response = text;
    throw error;
  }
  return JSON.parse(text);
}

async function invokeAgentResultWithRetry(baseUrl, requestId, xApiKey) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/claw/agent-result`;
  let lastResult = { error: true, detail: "agent-result 尚未获取到结果" };

  for (let attempt = 1; attempt <= AGENT_RESULT_RETRY_TIMES; attempt += 1) {
    if (attempt > 1) {
      await sleep(AGENT_RESULT_RETRY_INTERVAL_MS);
    }
    try {
      const result = await postJson(url, { request_id: requestId }, xApiKey, AGENT_RUN_TIMEOUT_MS);
      lastResult = result;
      const status = String(result?.data?.status || "").toLowerCase();
      if (status !== "running") {
        return result;
      }
    } catch (error) {
      lastResult = { error: true, detail: `第 ${attempt} 次 agent-result 请求失败: ${error.message || error}` };
    }
  }

  return lastResult;
}

async function invokeAgentRun(baseUrl, skillKey, question, threadId, xApiKey) {
  const requestId = randomUUID();
  const url = `${baseUrl.replace(/\/+$/, "")}/api/claw/agent-run`;
  const payload = {
    skill_key: skillKey,
    question,
    thread_id: threadId,
    request_id: requestId,
  };

  try {
    return await postJson(url, payload, xApiKey, AGENT_RUN_TIMEOUT_MS);
  } catch (error) {
    if (isTimeoutError(error)) {
      return await invokeAgentResultWithRetry(baseUrl, requestId, xApiKey);
    }
    // 检查是否是 404 错误（技能未购买）
    if (error.status === 404) {
      return {
        code: 404,
        message: "skill not found",
        needs_purchase: true,
        purchase_url: PURCHASE_URL
      };
    }
    throw error;
  }
}

async function getPurchaseUrl(xApiKey) {
  try {
    const url = `${DEFAULT_BASE_URL}/api/claw/skill-purchase-url`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": xApiKey },
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (!res.ok) {
      return null;
    }
    const result = JSON.parse(text);
    if (result.code === 200 && result.data?.url) {
      return result.data.url;
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        question: { type: "string", short: "q" },
        "thread-id": { type: "string", short: "t", default: "" },
        "purchase-history": { type: "boolean", short: "p", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }

  if (values.help) {
    console.log('用法: node scripts/prana_skill_client.js -q "用户任务" [-t thread_id]');
    console.log('      node scripts/prana_skill_client.js --purchase-history');
    process.exit(0);
  }

  // 查询购买记录
  if (values["purchase-history"]) {
    const xApiKey = String(process.env.PRANA_SKILL_API_FLAG || "").trim();
    if (!xApiKey) {
      console.error("错误: 未检测到环境变量 PRANA_SKILL_API_FLAG");
      process.exit(1);
    }
    try {
      const url = `${DEFAULT_BASE_URL}/api/claw/skill-purchase-history-url`;
      const res = await fetch(url, {
        method: "GET",
        headers: { "x-api-key": xApiKey },
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const result = JSON.parse(text);
      if (result.code === 200 && result.data?.url) {
        // 动态获取购买链接
        const purchaseUrl = await getPurchaseUrl(xApiKey);
        if (purchaseUrl) {
          console.log(`[点击购买 A股多维度深度分析](${purchaseUrl})`);
        } else {
          console.log(`[点击购买 A股多维度深度分析](${PURCHASE_PAGE_URL})`);
        }
      } else {
        console.error("获取购买记录失败");
        process.exit(1);
      }
    } catch (error) {
      console.error(`获取购买记录失败: ${error.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (!values.question) {
    console.error("错误: 必须使用 -q / --question 提供用户需求任务描述。");
    process.exit(1);
  }

  const xApiKey = String(process.env.PRANA_SKILL_API_FLAG || "").trim();
  if (!xApiKey) {
    // 输出错误信息，让 SKILL.md 中的环境变量配置逻辑处理
    console.error("错误: 未检测到环境变量 PRANA_SKILL_API_FLAG");
    process.exit(1);
  }

  try {
    const result = await invokeAgentRun(
      DEFAULT_BASE_URL,
      DEFAULT_SKILL_KEY,
      values.question,
      values["thread-id"] || "",
      xApiKey,
    );

    // 检查是否需要购买技能
    if (result.needs_purchase && result.purchase_url) {
      // 输出 Markdown 格式的付费链接
      console.log(`[点击购买 A股多维度深度分析](${result.purchase_url})`);
      process.exit(0);
    }

    // 检查是否需要购买技能
    if (result.needs_purchase && result.purchase_url) {
      console.log(`[点击购买 A股多维度深度分析](${result.purchase_url})`);
      process.exit(0);
    }

    // 检查响应中的 code
    if (result.code === 404) {
      // 动态获取购买链接
      const purchaseUrl = await getPurchaseUrl(xApiKey);
      if (purchaseUrl) {
        console.log(`[点击购买 A股多维度深度分析](${purchaseUrl})`);
      } else {
        console.log(`[点击购买 A股多维度深度分析](${PURCHASE_PAGE_URL})`);
      }
      process.exit(0);
    }

    // 输出完整结果
    console.log(JSON.stringify(result, null, 2));

    // 如果有 thread_id，输出到 stderr 供上层处理
    if (result.data?.thread_id) {
      console.error(`[THREAD_ID] ${result.data.thread_id}`);
    }

  } catch (error) {
    // 如果是 404，输出 Markdown 格式的付费链接
    if (error.status === 404) {
      const purchaseUrl = await getPurchaseUrl(xApiKey);
      if (purchaseUrl) {
        console.log(`[点击购买 A股多维度深度分析](${purchaseUrl})`);
      } else {
        console.log(`[点击购买 A股多维度深度分析](${PURCHASE_PAGE_URL})`);
      }
      process.exit(0);
    }
    console.error(`请求失败: ${error.message || error}`);
    process.exit(2);
  }
}

await main();
