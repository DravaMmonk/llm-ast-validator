import type { Context } from "hono";

import type { ApiErrorResponse } from "../shared/contracts";
import { REQUEST_BODY_MAX_BYTES } from "../shared/contracts";

/**
 * The only error type routes throw. `app.onError` renders it as the documented
 * envelope; anything else becomes an opaque 500 so stack traces, SQL, and local
 * paths never reach a client.
 */
export class ApiFailure extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiFailure";
  }

  toResponseBody(): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export function validationFailed(message: string, details?: unknown): ApiFailure {
  return new ApiFailure(400, "VALIDATION_FAILED", message, details);
}

/**
 * Reads a bounded JSON object body. The cap is enforced on the decoded bytes
 * rather than a client-supplied Content-Length header.
 */
export async function readJsonObject(context: Context): Promise<Record<string, unknown>> {
  const text = await context.req.text();
  if (Buffer.byteLength(text, "utf8") > REQUEST_BODY_MAX_BYTES) {
    throw new ApiFailure(
      413,
      "PAYLOAD_TOO_LARGE",
      `Request body exceeds the ${REQUEST_BODY_MAX_BYTES}-byte limit.`,
    );
  }
  if (text.trim() === "") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiFailure(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw validationFailed("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function rejectUnknownFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw validationFailed("Request contains undeclared fields.", { fields: unknown });
  }
}

export function readOptionalTitle(
  body: Record<string, unknown>,
  maxLength: number,
): string | undefined {
  if (!("title" in body)) return undefined;
  const value = body.title;
  if (typeof value !== "string") throw validationFailed("Title must be a string.");
  const title = value.trim();
  if (title.length === 0) throw validationFailed("Title must not be empty.");
  if (title.length > maxLength) {
    throw validationFailed(`Title must be at most ${maxLength} characters.`);
  }
  return title;
}
