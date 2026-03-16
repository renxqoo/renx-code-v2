import { ContractError, serializeErrorContract, type ErrorContract } from '../error-contract';

export class ToolV2Error extends ContractError {
  constructor(
    message: string,
    init: Partial<{
      name: string;
      code: number;
      errorCode: string;
      category:
        | 'validation'
        | 'timeout'
        | 'abort'
        | 'permission'
        | 'not_found'
        | 'conflict'
        | 'rate_limit'
        | 'internal';
      retryable: boolean;
      httpStatus: number;
      details?: Record<string, unknown>;
    }> = {}
  ) {
    super(message, {
      module: 'tool',
      name: init.name || 'ToolV2Error',
      code: init.code || 3000,
      errorCode: init.errorCode || 'TOOL_V2_ERROR',
      category: init.category || 'internal',
      retryable: init.retryable ?? false,
      httpStatus: init.httpStatus || 500,
      details: init.details,
    });
  }
}

export class ToolV2NotFoundError extends ToolV2Error {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`, {
      name: 'ToolV2NotFoundError',
      code: 3001,
      errorCode: 'TOOL_V2_NOT_FOUND',
      category: 'not_found',
      httpStatus: 404,
      details: { toolName },
    });
  }
}

export class ToolV2ArgumentsError extends ToolV2Error {
  constructor(toolName: string, message: string) {
    super(`Invalid arguments for ${toolName}: ${message}`, {
      name: 'ToolV2ArgumentsError',
      code: 3002,
      errorCode: 'TOOL_V2_INVALID_ARGUMENTS',
      category: 'validation',
      httpStatus: 400,
      details: { toolName },
    });
  }
}

export class ToolV2PermissionError extends ToolV2Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      name: 'ToolV2PermissionError',
      code: 3003,
      errorCode: 'TOOL_V2_PERMISSION_DENIED',
      category: 'permission',
      httpStatus: 403,
      details,
    });
  }
}

export class ToolV2ValidationError extends ToolV2Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      name: 'ToolV2ValidationError',
      code: 3008,
      errorCode: 'TOOL_V2_VALIDATION_FAILED',
      category: 'validation',
      retryable: false,
      httpStatus: 400,
      details,
    });
  }
}

export class ToolV2AbortError extends ToolV2Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      name: 'ToolV2AbortError',
      code: 3009,
      errorCode: 'TOOL_V2_ABORTED',
      category: 'abort',
      retryable: true,
      httpStatus: 499,
      details,
    });
  }
}

export class ToolV2ResourceNotFoundError extends ToolV2Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      name: 'ToolV2ResourceNotFoundError',
      code: 3010,
      errorCode: 'TOOL_V2_RESOURCE_NOT_FOUND',
      category: 'not_found',
      retryable: false,
      httpStatus: 404,
      details,
    });
  }
}

export class ToolV2ApprovalDeniedError extends ToolV2Error {
  constructor(toolName: string, reason?: string) {
    super(`Approval denied for ${toolName}: ${reason || 'request denied'}`, {
      name: 'ToolV2ApprovalDeniedError',
      code: 3004,
      errorCode: 'TOOL_V2_APPROVAL_DENIED',
      category: 'permission',
      httpStatus: 403,
      details: { toolName, reason },
    });
  }
}

export class ToolV2ExecutionError extends ToolV2Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      name: 'ToolV2ExecutionError',
      code: 3005,
      errorCode: 'TOOL_V2_EXECUTION_FAILED',
      category: 'internal',
      retryable: true,
      httpStatus: 500,
      details,
    });
  }
}

export class ToolV2ConflictError extends ToolV2Error {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      name: 'ToolV2ConflictError',
      code: 3006,
      errorCode: 'TOOL_V2_CONFLICT',
      category: 'conflict',
      retryable: true,
      httpStatus: 409,
      details,
    });
  }
}

export class ToolV2PolicyDeniedError extends ToolV2Error {
  constructor(
    toolName: string,
    decision: { code?: string; message?: string; audit?: Record<string, unknown> }
  ) {
    const code = decision.code ? ` [${decision.code}]` : '';
    const reason = decision.message ? `: ${decision.message}` : '';
    super(`Tool ${toolName} blocked by policy${code}${reason}`, {
      name: 'ToolV2PolicyDeniedError',
      code: 3007,
      errorCode: 'TOOL_V2_POLICY_DENIED',
      category: 'permission',
      retryable: false,
      httpStatus: 403,
      details: {
        toolName,
        reasonCode: decision.code,
        audit: decision.audit,
      },
    });
  }
}

export function toToolErrorContract(error: unknown): ErrorContract {
  return serializeErrorContract(error, {
    module: 'tool',
    code: 3099,
    errorCode: 'TOOL_V2_UNKNOWN_ERROR',
    category: 'internal',
    retryable: false,
    httpStatus: 500,
  });
}
