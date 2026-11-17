import type { UiEvent } from '../commands/uiEvents';
import type { SessionEvent } from '../session/types';
import type { TreeEvent } from '../tree/types';
import { EventBus } from './EventBus';

export { EventBus, type BaseEvent, type Unsubscribe } from './EventBus';

/** Every event on the app bus. A new module adds its event union here. All events cross IPC to the renderer. */
export type AppEvent = TreeEvent | SessionEvent | UiEvent;

export type AppEventBus = EventBus<AppEvent>;

export const createAppEventBus = (): AppEventBus => new EventBus<AppEvent>();
