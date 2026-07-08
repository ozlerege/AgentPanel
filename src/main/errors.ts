import type { AppError } from '../shared/ipc'

interface AppOperationErrorOptions {
  path?: string
  changed?: boolean
  recovery?: string
}

export class AppOperationError extends Error {
  constructor(
    readonly code: AppError['code'],
    readonly operation: string,
    message: string,
    private readonly options: AppOperationErrorOptions = {}
  ) {
    super(message)
    this.name = 'AppOperationError'
  }

  toAppError(): AppError {
    return {
      code: this.code,
      operation: this.operation,
      message: this.message,
      path: this.options.path,
      changed: this.options.changed ?? false,
      recovery: this.options.recovery
    }
  }
}

export function toAppError(operation: string, error: unknown): AppError {
  if (error instanceof AppOperationError) return error.toAppError()
  return {
    code: 'internal',
    operation,
    message: error instanceof Error ? error.message : String(error),
    changed: false
  }
}
