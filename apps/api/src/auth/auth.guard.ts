import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { ErrorCode } from '../common/constants/error-code';
import { SessionCookieName } from '../common/constants/http';
import { AppError } from '../common/http';
import { InjectConfig } from '../config';
import { authConfig, type AuthConfig } from '../config/slices';
import { verifySession } from './tokens';

@Injectable()
export class AuthGuard implements CanActivate {
  /** @param authSettings Session secret used to verify the cookie. */
  constructor(@InjectConfig(authConfig) private readonly authSettings: AuthConfig) {}

  /**
   * @param context Nest context whose HTTP request must carry the session cookie.
   * @returns True after `request.user` is set.
   * @throws AppError UNAUTHENTICATED or SESSION_EXPIRED.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[SessionCookieName];
    if (!token || typeof token !== 'string') {
      throw new AppError(ErrorCode.Unauthenticated, 401, 'You need to sign in.');
    }
    try {
      request.user = verifySession(token, this.authSettings.jwtSecret);
      return true;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(ErrorCode.SessionExpired, 401, 'The session expired. Sign in again.');
      }
      throw new AppError(ErrorCode.Unauthenticated, 401, 'The session is not valid.');
    }
  }
}
