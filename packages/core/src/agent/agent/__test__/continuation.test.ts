import { describe, expect, it } from 'vitest';

import type { Message } from '../../types';
import { buildLLMRequestPlan, applyContinuationMetadata } from '../continuation';
import { hashValueForContinuation, normalizeContinuationConfig } from '../continuation-hash';
import { mergeLLMRequestConfig } from '../llm-request-config';
import { readContinuationMetadata } from '../continuation-metadata';
import { convertMessageToLLMMessage } from '../message-utils';

function createMessage(partial: Partial<Message>): Message {
  return {
    messageId: partial.messageId || crypto.randomUUID(),
    type: partial.type || 'assistant-text',
    role: partial.role || 'assistant',
    content: partial.content || '',
    timestamp: partial.timestamp ?? Date.now(),
    ...partial,
  };
}

describe('continuation', () => {
  it('builds a full request plan when continuation is disabled', () => {
    const messages = [
      createMessage({
        messageId: 'u1',
        role: 'user',
        type: 'user',
        content: 'hello',
      }),
    ];

    const plan = buildLLMRequestPlan(messages, { temperature: 0.1 }, false);

    expect(plan.continuationMode).toBe('full');
    expect(plan.requestMessages).toHaveLength(1);
    expect(plan.previousResponseIdUsed).toBeUndefined();
    expect(plan.continuationDeltaMessageCount).toBe(1);
    expect(plan.toolProtocolRepairStats).toEqual({
      syntheticToolResultCount: 0,
      droppedOrphanToolResultCount: 0,
    });
  });

  it('builds an incremental request plan when the assistant metadata matches the previous request', () => {
    const config = { temperature: 0.2 };
    const previousUser = createMessage({
      messageId: 'u1',
      role: 'user',
      type: 'user',
      content: 'first request',
    });
    const assistant = createMessage({
      messageId: 'a1',
      role: 'assistant',
      type: 'assistant-text',
      content: 'first answer',
    });
    const latestUser = createMessage({
      messageId: 'u2',
      role: 'user',
      type: 'user',
      content: 'follow-up',
    });

    const requestMessages = [convertMessageToLLMMessage(previousUser)];
    const assistantResponse = convertMessageToLLMMessage(assistant);
    assistant.metadata = {
      responseId: 'resp_1',
      llmRequestConfigHash: hashValueForContinuation(normalizeContinuationConfig(config)),
      llmRequestInputHash: hashValueForContinuation(requestMessages),
      llmRequestInputMessageCount: requestMessages.length,
      llmResponseMessageHash: hashValueForContinuation(assistantResponse),
    };

    const plan = buildLLMRequestPlan([previousUser, assistant, latestUser], config, true);

    expect(plan.continuationMode).toBe('incremental');
    expect(plan.previousResponseIdUsed).toBe('resp_1');
    expect(plan.continuationBaselineMessageCount).toBe(2);
    expect(plan.continuationDeltaMessageCount).toBe(1);
    expect(plan.requestMessages).toEqual([convertMessageToLLMMessage(latestUser)]);
    expect(plan.requestConfig).toMatchObject({
      temperature: 0.2,
      previous_response_id: 'resp_1',
    });
  });

  it('reuses a matching baseline when previous_response_id is explicitly provided', () => {
    const config = {
      temperature: 0.2,
      previous_response_id: 'resp_1',
    };
    const previousUser = createMessage({
      messageId: 'u1',
      role: 'user',
      type: 'user',
      content: 'first request',
    });
    const assistant = createMessage({
      messageId: 'a1',
      role: 'assistant',
      type: 'assistant-text',
      content: 'first answer',
    });
    const latestUser = createMessage({
      messageId: 'u2',
      role: 'user',
      type: 'user',
      content: 'follow-up',
    });

    const baselineConfig = { temperature: 0.2 };
    const requestMessages = [convertMessageToLLMMessage(previousUser)];
    assistant.metadata = {
      responseId: 'resp_1',
      llmRequestConfigHash: hashValueForContinuation(normalizeContinuationConfig(baselineConfig)),
      llmRequestInputHash: hashValueForContinuation(requestMessages),
      llmRequestInputMessageCount: requestMessages.length,
      llmResponseMessageHash: hashValueForContinuation(convertMessageToLLMMessage(assistant)),
    };

    const plan = buildLLMRequestPlan([previousUser, assistant, latestUser], config, true);

    expect(plan.continuationMode).toBe('incremental');
    expect(plan.previousResponseIdUsed).toBe('resp_1');
    expect(plan.continuationBaselineMessageCount).toBe(2);
    expect(plan.continuationDeltaMessageCount).toBe(1);
    expect(plan.requestMessages).toEqual([convertMessageToLLMMessage(latestUser)]);
    expect(plan.requestConfig).toMatchObject({
      temperature: 0.2,
      previous_response_id: 'resp_1',
    });
  });

  it('stores continuation metadata back onto the assistant message', () => {
    const assistant = createMessage({
      messageId: 'a1',
      role: 'assistant',
      type: 'assistant-text',
      content: 'done',
      metadata: {
        responseId: 'resp_1',
      },
    });
    const plan = buildLLMRequestPlan(
      [
        createMessage({
          messageId: 'u1',
          role: 'user',
          type: 'user',
          content: 'hello',
        }),
      ],
      { temperature: 0.1 },
      false
    );

    applyContinuationMetadata(assistant, plan);
    const metadata = readContinuationMetadata(assistant);

    expect(metadata).toMatchObject({
      llmRequestConfigHash: plan.requestConfigHash,
      llmRequestInputHash: plan.requestInputHash,
      llmRequestInputMessageCount: plan.requestInputMessageCount,
      llmResponseMessageHash: expect.any(String),
    });
    expect(assistant.metadata).toMatchObject({
      continuationMode: 'full',
      continuationDeltaMessageCount: 1,
    });
  });

  it('ignores malformed continuation metadata records', () => {
    const assistant = createMessage({
      messageId: 'a1',
      role: 'assistant',
      type: 'assistant-text',
      content: 'done',
      metadata: {
        responseId: 'resp_1',
        llmRequestConfigHash: 'cfg',
        llmRequestInputHash: 'input',
        llmRequestInputMessageCount: -1,
        llmResponseMessageHash: 'resp',
      },
    });

    expect(readContinuationMetadata(assistant)).toBeUndefined();
  });

  it('falls back to an older reusable assistant baseline when the latest assistant is not reusable', () => {
    const config = { temperature: 0.2, prompt_cache_key: 'conv_1' };
    const firstUser = createMessage({
      messageId: 'u1',
      role: 'user',
      type: 'user',
      content: 'first request',
    });
    const firstAssistant = createMessage({
      messageId: 'a1',
      role: 'assistant',
      type: 'assistant-text',
      content: 'first answer',
    });
    const secondUser = createMessage({
      messageId: 'u2',
      role: 'user',
      type: 'user',
      content: 'second request',
    });
    const secondAssistant = createMessage({
      messageId: 'a2',
      role: 'assistant',
      type: 'assistant-text',
      content: 'second answer',
      metadata: {
        responseId: 'resp_broken',
        llmRequestConfigHash: 'wrong',
        llmRequestInputHash: 'wrong',
        llmRequestInputMessageCount: 999,
        llmResponseMessageHash: 'wrong',
      },
    });
    const latestUser = createMessage({
      messageId: 'u3',
      role: 'user',
      type: 'user',
      content: 'follow-up',
    });

    const firstRequestMessages = [convertMessageToLLMMessage(firstUser)];
    firstAssistant.metadata = {
      responseId: 'resp_1',
      llmRequestConfigHash: hashValueForContinuation(normalizeContinuationConfig(config)),
      llmRequestInputHash: hashValueForContinuation(firstRequestMessages),
      llmRequestInputMessageCount: firstRequestMessages.length,
      llmResponseMessageHash: hashValueForContinuation(convertMessageToLLMMessage(firstAssistant)),
    };

    const plan = buildLLMRequestPlan(
      [firstUser, firstAssistant, secondUser, secondAssistant, latestUser],
      config,
      true
    );

    expect(plan.continuationMode).toBe('incremental');
    expect(plan.previousResponseIdUsed).toBe('resp_1');
    expect(plan.continuationBaselineMessageCount).toBe(2);
    expect(plan.requestMessages).toEqual([
      convertMessageToLLMMessage(secondUser),
      convertMessageToLLMMessage(secondAssistant),
      convertMessageToLLMMessage(latestUser),
    ]);
  });

  it('merges prompt_cache_key from conversation id only when caller does not provide one', () => {
    expect(
      mergeLLMRequestConfig({ temperature: 0.2 }, undefined, undefined, 'conv_1')
    ).toMatchObject({
      temperature: 0.2,
      prompt_cache_key: 'conv_1',
    });

    expect(
      mergeLLMRequestConfig(
        { temperature: 0.2, prompt_cache_key: 'explicit-cache' },
        undefined,
        undefined,
        'conv_1'
      )
    ).toMatchObject({
      temperature: 0.2,
      prompt_cache_key: 'explicit-cache',
    });
  });

  it('repairs missing tool results in full request plans before sending to the LLM', () => {
    const toolCallAssistant = createMessage({
      messageId: 'a_tool',
      role: 'assistant',
      type: 'tool-call',
      content: '',
      timestamp: 100,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
      ],
    });
    const latestUser = createMessage({
      messageId: 'u2',
      role: 'user',
      type: 'user',
      content: 'follow-up',
      timestamp: 200,
    });

    const plan = buildLLMRequestPlan([toolCallAssistant, latestUser], { temperature: 0.2 }, false);

    expect(plan.requestMessages).toHaveLength(3);
    expect(plan.requestMessages[0]).toEqual(convertMessageToLLMMessage(toolCallAssistant));
    expect(plan.requestMessages[1]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      content: expect.stringContaining('tool result missing'),
    });
    expect(plan.requestMessages[2]).toEqual(convertMessageToLLMMessage(latestUser));
    expect(plan.toolProtocolRepairStats).toEqual({
      syntheticToolResultCount: 1,
      droppedOrphanToolResultCount: 0,
    });
  });

  it('repairs missing tool results in incremental continuation deltas', () => {
    const config = { temperature: 0.2 };
    const previousUser = createMessage({
      messageId: 'u1',
      role: 'user',
      type: 'user',
      content: 'first request',
    });
    const previousAssistant = createMessage({
      messageId: 'a1',
      role: 'assistant',
      type: 'assistant-text',
      content: 'first answer',
    });
    const toolCallAssistant = createMessage({
      messageId: 'a_tool',
      role: 'assistant',
      type: 'tool-call',
      content: '',
      timestamp: 100,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
      ],
    });
    const latestUser = createMessage({
      messageId: 'u2',
      role: 'user',
      type: 'user',
      content: 'follow-up',
      timestamp: 200,
    });

    const requestMessages = [convertMessageToLLMMessage(previousUser)];
    previousAssistant.metadata = {
      responseId: 'resp_1',
      llmRequestConfigHash: hashValueForContinuation(normalizeContinuationConfig(config)),
      llmRequestInputHash: hashValueForContinuation(requestMessages),
      llmRequestInputMessageCount: requestMessages.length,
      llmResponseMessageHash: hashValueForContinuation(
        convertMessageToLLMMessage(previousAssistant)
      ),
    };

    const plan = buildLLMRequestPlan(
      [previousUser, previousAssistant, toolCallAssistant, latestUser],
      config,
      true
    );

    expect(plan.continuationMode).toBe('incremental');
    expect(plan.requestMessages).toHaveLength(3);
    expect(plan.requestMessages[0]).toEqual(convertMessageToLLMMessage(toolCallAssistant));
    expect(plan.requestMessages[1]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      content: expect.stringContaining('tool result missing'),
    });
    expect(plan.requestMessages[2]).toEqual(convertMessageToLLMMessage(latestUser));
    expect(plan.toolProtocolRepairStats).toEqual({
      syntheticToolResultCount: 1,
      droppedOrphanToolResultCount: 0,
    });
  });
});
