import type { AgentsEvent } from '../agents/types';
import type { BlocksEvent } from '../blocks/types';
import type { BrowserEvent } from '../browser/types';
import type { UiEvent } from '../commands/uiEvents';
import type { InboxEvent } from '../inbox/types';
import type { PermissionsEvent } from '../permissions/types';
import type { ProfileEvent } from '../profile/types';
import type { SessionEvent } from '../session/types';
import type { TasksEvent } from '../tasks/types';
import type { TreeEvent } from '../tree/types';
import { EventBus } from './EventBus';

export { EventBus, type BaseEvent, type Unsubscribe } from './EventBus';

/** Every event on the app bus. A new module adds its event union here. All events cross IPC to the renderer. */
export type AppEvent =
  | TreeEvent
  | SessionEvent
  | UiEvent
  | ProfileEvent
  | BlocksEvent
  | InboxEvent
  | PermissionsEvent
  | BrowserEvent
  | AgentsEvent
  | TasksEvent;

export type AppEventBus = EventBus<AppEvent>;

export const createAppEventBus = (): AppEventBus => new EventBus<AppEvent>();
