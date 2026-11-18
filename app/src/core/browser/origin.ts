/** True for `scheme://host[:port]` with nothing after it: the only URL form the access log and the digest keep. */
export function isBareOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.origin !== 'null' && url.origin === value;
}
