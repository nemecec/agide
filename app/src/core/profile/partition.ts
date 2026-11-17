import { isAbsolute, relative, resolve, sep } from 'node:path';

const SERVICE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The Electron session partition of a browser service (0006: `persist:jira`, `persist:github`). The name
 * carries no profile id: each profile process stores its partitions under its own `userData`.
 */
export function partitionName(service: string): string {
  if (!SERVICE.test(service)) throw new Error(`service name ${service} is not a valid partition name`);
  return `persist:${service}`;
}

/** True when the storage path of a partition lies inside the data directory of the profile. */
export function isUnderDataDir(storagePath: string, dataDir: string): boolean {
  const rel = relative(resolve(dataDir), resolve(storagePath));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
