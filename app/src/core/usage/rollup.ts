import type { NodeId } from '../tree/types';
import { heatLevel, type HeatLevel, type HeatThresholds } from './heat';
import type { RankedSubject, UsageState } from './types';

export interface FolderLookup {
  /** The folder a session belongs to. */
  readonly folderOf: (sessionId: string) => NodeId | undefined;
  /** The parent folder of a folder, undefined at the top level. */
  readonly parentOf: (folderId: NodeId) => NodeId | undefined;
}

/**
 * Sums session rates into their folders and every ancestor folder (0027 section 9). Agents are not added: their
 * figures are a breakdown of their session's. The heat level of a folder is the highest level of a session
 * inside it, so a collapsed folder shows the hottest thing it hides.
 */
export function rollupFolders(ranked: readonly RankedSubject[], lookup: FolderLookup, thresholds: HeatThresholds): UsageState['folders'] {
  const folders = new Map<NodeId, { cost: number | undefined; tokens: number; sessions: number; level: HeatLevel }>();
  for (const entry of ranked) {
    if (entry.subject.kind !== 'session') continue;
    const level = heatLevel(entry.share, entry.costUsdPerMinute, thresholds);
    const seen = new Set<NodeId>();
    for (let folder = lookup.folderOf(entry.subject.sessionId); folder !== undefined && !seen.has(folder); folder = lookup.parentOf(folder)) {
      seen.add(folder);
      const current = folders.get(folder) ?? { cost: undefined, tokens: 0, sessions: 0, level: 0 as HeatLevel };
      folders.set(folder, {
        cost: entry.costUsdPerMinute === undefined ? current.cost : (current.cost ?? 0) + entry.costUsdPerMinute,
        tokens: current.tokens + entry.weightedTokensPerMinute,
        sessions: current.sessions + 1,
        level: Math.max(current.level, level) as HeatLevel,
      });
    }
  }
  return Object.fromEntries(
    [...folders].map(([id, value]) => [id, { ...(value.cost === undefined ? {} : { costUsdPerMinute: value.cost }), weightedTokensPerMinute: value.tokens, sessions: value.sessions, level: value.level }]),
  );
}
