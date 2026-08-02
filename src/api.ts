import {
  BASE_RETRY_DELAY_MS,
  BASE_URL,
  MAX_RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MAX_MS,
  STREAM_IDLE_TIMEOUT_MIN_MS,
  STREAM_IDLE_TIMEOUT_MS,
} from "./constants";
import { debugLog } from "./output-channel";
import {
  NvidiaModelListResponse,
  NvidiaModelSummary,
  NvidiaNimChatRequest,
  NvidiaNimStreamResponse,
} from "./types";

/**
 * Determine whether an HTTP status code is safe to retry.
 * Retries on 429 (rate limit), 502, 503, 504 (server errors).
 * Never retries on 400, 401, 403, 404, 422 (client errors).
 */
function isRetryableHttpError(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Read Retry-After header value (seconds or HTTP-date) if present.
 */
function getRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;

  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const dateValue = Date.parse(raw);
  if (Number.isFinite(dateValue)) {
    const deltaMs = dateValue - Date.now();
    return deltaMs > 0 ? deltaMs : undefined;
  }

  return undefined;
}

/**
 * Calculate delay with exponential backoff and full jitter.
 * This prevents thundering herd when multiple clients retry simultaneously.
 */
function calculateRetryDelay(attempt: number, retryAfter?: number): number {
  if (retryAfter !== undefined && retryAfter > 0) {
    // Add jitter to server-provided retry-after (±25%)
    const jitter = retryAfter * 0.25 * (Math.random() * 2 - 1);
    return Math.min(Math.max(Math.round(retryAfter + jitter), 0), MAX_RETRY_DELAY_MS);
  }

  const exponentialDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
  // Full jitter: random delay between 0 and cappedDelay
  return Math.round(Math.random() * cappedDelay);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || !isRetryableHttpError(response.status)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      if (i < retries - 1) {
        const retryAfter = getRetryAfterMs(response);
        const delay = calculateRetryDelay(i, retryAfter);
        debugLog(
          "fetchWithRetry",
          `Attempt ${i + 1} failed with ${response.status}, retrying after ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.name === "AbortError") {
        throw lastError;
      }
      if (i < retries - 1) {
        const delay = calculateRetryDelay(i);
        debugLog(
          "fetchWithRetry",
          `Attempt ${i + 1} failed with network error, retrying after ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError ?? new Error("Network request failed after retries");
}

export async function fetchModels(
  apiKey: string,
  signal?: AbortSignal,
  userAgent?: string,
): Promise<NvidiaModelSummary[] | null> {
  try {
    const response = await fetchWithRetry(`${BASE_URL}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(userAgent ? { "User-Agent": userAgent } : {}),
      },
      signal,
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as NvidiaModelListResponse;
    return Array.isArray(data.data) ? data.data : null;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    debugLog("fetchModels", error);
    return null;
  }
}

/** 1 MB safety cap on the line assembly buffer. */
const MAX_SSE_BUFFER_SIZE = 1024 * 1024;

export async function* streamChatCompletion(
  apiKey: string,
  requestBody: NvidiaNimChatRequest,
  signal?: AbortSignal,
  userAgent?: string,
  options?: { maxOutputTokens?: number },
): AsyncGenerator<NvidiaNimStreamResponse, void, unknown> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  const response = await fetchWithRetry(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(userAgent ? { "User-Agent": userAgent } : {}),
    },
    body: JSON.stringify(requestBody),
    signal: combinedSignal,
  }).finally(() => clearTimeout(timeoutId));

  if (!response.ok) {
    const text = await response.text();
    let message: string;
    if (response.status === 401 || response.status === 403) {
      message = `[AUTH_FAILED] Authentication failed. Your API key may be invalid or expired.\n${text}`;
    } else if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      message = `[RATE_LIMITED] Rate limited.${retryAfter ? ` Retry after ${retryAfter}.` : ""}\n${text}`;
    } else if (response.status >= 500 && response.status < 600) {
      message = `[SERVER_ERROR] Server error. The NVIDIA NIM service may be experiencing issues.\n${text}`;
    } else {
      message = `NVIDIA NIM API error: ${response.status} ${response.statusText}\n${text}`;
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("No response body from NVIDIA NIM API");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const idleTimeoutMs = options?.maxOutputTokens
    ? Math.min(
        STREAM_IDLE_TIMEOUT_MAX_MS,
        Math.max(STREAM_IDLE_TIMEOUT_MIN_MS, Math.round(options.maxOutputTokens / 10) * 1000),
      )
    : STREAM_IDLE_TIMEOUT_MS;

  let buffer = "";
  let lastChunkTime = Date.now();

  function readWithTimeout() {
    return new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
      let settled = false;
      const resolveOnce = (result: Awaited<ReturnType<typeof reader.read>>) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        resolve(result);
      };
      const rejectOnce = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      };
      const timeoutId = setTimeout(() => {
        const idleSec = Math.round((Date.now() - lastChunkTime) / 1000);
        const err = new Error(`Stream idle timeout: no data for ${idleSec}s`);
        err.name = "TimeoutError";
        void reader.cancel(err).catch(() => undefined);
        rejectOnce(err);
      }, idleTimeoutMs);

      reader.read().then(
        (result) => {
          resolveOnce(result);
        },
        (error) => {
          rejectOnce(error);
        },
      );
    });
  }

  try {
    while (true) {
      const { done, value } = await readWithTimeout();
      if (done) break;

      lastChunkTime = Date.now();

      const text = decoder.decode(value, { stream: true });
      if (buffer.length + text.length > MAX_SSE_BUFFER_SIZE) {
        debugLog("streamChatCompletion", "SSE buffer exceeded 1 MB — flushing");
        buffer = "";
      }
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as NvidiaNimStreamResponse;
          yield parsed;
        } catch {
          // Ignore malformed lines
        }
      }
    }

    // Flush decoder internal state and process any remaining lines
    const remaining = decoder.decode();
    buffer += remaining;
    const finalLines = buffer.split("\n");
    for (const line of finalLines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as NvidiaNimStreamResponse;
        yield parsed;
      } catch {
        // Ignore malformed lines
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      const idleSec = Math.round((Date.now() - lastChunkTime) / 1000);
      throw new Error(
        `NVIDIA NIM streaming timeout: no data received for ${idleSec}s. The model may be stalled.`,
      );
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
