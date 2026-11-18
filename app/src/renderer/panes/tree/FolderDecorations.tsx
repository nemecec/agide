import { HeatMarker } from '../agents/HeatMarker';
import { formatCost } from '../agents/format';
import { useUsageState } from '../agents/useAgents';

/** Summed rate and the hottest level inside a folder (0027 section 9). */
export function FolderDecorations({ folderId }: { readonly folderId: string }) {
  const usage = useUsageState();
  const rollup = usage?.folders[folderId];
  if (!rollup || !usage) return null;
  return (
    <span className="folder-decorations" data-testid="folder-rollup">
      <span className="folder-rate" title={`summed estimate over the last ${usage.windowMinutes} minutes, ${rollup.sessions} sessions active`}>
        {rollup.costUsdPerMinute === undefined ? `${Math.round(rollup.weightedTokensPerMinute)} tok/min` : `${formatCost(rollup.costUsdPerMinute)}/min`}
      </span>
      <HeatMarker level={rollup.level} costUsdPerMinute={rollup.costUsdPerMinute} share={0} windowMinutes={usage.windowMinutes} testId="folder-heat" />
    </span>
  );
}
