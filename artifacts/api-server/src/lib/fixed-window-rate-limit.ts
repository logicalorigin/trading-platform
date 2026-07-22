import { HttpError } from "./errors";

type RateWindow = { count: number; resetAt: number };

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, RateWindow>();

  constructor(
    private readonly error: { code: string; message: string },
    private readonly maxBuckets = 10_000,
  ) {}

  enforce(key: string, limit: number, windowMs: number, now = Date.now()): void {
    const bucket = this.buckets.get(key);
    if (
      this.buckets.size > this.maxBuckets ||
      (!bucket && this.buckets.size >= this.maxBuckets)
    ) {
      this.prune(now, key);
    }
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (bucket.count >= limit) {
      throw new HttpError(429, this.error.message, { code: this.error.code });
    }
    bucket.count += 1;
  }

  clear(): void {
    this.buckets.clear();
  }

  private prune(now: number, protectedKey: string): void {
    for (const [key, window] of this.buckets) {
      if (key !== protectedKey && window.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
    if (this.buckets.size < this.maxBuckets) return;
    const oldest = Array.from(this.buckets.entries())
      .filter(([key]) => key !== protectedKey)
      .sort(([, left], [, right]) => left.resetAt - right.resetAt);
    for (const [key] of oldest) {
      if (this.buckets.size < this.maxBuckets) break;
      this.buckets.delete(key);
    }
  }
}
