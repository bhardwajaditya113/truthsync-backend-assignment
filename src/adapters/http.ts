const PROVIDER_REQUEST_TIMEOUT_MS = 25_000;

export function fetchProvider(input: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS) });
}
