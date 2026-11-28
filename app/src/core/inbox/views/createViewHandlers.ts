import type { AppEventBus } from '../../events/index';
import type { SessionService } from '../../session/index';
import type { Database } from '../../store/index';
import type { TreeService } from '../../tree/index';
import type { ViewTracker } from '../ViewTracker';
import type { InboxService } from '../types';
import { NOT_BUILT_VIEW_HANDLERS, type ViewCommandHandlers } from '../viewCommands';

/** What the handlers of the view commands may use. The inbox module passes all of it, so w-inbox-ui fills this file and edits no module file. */
export interface ViewHandlerDeps {
  readonly db: Database;
  readonly events: AppEventBus;
  readonly inbox: InboxService;
  readonly tree: TreeService;
  readonly sessions: SessionService;
  readonly tracker: ViewTracker;
}

/** The handlers of `inbox_views_list`, `inbox_view_save`, `inbox_view_delete` and `inbox_open_item`. Owner: w-inbox-ui; until it lands each answers `not_built`. */
export function createViewHandlers(_deps: ViewHandlerDeps): ViewCommandHandlers {
  return NOT_BUILT_VIEW_HANDLERS;
}
