export class KisApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(options: {
    code: string;
    message: string;
    retryable: boolean;
    status?: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "KisApiError";
    this.code = options.code;
    this.retryable = options.retryable;
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

export function redactError(error: unknown): string {
  if (error instanceof KisApiError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
