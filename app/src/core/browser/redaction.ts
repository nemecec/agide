/**
 * Redaction functions of 0026 section 6. They run in main on the data CDP returns, before a result, the log
 * or the digest; page scripts never redact.
 */

const SENSITIVE_QUERY_KEYS = new Set([
  'code', 'state', 'token', 'access_token', 'id_token', 'refresh_token', 'key', 'signature', 'sig', 'auth', 'password',
  'client_secret', 'secret', 'api_key', 'apikey', 'x-amz-signature', 'x-amz-credential', 'x-amz-security-token', 'x-goog-signature', 'session', 'sessionid', 'session_id', 'sid', 'jwt', 'otp',
]);
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization']);
const SENSITIVE_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc', 'cc-exp']);
export const DEFAULT_SENSITIVE_NAMES: readonly string[] = ['card', 'cvv', 'ssn', 'token', 'secret', 'passcode'];

export const REDACTED = 'REDACTED';

/** Scheme, host and port only; `undefined` for anything that is not an http, https URL. */
export function originOf(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** URL without query and fragment, for the digest and the log. */
export function stripQuery(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw === 'about:blank' ? raw : '';
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

/** Network results: values of sensitive query keys become `REDACTED`. */
export function redactNetworkUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, REDACTED);
    if (url.hash !== '' && /(^|[#&])(access_token|id_token|token|code|state|jwt|session)=/i.test(url.hash)) url.hash = REDACTED;
    return url.href;
  } catch {
    return raw;
  }
}

export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value]));
}

/** Titles: control and format characters removed, cut to 120 characters, quoted. */
export function sanitizeTitle(title: string): string {
  const clean = title.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  const cut = clean.length > 120 ? `${clean.slice(0, 119)}…` : clean;
  return JSON.stringify(cut);
}

export interface FieldTraits {
  readonly type?: string | undefined;
  readonly autocomplete?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  /** The accessibility tree marks a field `protected`. */
  readonly protected?: boolean | undefined;
}

/** Password and other sensitive inputs (0026 section 6, first row). */
export function isSensitiveField(field: FieldTraits, names: readonly string[] = DEFAULT_SENSITIVE_NAMES): boolean {
  if (field.protected === true) return true;
  if ((field.type ?? '').toLowerCase() === 'password') return true;
  const autocomplete = (field.autocomplete ?? '').toLowerCase().split(/\s+/);
  if (autocomplete.some((token) => SENSITIVE_AUTOCOMPLETE.has(token))) return true;
  const label = `${field.name ?? ''} ${field.id ?? ''}`.toLowerCase();
  return names.some((name) => name !== '' && label.includes(name.toLowerCase()));
}

/** Replaces each cookie value of 8 or more characters in `text` by `[cookie]`. */
export function redactCookieValues(text: string, cookies: readonly { readonly value: string }[]): string {
  let result = text;
  for (const { value } of [...cookies].sort((a, b) => b.value.length - a.value.length)) {
    if (value.length >= 8) result = result.split(value).join('[cookie]');
  }
  return result;
}

/** Replaces the current values of sensitive fields (3 characters or longer) in `text` by `[sensitive field]`. */
export function redactFieldValues(text: string, values: readonly string[]): string {
  let result = text;
  for (const value of [...values].sort((a, b) => b.length - a.length)) {
    if (value.length >= 3) result = result.split(value).join('[sensitive field]');
  }
  return result;
}

export interface BlockedPattern {
  /** Parsed origin, such as `https://bank.example`, or a host such as `bank.example`. */
  readonly origin: string;
  /** Path prefix; absent blocks the whole origin. */
  readonly pathPrefix?: string;
}

/** A profile list of origin and path patterns that forces observation off while the tab's URL matches. */
export function matchesBlocked(raw: string, patterns: readonly BlockedPattern[]): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return patterns.some((pattern) => {
    const originMatches = pattern.origin.includes('://') ? url.origin === pattern.origin : url.hostname.toLowerCase() === pattern.origin.toLowerCase();
    return originMatches && (pattern.pathPrefix === undefined || normalizePath(url.pathname).startsWith(normalizePath(pattern.pathPrefix)));
  });
}

/** Percent-decoded until stable, lower case, duplicate slashes collapsed: the forms a server treats alike. */
function normalizePath(path: string): string {
  let decoded = path;
  for (let round = 0; round < 3; round++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      break;
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded.toLowerCase().replace(/\/{2,}/g, '/');
}
