/** An error with a status code, a stable machine code and a message a person can read. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}
