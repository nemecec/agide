import { useState } from 'react';
import { api } from '../api';
import { Badge, Icon, Notice, Popover, Tooltip } from '../ui/index';
import { ACTION_ICONS } from '../ui/icons';
import { NewProfileForm } from './NewProfileForm';
import type { PaneProps } from './paneTypes';
import { badgeText, type ProfileListEntry } from './profileModel';
import { ProfileTile } from './ProfileTile';
import { useProfiles } from './useProfiles';
import './ProfileRail.css';

/** Name and state, read by assistive technology and shown in the tooltip: "Work, running, 2 unread". */
export function profileLabel(profile: ProfileListEntry): string {
  const state = profile.running ? 'running' : 'not running';
  const badge = badgeText(profile.unread);
  return `${profile.name}, ${state}${badge ? `, ${badge} unread` : ''}`;
}

/**
 * The profile switcher rail (`agide/profile-rail`). Lists every profile as a tile with a running dot and an unread
 * badge; a click focuses the running profile or starts it. A temporary profile shows its own tile alone.
 */
export function ProfileRail({ instanceId }: PaneProps) {
  const { list, reload } = useProfiles();
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  if (!list) return null;

  if (!list.persistent) {
    const own = list.profiles.find((profile) => profile.id === list.own);
    return (
      <nav className="profile-rail" data-testid="profile-rail" data-instance={instanceId} aria-label="Profiles">
        <ul>
          <li>
            <Tooltip content="Temporary profile: nothing here is kept after the window closes and no other profiles are listed." side="right">
              <span className="profile-entry" data-own="true" data-testid="profile-temporary" role="img" tabIndex={0} aria-label="Temporary profile, not saved">
                <ProfileTile name={own?.name ?? 'Default'} colour={own?.colour ?? ''} size="rail" temporary />
              </span>
            </Tooltip>
          </li>
        </ul>
      </nav>
    );
  }

  const open = (id: string): void => {
    setProblem(undefined);
    void api()
      .invoke('profile_open', { id })
      .then((result) => {
        if (!result.ok) setProblem(result.error.message);
      });
  };

  return (
    <nav className="profile-rail" data-testid="profile-rail" data-instance={instanceId} aria-label="Profiles">
      <ul>
        {list.profiles.map((profile) => {
          const count = badgeText(profile.unread);
          const own = profile.id === list.own;
          const label = profileLabel(profile);
          return (
            <li key={profile.id}>
              <Tooltip content={label} side="right">
                <button
                  type="button"
                  className="profile-entry"
                  data-testid={`profile-${profile.id}`}
                  data-running={profile.running}
                  data-own={own}
                  aria-label={label}
                  aria-current={own ? 'true' : undefined}
                  onClick={() => open(profile.id)}
                >
                  <ProfileTile name={profile.name} colour={profile.colour} size="rail" />
                  {profile.running ? <Badge className="profile-running" label="running" /> : null}
                  {count ? <Badge className="profile-unread" count={profile.unread ?? 0} label="unread" data-testid={`badge-${profile.id}`} /> : null}
                </button>
              </Tooltip>
            </li>
          );
        })}
        <li>
          <Popover
            title="New profile"
            open={creating}
            onOpenChange={setCreating}
            trigger={
              <button type="button" className="profile-entry profile-add" data-testid="profile-new" aria-label="New profile" title="New profile">
                <Icon icon={ACTION_ICONS.add.icon} size="md" />
              </button>
            }
          >
            <NewProfileForm
              palette={list.palette}
              onDone={() => {
                setCreating(false);
                reload();
              }}
            />
          </Popover>
        </li>
      </ul>
      {problem ? <Notice tone="danger" role="alert" className="profile-problem">{problem}</Notice> : null}
    </nav>
  );
}
