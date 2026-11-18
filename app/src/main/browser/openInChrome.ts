import { checkUrl } from '../../core/browser/addressPolicy';

export interface OpenInChromeDeps {
  execFile(file: string, args: readonly string[]): Promise<void>;
  openExternal(url: string): Promise<void>;
}

/**
 * Opens the tab's current URL in Google Chrome with `open -b com.google.Chrome <url>` after the address policy;
 * falls back to the default browser when Chrome is not installed (0026 section 4). The query and fragment are
 * kept, because the user asked to open that exact page.
 */
export async function openInChrome(url: string, deps: OpenInChromeDeps): Promise<{ readonly opened: 'chrome' | 'default' }> {
  const verdict = checkUrl(url, 'user');
  if (!verdict.allow || verdict.url === 'about:blank') throw new Error(verdict.allow ? 'an empty tab has nothing to open' : verdict.reason);
  try {
    await deps.execFile('open', ['-b', 'com.google.Chrome', verdict.url]);
    return { opened: 'chrome' };
  } catch {
    await deps.openExternal(verdict.url);
    return { opened: 'default' };
  }
}
