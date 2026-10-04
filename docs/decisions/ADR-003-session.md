# ADR-003: Session

Date: 2026-09-29. Status: accepted.

## Decision

HS256 JWT in the `ia_session` cookie (`HttpOnly`, `SameSite=Lax`). A second cookie, `ia_csrf`, readable by the page, must match the `X-CSRF-Token` header on every POST except login. CORS accepts only `WEB_ORIGIN` with credentials.

## Reason

The browser session must survive a reload without storing the token in `localStorage`. JavaScript cannot read the session cookie. The CSRF check covers same-site form POSTs.

## Alternative

A Bearer token kept only in memory is lost on reload. A Bearer token in `localStorage` is exposed to any script on the page.

## Limit

`COOKIE_SECURE` is false on local HTTP and true in the AWS design behind HTTPS. There is no refresh token. Default expiry is 8 hours. An expired JWT returns `SESSION_EXPIRED`. Logout clears the cookies but does not revoke an issued token.
