/**
 * Structured logging with redaction.
 *
 * The spec asks for "no sensitive data in logs", and the only reliable way to
 * get that is to make the safe thing the default. Every value passed through
 * here is walked and anything that looks like a secret, a token, a card number
 * or an email address is masked before it reaches stdout.
 *
 * Logs go to stdout as single-line JSON in production, which is what Vercel's
 * log drains expect, and as readable text in development.
 */

import { errorMessage } from './utils';

type Level = 'debug' | 'info' | 'warn' | 'error';

/** Keys whose values are replaced wholesale, whatever they contain. */
const SECRET_KEY_PATTERN =
  /(database_url|connectionstring|secret|token|password|passwd|authorization|auth|apikey|api_key|signature|cookie|session|jwt|service_role|private_key|access_key|card|cvv|otp)/i;

/** Keys that hold an email address and should be partially masked, not removed. */
const EMAIL_KEY_PATTERN = /(email|to_email|from|reply_to|recipient)/i;

const EMAIL_IN_TEXT = /\b([\w.+-])[\w.+-]*@([\w-]+\.)+[a-z]{2,}\b/gi;
const LONG_DIGIT_RUN = /\b\d{12,19}\b/g;

const MAX_DEPTH = 6;
const MAX_ARRAY = 25;
const MAX_STRING = 600;

/** `annu@example.com` -> `a***@example.com`. Enough to match a support ticket. */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at < 1) return '***';
  return `${value[0]}***${value.slice(at)}`;
}

function redactString(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s\"\']+/gi, '[redacted-database-url]')
    .slice(0, MAX_STRING)
    .replace(EMAIL_IN_TEXT, (_m, first: string, domain: string) => `${first}***@${domain}***`)
    .replace(LONG_DIGIT_RUN, '[redacted-number]');
}

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[depth-limit]';

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      // Stacks carry file paths and sometimes inlined values. Keep them in
      // development, where they are useful, and drop them in production.
      ...(process.env.NODE_ENV === 'production' ? {} : { stack: redactString(value.stack ?? '') }),
    };
  }

  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((item) => redact(item, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`[+${value.length - MAX_ARRAY} more]`);
    return out;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = '[redacted]';
      } else if (EMAIL_KEY_PATTERN.test(key) && typeof item === 'string') {
        out[key] = maskEmail(item);
      } else {
        out[key] = redact(item, depth + 1);
      }
    }
    return out;
  }

  return '[unserialisable]';
}

export interface LogContext {
  [key: string]: unknown;
}

function emit(level: Level, message: string, context?: LogContext): void {
  const safe = context ? (redact(context) as LogContext) : undefined;

  if (process.env.NODE_ENV === 'production') {
    const line = JSON.stringify({
      level,
      ts: new Date().toISOString(),
      msg: redactString(message),
      ...safe,
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    return;
  }

  const prefix = `[${level}] ${redactString(message)}`;
  if (level === 'error') console.error(prefix, safe ?? '');
  else if (level === 'warn') console.warn(prefix, safe ?? '');
  else console.log(prefix, safe ?? '');
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV !== 'production') emit('debug', message, context);
  },
  info(message: string, context?: LogContext) {
    emit('info', message, context);
  },
  warn(message: string, context?: LogContext) {
    emit('warn', message, context);
  },
  error(message: string, error?: unknown, context?: LogContext) {
    emit('error', message, { ...context, error: error ?? undefined });
  },

  /** Child logger that stamps every line with the same fields (e.g. a request id). */
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => logger.debug(m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => logger.info(m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => logger.warn(m, { ...base, ...c }),
      error: (m: string, e?: unknown, c?: LogContext) => logger.error(m, e, { ...base, ...c }),
    };
  },
};

export type Logger = ReturnType<typeof logger.child>;

export { errorMessage };
