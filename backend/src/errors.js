// Every failure is classified so the scrape log can say *why* it failed.
export class ScrapeError extends Error {
  constructor(code, message, { retryAfterMs } = {}) {
    super(message);
    this.name = 'ScrapeError';
    this.retryAfterMs = retryAfterMs;
    this.code = code; // HTTP_ERROR | RATE_LIMITED | REVEAL_FAILED | TIMEOUT | RENDER_TIMEOUT | STRUCTURE_CHANGED | UNSTABLE | INVALID_DATA | NETWORK
  }
}
