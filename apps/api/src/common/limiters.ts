type Bucket = number[];

/**
 * In-memory sliding window limiter (per Node process). Idle keys are pruned on access only; use a shared store for multi-instance caps.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, Bucket>();

  /**
   * Records one hit for the key when it is still under the limit for the window.
   * @param key Bucket name, for example `analysis:<ownerId>`.
   * @param limit Maximum hits allowed inside the window.
   * @param windowMs Window length in milliseconds.
   * @param now Current time in milliseconds. Injected by tests.
   * @returns `ok: true` when the hit was recorded, or the seconds to wait before the next allowed hit.
   */
  consume(key: string, limit: number, windowMs: number, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const recent = this.prune(key, windowMs, now);
    if (recent.length >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      return { ok: false, retryAfterSeconds };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true };
  }

  /**
   * Removes the latest hit for the key, used when the request was rejected before doing work.
   * @param key Bucket name passed to {@link consume}.
   */
  refund(key: string): void {
    const bucket = this.hits.get(key);
    if (!bucket?.length) return;
    bucket.pop();
  }

  /**
   * Drops hits older than the window and stores the remaining ones.
   * @returns The hits still inside the window, oldest first.
   */
  private prune(key: string, windowMs: number, now: number): Bucket {
    const bucket = (this.hits.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (bucket.length === 0) this.hits.delete(key);
    else this.hits.set(key, bucket);
    return bucket;
  }

}

export class InflightLimiter {
  private current = 0;

  /** @param max Maximum concurrent requests allowed in this process. */
  constructor(private readonly max: number) {}

  /**
   * Takes one slot when one is free.
   * @returns True when the caller may proceed and must call {@link leave} afterwards.
   */
  tryEnter(): boolean {
    if (this.current >= this.max) return false;
    this.current += 1;
    return true;
  }

  /** Releases one slot. Never goes below zero. */
  leave(): void {
    this.current = Math.max(0, this.current - 1);
  }
}
