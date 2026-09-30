# ADR-003 — Sesión
Fecha: 2026-09-29. Estado: aceptado.
## Decisión
JWT HS256 en la cookie `ia_session` (`HttpOnly`, `SameSite=Lax`). Una segunda cookie `ia_csrf`, legible por la página, debe coincidir con el encabezado `X-CSRF-Token` en cada POST salvo el login. CORS solo acepta `WEB_ORIGIN` y credenciales.
## Motivo
El navegador necesita sobrevivir a una recarga sin guardar el token en `localStorage`. La cookie de sesión no es leíble por JavaScript. El CSRF cubre los POST same-site del formulario.
## Alternativa
Un Bearer solo en memoria se pierde al recargar. Un Bearer en `localStorage` queda expuesto a cualquier script de la página.
## Límite
`COOKIE_SECURE` es false en HTTP local y true en el diseño AWS. No hay refresh token. La expiración por defecto es 8 horas. Un JWT vencido responde `SESSION_EXPIRED`.
