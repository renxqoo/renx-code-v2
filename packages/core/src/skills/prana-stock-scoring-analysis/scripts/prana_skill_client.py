#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import uuid
import urllib.error
import urllib.request
from typing import Any, Dict

DEFAULT_BASE_URL = "https://claw-uat.ebonex.io"
DEFAULT_SKILL_KEY = "stock_scoring_analysis_v2"
AGENT_RUN_TIMEOUT_SEC = 150
AGENT_RESULT_RETRY_TIMES = 3
AGENT_RESULT_RETRY_INTERVAL_SEC = 10


def _headers(x_api_key: str) -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        "x-api-key": x_api_key,
    }


def _post_json(url: str, payload: Dict[str, Any], x_api_key: str, timeout: int) -> Dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request_id = payload.get("request_id", "") if isinstance(payload, dict) else ""
    print(f"[HTTP REQUEST] request_id={request_id}", file=sys.stderr)
    req = urllib.request.Request(
        url=url,
        data=data,
        method="POST",
        headers=_headers(x_api_key),
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _is_timeout_error(exc: BaseException) -> bool:
    if isinstance(exc, TimeoutError):
        return True
    if isinstance(exc, socket.timeout):
        return True
    if isinstance(exc, urllib.error.URLError):
        return isinstance(exc.reason, socket.timeout)
    return False


def invoke_agent_result_with_retry(base_url: str, request_id: str, x_api_key: str) -> Dict[str, Any]:
    url = base_url.rstrip("/") + "/api/claw/agent-result"
    last_result: Dict[str, Any] = {"error": True, "detail": "agent-result 尚未获取到结果"}
    for attempt in range(1, AGENT_RESULT_RETRY_TIMES + 1):
        if attempt > 1:
            time.sleep(AGENT_RESULT_RETRY_INTERVAL_SEC)
        try:
            result = _post_json(
                url=url,
                payload={"request_id": request_id},
                x_api_key=x_api_key,
                timeout=AGENT_RUN_TIMEOUT_SEC,
            )
            last_result = result
            data = result.get("data") if isinstance(result, dict) else None
            status = str((data or {}).get("status", "")).lower() if isinstance(data, dict) else ""
            if status != "running":
                return result
        except Exception as exc:  # noqa: BLE001
            last_result = {"error": True, "detail": f"第 {attempt} 次 agent-result 请求失败: {exc}"}
    return last_result


def invoke_agent_run(base_url: str, skill_key: str, question: str, thread_id: str, x_api_key: str) -> Dict[str, Any]:
    request_id = str(uuid.uuid4())
    run_url = base_url.rstrip("/") + "/api/claw/agent-run"
    run_payload = {
        "skill_key": skill_key,
        "question": question,
        "thread_id": thread_id,
        "request_id": request_id,
    }
    try:
        return _post_json(
            url=run_url,
            payload=run_payload,
            x_api_key=x_api_key,
            timeout=AGENT_RUN_TIMEOUT_SEC,
        )
    except Exception as exc:  # noqa: BLE001
        if _is_timeout_error(exc):
            return invoke_agent_result_with_retry(base_url, request_id, x_api_key)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "调用 Prana 技能接口。参数参考 SKILL.md："
            "question=用户需求任务，thread_id=首次传空、后续传上一轮返回的 thread_id。"
        )
    )
    parser.add_argument("--question", "-q", required=True, help="用户需求任务描述，例如：帮我分析茅台股票的技术指标")
    parser.add_argument("--thread-id", "-t", default="", help="会话ID；首次调用传空，后续传上一轮返回的 thread_id")
    args = parser.parse_args()

    x_api_key = os.getenv("PRANA_SKILL_API_FLAG", "").strip()
    if not x_api_key:
        print("错误: 未检测到环境变量 PRANA_SKILL_API_FLAG。", file=sys.stderr)
        sys.exit(1)

    try:
        result = invoke_agent_run(
            base_url=DEFAULT_BASE_URL,
            skill_key=DEFAULT_SKILL_KEY,
            question=args.question,
            thread_id=args.thread_id,
            x_api_key=x_api_key,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"HTTP {exc.code}: {body}", file=sys.stderr)
        sys.exit(2)
    except Exception as exc:  # noqa: BLE001
        print(f"请求失败: {exc}", file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
