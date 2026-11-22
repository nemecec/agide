import type { TreeNode } from '../../../core/tree/types';
import { SURFACE_CLAUDE_SESSION } from '../../../core/surfaces/types';
import { ACTION_ICONS, PANE_ICONS } from '../../ui/icons';
import type { MenuEntry } from '../ContextMenu';
import { agentControls, findAgent, groupControls } from '../swarm/swarmModel';
import { interruptAgent, pauseSwarm, resumeSwarm } from '../swarm/swarmActions';
import { openSwarmDialog } from '../swarm/swarmDialogStore';
import { openReviewPane } from '../review/openReviewPane';
import { openSwarmPane } from '../swarm/openSwarmPane';
import { currentSwarms } from '../swarm/useSwarms';

/**
 * Context menu entries the swarm UI adds for a tree node (0037 section 10): Pause, Resume, Stop, Results and
 * Show definition on a swarm folder; Send message, Interrupt and Stop on an agent leaf. Returns no entries for
 * nodes that belong to no swarm.
 */
export function swarmMenuEntries(node: TreeNode): MenuEntry[] {
  const swarms = currentSwarms();
  if (node.kind === 'folder') {
    const swarm = swarms.find((candidate) => candidate.folderId === node.id);
    if (swarm === undefined) return [];
    const controls = groupControls(swarm.state);
    return [
      { label: 'Pause swarm', icon: ACTION_ICONS.pause.icon, disabled: !controls.pause, separated: true, run: () => void pauseSwarm(swarm.id) },
      { label: 'Resume swarm', icon: ACTION_ICONS.resume.icon, disabled: !controls.resume, run: () => void resumeSwarm(swarm.id) },
      { label: 'Results', icon: ACTION_ICONS.results.icon, run: () => void openSwarmPane(swarm.id) },
      { label: 'Review work', icon: PANE_ICONS.review.icon, run: () => void openReviewPane(swarm.id) },
      { label: 'Show definition', run: () => openSwarmDialog({ kind: 'definition', swarmId: swarm.id }) },
      { label: 'Stop swarm…', icon: ACTION_ICONS.stop.icon, danger: true, disabled: !controls.stop, run: () => openSwarmDialog({ kind: 'stop-swarm', swarmId: swarm.id }) },
    ];
  }
  if (node.surfaceType !== SURFACE_CLAUDE_SESSION) return [];
  const found = findAgent(swarms, node.surfaceId);
  if (found === undefined) return [];
  const { swarm, agent } = found;
  const controls = agentControls(agent.state);
  return [
    { label: 'Send message…', icon: ACTION_ICONS['send-message'].icon, disabled: !controls.send, separated: true, run: () => openSwarmDialog({ kind: 'send', swarmId: swarm.id, agent: agent.name }) },
    { label: 'Interrupt', icon: ACTION_ICONS.pause.icon, disabled: !controls.interrupt, run: () => void interruptAgent(swarm.id, agent.name) },
    { label: 'Open swarm', run: () => void openSwarmPane(swarm.id) },
    { label: 'Review work', icon: PANE_ICONS.review.icon, disabled: agent.workspace !== 'worktree', run: () => void openReviewPane(swarm.id) },
    { label: 'Stop agent…', icon: ACTION_ICONS.stop.icon, danger: true, disabled: !controls.stop, run: () => openSwarmDialog({ kind: 'stop-agent', swarmId: swarm.id, agent: agent.name }) },
  ];
}
