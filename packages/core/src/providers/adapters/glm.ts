import { StandardAdapter } from './standard';
import type { LLMRequest } from '../types';

/**
 * GLM API 适配器
 *
 * 支持智谱 chat.completions 的 thinking 开关：
 * `thinking: { type: 'enabled' | 'disabled' }`
 */
export class GLMAdapter extends StandardAdapter {
  constructor(options: { endpointPath?: string; defaultModel?: string } = {}) {
    super(options);
  }

  transformRequest(options?: LLMRequest): Record<string, unknown> {
    const body = super.transformRequest(options);

    if (typeof options?.thinking === 'boolean') {
      body.thinking = {
        type: options.thinking ? 'enabled' : 'disabled',
      };
    }

    return body;
  }
}
