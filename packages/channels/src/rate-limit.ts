/**
 * Channex allows 10 availability calls and 10 price-and-restriction calls per minute per
 * property (playbook, Section 5). This limiter tracks calls per key, e.g. "availability:<property>",
 * and also lets the worker pause a key for a minute after a rate-limit or server error.
 *
 * It lives in memory, so run one worker process. If the worker is ever scaled out,
 * move this state into Postgres.
 */
export class PerKeyRateLimiter {
  private readonly calls = new Map<string, number[]>();
  private readonly pausedUntil = new Map<string, number>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a call if allowed. Otherwise says how long to wait. */
  tryTake(key: string): { ok: true } | { ok: false; retryInMs: number } {
    const now = this.now();
    const paused = this.pausedUntil.get(key);
    if (paused !== undefined) {
      if (paused > now) return { ok: false, retryInMs: paused - now };
      this.pausedUntil.delete(key);
    }
    const recent = (this.calls.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? now;
      this.calls.set(key, recent);
      return { ok: false, retryInMs: oldest + this.windowMs - now };
    }
    recent.push(now);
    this.calls.set(key, recent);
    return { ok: true };
  }

  pause(key: string, ms: number): void {
    this.pausedUntil.set(key, this.now() + ms);
  }
}

/** Channex's published limits. */
export function createChannexRateLimiter(now?: () => number): PerKeyRateLimiter {
  return new PerKeyRateLimiter(10, 60_000, now);
}
