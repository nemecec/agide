import { EmptyState } from '../../ui/EmptyState';
import { SURFACE_ICONS } from '../../ui/icons';

/** The tasks pane (`agide/tasks`, 0043 section 4.9). A placeholder until w-tasks-ui builds it. */
export function TasksPane(_props: { readonly config: Record<string, unknown> }) {
  return <EmptyState icon={SURFACE_ICONS.task.icon} title="Tasks" help="The tasks pane is not built yet." />;
}
