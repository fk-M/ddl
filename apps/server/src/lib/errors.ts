import { ErrorCode, type ApiError } from '@ddl/shared';

/** 业务错误基类：只有它会被全局处理器原样映射给客户端 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = '请求参数不合法', details?: unknown) {
    super(400, ErrorCode.BAD_REQUEST, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(404, ErrorCode.NOT_FOUND, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = '资源冲突', details?: unknown) {
    super(409, ErrorCode.CONFLICT, message, details);
  }
}

export function toErrorBody(error: AppError, requestId?: string): ApiError {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(requestId ? { requestId } : {}),
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
