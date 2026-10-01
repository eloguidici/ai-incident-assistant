import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { ErrorCode } from '../common/constants/error-code';
import { AppError } from '../common/http';
import { SlidingWindowLimiter } from '../common/limiters';
import { InjectConfig } from '../config';
import { authConfig, type AuthConfig } from '../config/slices';
import { USER_REPOSITORY } from '../db/repositories/tokens';
import type { UserRepository } from '../db/repositories/user.repository';
import { signSession, type SessionUser } from './tokens';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';
  private readonly loginLimiter = new SlidingWindowLimiter();

  /**
   * @param authSettings JWT secret, session TTL, and login throttling limits.
   * @param users Analyst lookup and password hash storage.
   */
  constructor(
    @InjectConfig(authConfig) private readonly authSettings: AuthConfig,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  /** Precomputes a dummy password hash so a missing user takes the same time as a wrong password. */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await bcrypt.hash('not-a-real-password', 10);
  }

  /**
   * Checks the password and issues a session.
   * @param email Compared after lowercasing.
   * @param password Plain password. It is never stored or logged.
   * @param ip Client address used by the login limiter.
   * @returns The analyst, the signed token, and a new CSRF token.
   * @throws AppError INVALID_CREDENTIALS or RATE_LIMITED. Both unknown users and wrong passwords use the same error.
   */
  async login(email: string, password: string, ip: string): Promise<{ user: SessionUser; token: string; csrfToken: string }> {
    const loginRateKey = `login:${ip}`;
    const loginAttempt = this.loginLimiter.consume(loginRateKey, this.authSettings.loginMaxAttempts, 15 * 60 * 1000);
    if (!loginAttempt.ok) {
      throw new AppError(
        ErrorCode.RateLimited,
        429,
        `Too many sign-in attempts. Try again in ${loginAttempt.retryAfterSeconds} seconds.`,
        undefined,
        loginAttempt.retryAfterSeconds,
      );
    }
    const user = await this.users.findByEmail(email.toLowerCase());
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? this.dummyHash);
    if (!user || !passwordMatches) {
      throw new AppError(ErrorCode.InvalidCredentials, 401, 'Invalid credentials.');
    }
    this.loginLimiter.refund(loginRateKey);
    const sessionUser = { id: user.id, email: user.email };
    const token = signSession(sessionUser, this.authSettings);
    const csrfToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    return { user: sessionUser, token, csrfToken };
  }
}
