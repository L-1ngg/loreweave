export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export function fail(code: string, status = 400): never {
  throw new AppError(code, status);
}
export async function httpBoundary(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof AppError)
      return Response.json(
        { error: error.code },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    if (error instanceof Error && error.name === "ZodError")
      return Response.json({ error: "invalid_input" }, { status: 400 });
    console.error(
      "request_failed",
      error instanceof Error ? error.name : "unknown",
    );
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
