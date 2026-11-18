/** True when the host is on the list; an entry `*.example.com` covers every subdomain of example.com. */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const name = host.toLowerCase();
  return allowed.some((entry) => {
    const rule = entry.toLowerCase();
    return rule.startsWith('*.') ? name.endsWith(rule.slice(1)) : name === rule;
  });
}

/** True for an `https` origin whose host is on the list. Plain `http` is never covered by the allowlist. */
export function originAllowed(origin: string, allowed: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && hostAllowed(url.hostname, allowed);
}
