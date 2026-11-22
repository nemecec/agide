import { api } from '../../api';
import type { LayoutViewState } from '../../layout/useLayoutState';
import { planOpenPane, type Operation } from '../swarm/openSwarmPane';

const REVIEW_PANE = 'agide/review';

/**
 * The layout patch that shows the review pane for a swarm: an existing review pane of the swarm gets the
 * changeset and moves to the front of its tab group; otherwise a pane is added next to the main surface.
 */
export function planOpenReviewPane(view: Pick<LayoutViewState, 'layout'>, swarmId: string, changesetId?: string): Operation[] | undefined {
  const config = { swarmId, ...(changesetId === undefined ? {} : { changesetId }) };
  return planOpenPane(view, { type: REVIEW_PANE, config, idPrefix: 'review', refreshConfig: true, matches: (instance) => instance.config?.['swarmId'] === swarmId });
}

/** Shows the review pane in the window's layout; resolves with a failure message, or undefined. */
export async function openReviewPane(swarmId: string, changesetId?: string): Promise<string | undefined> {
  const view = await api().invoke<LayoutViewState>('layout_get');
  if (!view.ok) return view.error.message;
  const patch = planOpenReviewPane(view.value, swarmId, changesetId);
  if (patch === undefined) return 'The layout has no place for the review pane.';
  const applied = await api().invoke('layout_apply', { layoutId: view.value.layoutId, expectedRevision: view.value.revision, patch });
  return applied.ok ? undefined : applied.error.message;
}
