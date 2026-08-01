export class NetworkStageError extends Error {
  constructor(
    message,
    {
      stage,
      code,
      httpStatus,
      retryable = false,
      submissionUnknown = false,
      details
    } = {}
  ) {
    super(message);
    this.name = 'NetworkStageError';
    this.stage = stage;
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.submissionUnknown = submissionUnknown;
    this.details = details;
  }
}

export async function fetchWithTimeout({
  fetchImpl = globalThis.fetch,
  url,
  options = {},
  timeoutMs
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const isMutating = options.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method.toUpperCase());
      throw new NetworkStageError('Request timed out', { 
        code: 'REQUEST_TIMEOUT', 
        retryable: true,
        submissionUnknown: isMutating
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function isRetryableHttpStatus(status) {
    return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

export function isRetryableNetworkError(error) {
    if (!error) return false;
    const code = error.code;
    return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) || error.message?.includes('fetch') || error.name === 'AbortError';
}

export function normalizeNetworkError(error, stage) {
    if (error instanceof NetworkStageError) return error;
    const retryable = isRetryableNetworkError(error);
    return new NetworkStageError(error.message, {
        stage,
        code: error.code || 'NETWORK_ERROR',
        retryable
    });
}

export async function fetchWithRetry({
  fetchImpl,
  url,
  options = {},
  stage,
  timeoutMs,
  maxAttempts = 3,
  shouldRetry = (err) => err.retryable
}) {
  let lastError = null;
  const computeBackoff = (attempt) => Math.pow(2, attempt) * 1000 + Math.random() * 1000;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  if (!fetchImpl) {
      if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
          const { net } = await import('electron');
          fetchImpl = net.fetch ? net.fetch.bind(net) : fetch;
      } else {
          fetchImpl = fetch;
      }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout({
          fetchImpl, url, options, timeoutMs: timeoutMs || 30000
      });
      if (response.ok) return response;
      if (response.status === 404 || response.status === 405) return response;

      const error = new NetworkStageError(`HTTP ${response.status}`, {
            stage,
            code: `HTTP_${response.status}`,
            httpStatus: response.status,
            retryable: isRetryableHttpStatus(response.status)
      });

      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      const normalized = normalizeNetworkError(error, stage);
      if (attempt >= maxAttempts || !shouldRetry(normalized)) {
        throw normalized;
      }
      lastError = normalized;
    }
    if (attempt < maxAttempts) {
        await sleep(computeBackoff(attempt));
    }
  }

  throw (
    lastError ||
    new NetworkStageError('Network request failed', {
        stage,
        code: 'UNKNOWN_NETWORK_FAILURE'
    })
  );
}
