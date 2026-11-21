import type { LayoutDocument } from '../../core/blocks/layout';

const INBOX_TYPE = 'agide/inbox';

/** The id of the first inbox pane of a layout, or undefined when the layout has none. */
export const inboxInstanceId = (layout: LayoutDocument): string | undefined =>
  Object.entries(layout.instances).find(([, instance]) => instance.type === INBOX_TYPE)?.[0];
