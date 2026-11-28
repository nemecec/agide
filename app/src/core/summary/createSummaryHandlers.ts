import type { AppEventBus } from '../events/index';
import type { InboxService } from '../inbox/types';
import type { ProfileService } from '../profile/index';
import type { SessionService } from '../session/index';
import type { Database } from '../store/index';
import type { TreeService } from '../tree/index';
import { NOT_BUILT_SUMMARY_HANDLERS, type SummaryCommandHandlers } from './summaryCommands';

/** What the handlers of the summary commands may use. The inbox module passes all of it, so w-summary fills this file and edits no module file. */
export interface SummaryHandlerDeps {
  readonly db: Database;
  readonly events: AppEventBus;
  readonly inbox: InboxService;
  readonly tree: TreeService;
  readonly sessions: SessionService;
  /** The summarizer runs with the profile's `CLAUDE_CONFIG_DIR`, one run at a time per profile (0043 section 4.7). */
  readonly profile: ProfileService;
}

/** The handlers of `session_summarize` and `session_summary_get`. Owner: w-summary; until it lands each answers `not_built`. */
export function createSummaryHandlers(_deps: SummaryHandlerDeps): SummaryCommandHandlers {
  return NOT_BUILT_SUMMARY_HANDLERS;
}
