/**
 * Walks `error.cause` and returns the first TLS/trust failure detail, if any.
 * @param error Root error from fetch or the OpenAI SDK.
 * @returns A short message and optional OpenSSL-style code, without secrets.
 */
export function findTlsTrustDetail(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth++) {
    if (!(current instanceof Error)) break;
    const code = (current as NodeJS.ErrnoException).code;
    const message = current.message;
    if (code && /CERT|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/i.test(code)) {
      return `${message} (${code})`;
    }
    if (/certificate|unable to verify/i.test(message)) {
      return code ? `${message} (${code})` : message;
    }
    current = current.cause;
  }
  return undefined;
}

/**
 * Formats a short cause chain for operator logs. API keys in messages are redacted.
 * @param error Root error.
 * @returns One line per link in the chain, joined with ` -> `.
 */
export function formatCauseChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth++) {
    if (!(current instanceof Error)) break;
    const code = (current as NodeJS.ErrnoException).code;
    const message = redactSecrets(current.message);
    const label = code ? `${current.constructor.name}: ${message} [${code}]` : `${current.constructor.name}: ${message}`;
    parts.push(label);
    current = current.cause;
  }
  return parts.join(' -> ');
}

function redactSecrets(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
}
