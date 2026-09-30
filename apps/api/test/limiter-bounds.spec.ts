import { SlidingWindowLimiter } from '../src/common/limiters';

describe('bounded rate limiter', () => {
  it('fails closed at capacity without resetting an existing quota', () => {
    const limiter = new SlidingWindowLimiter(2);
    expect(limiter.consume('a', 1, 1000, 0).ok).toBe(true);
    expect(limiter.consume('b', 1, 1000, 0).ok).toBe(true);
    expect(limiter.consume('c', 1, 1000, 1).ok).toBe(false);
    expect(limiter.consume('a', 1, 1000, 1).ok).toBe(false);
  });
  it('reclaims abandoned keys without requiring those keys to return', () => {
    const limiter = new SlidingWindowLimiter(2);
    limiter.consume('old', 1, 1000, 0);
    limiter.consume('active', 1, 10000, 0);
    expect(limiter.consume('new', 1, 1000, 1001).ok).toBe(true);
    expect(limiter.consume('active', 1, 10000, 1001).ok).toBe(false);
  });
  it('refund releases empty capacity', () => {
    const limiter = new SlidingWindowLimiter(1);
    limiter.consume('a', 1, 1000, 0);
    limiter.refund('a');
    expect(limiter.consume('b', 1, 1000, 1).ok).toBe(true);
  });
});
