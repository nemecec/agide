/** `owner/repo` of a GitHub remote URL (https, ssh and scp forms), lower-cased; `undefined` for other hosts. */
export function githubRepositoryOf(url: string): string | undefined {
  const match = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}

/** The remotes of `git config --get-regexp "^remote\..*\.url$"` output as name and URL (the configured URL, before `insteadOf`). */
export function parseRemotes(output: string): { readonly name: string; readonly url: string }[] {
  const remotes: { name: string; url: string }[] = [];
  for (const line of output.split('\n')) {
    const match = /^remote\.(.+)\.url\s+(\S+)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) remotes.push({ name: match[1], url: match[2] });
  }
  return remotes;
}

/** The remote that points at `owner/repo`, `origin` first. */
export function remoteFor(output: string, owner: string, repo: string): string | undefined {
  const wanted = `${owner}/${repo}`.toLowerCase();
  const matching = parseRemotes(output).filter((remote) => githubRepositoryOf(remote.url) === wanted);
  return (matching.find((remote) => remote.name === 'origin') ?? matching[0])?.name;
}

/** The title reduced to `[a-z0-9-]`, at most 40 characters. */
export function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
