import jwt from 'jsonwebtoken';
import type { AuthConfig } from '../config/slices';

export type SessionUser = { id: string; email: string };

/**
 * Signs the session JWT.
 * @param user Analyst identity. The subject is the user id and the email is a claim.
 * @param authSettings Secret and lifetime. The password is never included.
 */
export function signSession(user: SessionUser, authSettings: AuthConfig): string {
  return jwt.sign({ email: user.email }, authSettings.jwtSecret, {
    subject: user.id,
    expiresIn: authSettings.jwtTtlSeconds,
  });
}

/**
 * @param token Compact JWT from the session cookie.
 * @param jwtSecret Same secret used by {@link signSession}.
 * @returns The analyst id and email.
 * @throws JsonWebTokenError when the token is invalid. TokenExpiredError is rethrown unchanged.
 */
export function verifySession(token: string, jwtSecret: string): SessionUser {
  try {
    const payload = jwt.verify(token, jwtSecret);
    if (!payload || typeof payload === 'string' || !payload.sub || typeof payload.email !== 'string') {
      throw new jwt.JsonWebTokenError('Incomplete session');
    }
    return { id: payload.sub, email: payload.email };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw error;
    throw new jwt.JsonWebTokenError('Invalid session');
  }
}
