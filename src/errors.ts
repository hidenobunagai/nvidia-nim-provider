/**
 * Error classification that does not rely on `instanceof`.
 *
 * Aborts and timeouts arrive as `DOMException`, and `DOMException` does not always extend
 * `Error`: Node installs one that does, while Jest's node environment installs one that does
 * not (measured on Node 22: `Error.prototype.isPrototypeOf(DOMException.prototype)` is `true`
 * outside Jest and `false` inside it). A guard written as
 * `error instanceof Error && error.name === "AbortError"` therefore takes a different path in
 * production and under test — in the Jest realm the abort fails the `instanceof` test, so it is
 * retried, swallowed, or reported as a generic failure instead of a cancellation.
 *
 * The helpers below read `name` (and `message`) off anything that carries one, so the same
 * error is classified the same way in both realms.
 */

export const ABORT_ERROR_NAME = "AbortError";
export const TIMEOUT_ERROR_NAME = "TimeoutError";

/** The `name` of a thrown value, when it is a string (`Error` and `DOMException` both qualify). */
function nameOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return undefined;
  }
  const { name } = error as { name?: unknown };
  return typeof name === "string" ? name : undefined;
}

/**
 * True for a cancellation: the abort signal fired (ours or the caller's).
 *
 * Deliberately name-based — see the module comment for why `instanceof Error` cannot be used.
 */
export function isAbortError(error: unknown): boolean {
  return nameOf(error) === ABORT_ERROR_NAME;
}

/** True for our own timeout errors, which carry `name = "TimeoutError"`. */
export function isTimeoutError(error: unknown): boolean {
  return nameOf(error) === TIMEOUT_ERROR_NAME;
}

/**
 * A message for user-visible text, without losing `DOMException` messages to `[object Object]`.
 *
 * `fallback` is used when nothing readable can be derived (e.g. `throw undefined`).
 */
export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
    const name = nameOf(error);
    if (name) {
      return name;
    }
  }
  return fallback;
}

/** A fresh cancellation error, for the case where the abort reason itself is not throwable. */
export function abortError(message = "The operation was aborted"): Error {
  const error = new Error(message);
  error.name = ABORT_ERROR_NAME;
  return error;
}

/**
 * The cancellation to throw for an aborted signal.
 *
 * Keeps the signal's own reason when it is already an abort (that is the `DOMException` real
 * `fetch` produces, so the original error object survives), and otherwise builds a named
 * `AbortError` from it — `abort()` with no argument leaves `reason` undefined, and a reason that
 * is a plain string would not be recognizable as a cancellation downstream.
 */
export function abortReasonOf(signal?: AbortSignal | null): Error {
  const reason: unknown = signal?.reason;
  if (isAbortError(reason)) {
    return reason as Error;
  }
  if (reason === undefined || reason === null) {
    return abortError();
  }
  const error = new Error(errorMessage(reason, String(reason)));
  error.name = ABORT_ERROR_NAME;
  return error;
}

/** Normalize a thrown value to an `Error`, keeping its message and `name` when it has them. */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  const wrapped = new Error(errorMessage(error, String(error)));
  const name = nameOf(error);
  if (name) {
    wrapped.name = name;
  }
  return wrapped;
}
