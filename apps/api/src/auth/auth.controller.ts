import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ErrorCode } from '../common/constants/error-code';
import { CsrfCookieName, SessionCookieName } from '../common/constants/http';
import { AppError } from '../common/http';
import { InjectConfig } from '../config';
import { authConfig, type AuthConfig } from '../config/slices';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
}).strict();

@Controller('auth')
export class AuthController {
  /**
   * @param auth Checks credentials and issues sessions.
   * @param authSettings Cookie security flag and session lifetime.
   */
  constructor(
    private readonly auth: AuthService,
    @InjectConfig(authConfig) private readonly authSettings: AuthConfig,
  ) {}

  /**
   * @param body JSON with `email` and `password` only.
   * @param request Used for the client address in the login limiter.
   * @param response Receives the session and CSRF cookies.
   * @returns The analyst and the CSRF token.
   * @throws AppError VALIDATION_ERROR, INVALID_CREDENTIALS, or RATE_LIMITED.
   */
  @Post('login')
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const loginBody = loginSchema.safeParse(body);
    if (!loginBody.success) throw new AppError(ErrorCode.ValidationError, 400, 'Check the email and the password.');
    const session = await this.auth.login(loginBody.data.email, loginBody.data.password, request.ip || 'local');
    this.writeCookies(response, session.token, session.csrfToken);
    return { user: session.user, csrfToken: session.csrfToken };
  }

  /**
   * @param request Must already carry a valid session.
   * @returns The analyst stored on the request.
   */
  @UseGuards(AuthGuard)
  @Get('session')
  session(@Req() request: Request) {
    return { user: request.user };
  }

  /**
   * Clears the session and CSRF cookies.
   * @returns `{ ok: true }`.
   */
  @UseGuards(AuthGuard)
  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(SessionCookieName, { path: '/' });
    response.clearCookie(CsrfCookieName, { path: '/' });
    return { ok: true };
  }

  /**
   * Sets the session cookie as HttpOnly and the CSRF cookie as readable by the browser.
   * @param token Signed session JWT.
   * @param csrfToken Value the client must echo in the CSRF header.
   */
  private writeCookies(response: Response, token: string, csrfToken: string): void {
    const base = {
      sameSite: 'lax' as const,
      secure: this.authSettings.cookieSecure,
      path: '/',
      maxAge: this.authSettings.jwtTtlSeconds * 1000,
    };
    response.cookie(SessionCookieName, token, { ...base, httpOnly: true });
    response.cookie(CsrfCookieName, csrfToken, { ...base, httpOnly: false });
  }
}
