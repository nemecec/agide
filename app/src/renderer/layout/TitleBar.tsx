import { api } from '../api';
import { openDialog } from '../dialogs/dialogStore';
import { ProfileIdentity } from '../panes/ProfileIdentity';
import { profileMarkColour } from '../../core/theme/profileColour';
import { SetupPane } from '../panes/SetupPane';
import { useProfiles } from '../panes/useProfiles';
import { Badge, Button, IconButton, Menu } from '../ui/index';
import type { MenuEntry } from '../ui/menuModel';
import { CONTROL_ICONS, PANE_ICONS } from '../ui/icons';
import { useTheme } from '../theme/themeContext';
import { UsageMeter } from './UsageMeter';
import { useFullScreen } from './useFullScreen';
import { useUnread } from './useUnread';
import type { LayoutViewState } from './useLayoutState';
import './TitleBar.css';

export interface TitleBarProps {
  readonly view: LayoutViewState;
  /** Shows the inbox pane; undefined when the layout has none. */
  readonly onShowInbox: (() => void) | undefined;
}

const capitalised = (title: string): string => title.charAt(0).toUpperCase() + title.slice(1);

/**
 * The one 38 px row above the panes, in the window surface. It holds the profile identity, the layout switcher, the
 * usage meter, the inbox and the settings. The free space drags the window; every control opts out of dragging.
 * Its bottom border carries the profile colour.
 */
export function TitleBar({ view, onShowInbox }: TitleBarProps) {
  const { list } = useProfiles();
  const { resolved } = useTheme();
  const fullScreen = useFullScreen();
  const unread = useUnread();
  const own = list?.persistent ? list.profiles.find((profile) => profile.id === list.own) : undefined;
  const mark = own ? profileMarkColour(own.colour, resolved.tokens['surface.window'] ?? '', resolved.scheme === 'dark') : undefined;
  const style = mark ? ({ '--profile-mark': mark } as React.CSSProperties) : undefined;

  const active = view.layouts.find((layout) => layout.id === view.activeLayoutId);
  const layouts: MenuEntry[] = view.layouts.map((layout) => ({
    label: capitalised(layout.title),
    ...(layout.id === view.activeLayoutId ? { icon: CONTROL_ICONS.check } : {}),
    run: () => void api().invoke('layout_switch', { layoutId: layout.id }),
  }));

  return (
    <header className="title-bar" data-testid="title-bar" data-full-screen={fullScreen || undefined} data-temporary={own ? undefined : true} style={style}>
      <div className="title-bar-start">
        <SetupPane trigger={<ProfileIdentity />} />
        <Menu
          align="start"
          entries={layouts}
          trigger={
            <Button variant="quiet" size="sm" icon={PANE_ICONS.layout.icon} chevron aria-label={`Layout: ${active ? capitalised(active.title) : ''}`} data-testid="layout-switcher">
              {active ? capitalised(active.title) : 'Layout'}
            </Button>
          }
        />
      </div>
      <div className="title-bar-end">
        <UsageMeter />
        <span className="title-bar-inbox">
          <IconButton
            label={onShowInbox ? 'Inbox' : 'Inbox (not in this layout)'}
            icon={PANE_ICONS.inbox.icon}
            size="lg"
            data-testid="title-bar-inbox"
            aria-disabled={onShowInbox ? undefined : true}
            onClick={onShowInbox}
          />
          {unread > 0 ? <Badge className="title-bar-unread" count={unread} label="unread" data-testid="title-bar-unread" /> : null}
        </span>
        <IconButton label="Settings" icon={PANE_ICONS.settings.icon} size="lg" data-testid="title-bar-settings" onClick={() => openDialog({ kind: 'settings' })} />
      </div>
    </header>
  );
}
