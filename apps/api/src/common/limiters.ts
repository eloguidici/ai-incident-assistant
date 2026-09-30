type Bucket = { hits: number[]; expiresAt: number };
const DefaultMaxKeys = 10_000;
const SweepBatchSize = 16;

/** Bounded, process-local sliding windows. A key must use a stable window; replicas do not share quotas. */
export class SlidingWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private sweepCursor = this.buckets.entries();

  /** @param maxKeys Memory bound; new keys are rejected while every tracked slot is occupied. */
  constructor(private readonly maxKeys: number = DefaultMaxKeys) {
    if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new Error('maxKeys must be a positive integer.');
  }

  /** Records a hit or returns a retry delay. Expired abandoned keys are swept incrementally. */
  consume(key: string, limit: number, windowMs: number, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
    this.sweepExpired(now);
    const recent = (this.buckets.get(key)?.hits ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= limit) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
    }
    if (!this.buckets.has(key) && this.buckets.size >= this.maxKeys) {
      // Fail closed rather than evicting a live key and resetting its quota.
      return { ok: false, retryAfterSeconds: 1 };
    }
    recent.push(now);
    this.buckets.set(key, { hits: recent, expiresAt: now + windowMs });
    return { ok: true };
  }

  /** Refunds a reservation rejected before doing work; removes an empty bucket. */
  refund(key: string): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    bucket.hits.pop();
    if (!bucket.hits.length) this.buckets.delete(key);
  }

  /** Visits a fixed number of entries per request, independent of the number of tracked keys. */
  private sweepExpired(now: number): void {
    for (let index = 0; index < SweepBatchSize; index += 1) {
      const entry = this.sweepCursor.next();
      if (entry.done) {
        this.sweepCursor = this.buckets.entries();
        break;
      }
      const [key, bucket] = entry.value;
      if (bucket.expiresAt <= now) this.buckets.delete(key);
    }
  }
}

export class InflightLimiter {
  private current = 0;

  /** @param max Maximum concurrent requests allowed in this process. */
  constructor(private readonly max: number) {}

  /** Takes one slot; a successful caller must release it with leave. */
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
