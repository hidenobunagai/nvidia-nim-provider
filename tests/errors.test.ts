import {
  ABORT_ERROR_NAME,
  TIMEOUT_ERROR_NAME,
  abortError,
  abortReasonOf,
  errorMessage,
  isAbortError,
  isTimeoutError,
  toError,
} from "../src/errors";

describe("abort and timeout detection across realms", () => {
  it("classifies a real AbortSignal reason as an abort", () => {
    const controller = new AbortController();
    controller.abort();

    // The regression this guards: in Jest's node environment `signal.reason` is a DOMException
    // that does NOT extend Error, so an `instanceof Error` guard would reject it here while
    // accepting it in production Node.
    expect(controller.signal.reason).not.toBeInstanceOf(Error);
    expect(isAbortError(controller.signal.reason)).toBe(true);
  });

  it("classifies abort-like values by name, whatever their prototype", () => {
    const named = new Error("stopped");
    named.name = ABORT_ERROR_NAME;

    expect(isAbortError(named)).toBe(true);
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError({ name: ABORT_ERROR_NAME })).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError({ name: 42 })).toBe(false);
  });

  it("keeps timeouts distinct from aborts so the two are not confused", () => {
    const timeout = new Error("too slow");
    timeout.name = TIMEOUT_ERROR_NAME;

    expect(isTimeoutError(timeout)).toBe(true);
    expect(isAbortError(timeout)).toBe(false);
    expect(isAbortError(abortError())).toBe(true);
    expect(isTimeoutError(abortError())).toBe(false);
  });

  it("turns an aborted signal into a named AbortError", () => {
    const withMessage = new AbortController();
    withMessage.abort(new Error("user pressed stop"));
    const fromMessage = abortReasonOf(withMessage.signal);
    expect(fromMessage.name).toBe(ABORT_ERROR_NAME);
    expect(fromMessage.message).toBe("user pressed stop");

    // abort() with no argument leaves `reason` undefined; the result must still be recognizable.
    const bare = new AbortController();
    bare.abort();
    expect(abortReasonOf(bare.signal).name).toBe(ABORT_ERROR_NAME);

    expect(abortReasonOf(undefined).name).toBe(ABORT_ERROR_NAME);
    expect(abortReasonOf(null).name).toBe(ABORT_ERROR_NAME);
  });

  it("preserves the signal's own AbortError object", () => {
    const controller = new AbortController();
    controller.abort();
    const reason = controller.signal.reason;

    expect(abortReasonOf(controller.signal)).toBe(reason);
  });

  it("extracts a message from anything, including DOMException", () => {
    const controller = new AbortController();
    controller.abort();

    expect(errorMessage(controller.signal.reason)).toBe("This operation was aborted");
    expect(errorMessage(new Error("plain"))).toBe("plain");
    expect(errorMessage("string value")).toBe("string value");
    expect(errorMessage({ name: "Weird" })).toBe("Weird");

    // Nothing readable to derive: the fallback is used rather than "undefined" / "[object Object]".
    expect(errorMessage(undefined)).toBe("Unknown error");
    expect(errorMessage(null)).toBe("Unknown error");
    expect(errorMessage({})).toBe("Unknown error");
    expect(errorMessage(undefined, "fallback text")).toBe("fallback text");
  });

  it("normalizes unknown thrown values without losing name or message", () => {
    const original = new Error("keep me");
    expect(toError(original)).toBe(original);

    const domLike = { name: ABORT_ERROR_NAME, message: "This operation was aborted" };
    const wrapped = toError(domLike);
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.name).toBe(ABORT_ERROR_NAME);
    expect(wrapped.message).toBe("This operation was aborted");
    expect(isAbortError(wrapped)).toBe(true);

    expect(toError("thrown string").message).toBe("thrown string");
    expect(toError(undefined).message).toBe("undefined");
    expect(toError(null).message).toBe("null");
  });
});
