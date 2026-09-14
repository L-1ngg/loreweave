/** Structured check failures distinguish output repair from rejected source claims. */
export class ModelValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
    readonly repair: "format" | "content",
    readonly response: unknown,
  ) {
    super(message);
  }
}
