import { EmptyState } from '../ui/EmptyState';
import { ACTION_ICONS } from '../ui/icons';
import type { PaneProps } from './paneTypes';

/** `agide/observation-log` (0026 section 6): the access log of observed surfaces. Stub: owner w-browser. */
export function ObservationLogPane({ instanceId }: PaneProps) {
  return (
    <section data-testid="observation-log-pane" data-instance={instanceId} aria-label="Observation log">
      <EmptyState icon={ACTION_ICONS['observe-on'].icon} title="The observation log is not built yet" />
    </section>
  );
}
