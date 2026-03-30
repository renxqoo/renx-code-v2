export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
}

export function formatApiError(error: ApiError): { status: number; body: { error: ApiError } } {
  return {
    status: error.status,
    body: { error },
  };
}

export function internalError(message: string): ApiError {
  return { code: 'INTERNAL_ERROR', message, status: 500 };
}

export function unauthorizedError(message: string): ApiError {
  return { code: 'UNAUTHORIZED', message, status: 401 };
}

export function notFoundError(message: string): ApiError {
  return { code: 'NOT_FOUND', message, status: 404 };
}

export function validationError(message: string): ApiError {
  return { code: 'VALIDATION_ERROR', message, status: 400 };
}
