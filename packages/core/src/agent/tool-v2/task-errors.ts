import { ToolV2Error } from './errors';

type TaskErrorCategory = 'validation' | 'not_found' | 'conflict' | 'internal';

interface TaskErrorOptions {
  readonly errorCode: string;
  readonly category: TaskErrorCategory;
  readonly details?: Record<string, unknown>;
}

function categoryToHttpStatus(category: TaskErrorCategory): number {
  switch (category) {
    case 'validation':
      return 400;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    default:
      return 500;
  }
}

function categoryToRetryable(category: TaskErrorCategory): boolean {
  return category === 'conflict';
}

export class TaskToolV2Error extends ToolV2Error {
  constructor(message: string, options: TaskErrorOptions) {
    super(message, {
      name: 'TaskToolV2Error',
      code: 3200,
      errorCode: options.errorCode,
      category: options.category,
      retryable: categoryToRetryable(options.category),
      httpStatus: categoryToHttpStatus(options.category),
      details: options.details,
    });
  }
}
