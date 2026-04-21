export type HttpErrorOptions = {
  code?: string;
  detail?: string;
  data?: unknown;
  expose?: boolean;
  cause?: unknown;
};

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly detail?: string;
  readonly data?: unknown;
  readonly expose: boolean;

  constructor(
    statusCode: number,
    message: string,
    options: HttpErrorOptions = {},
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = options.code;
    this.detail = options.detail;
    this.data = options.data;
    this.expose = options.expose ?? statusCode < 500;

    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
