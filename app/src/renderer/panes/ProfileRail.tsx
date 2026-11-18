import { useState } from 'react';
import { api } from '../api';
import { NewProfileForm } from './NewProfileForm';
import { PlanUsage } from './rail/PlanUsage';
import type { PaneProps } from './paneTypes';
import { badgeText, initialOf } from './profileModel';
import { useProfiles } from './useProfiles';
import './ProfileRail.css';

/**
 * The profile switcher rail (`agide/profile-rail`). Lists every profile with its colour, initial, running
 * mark and unread badge; a click focuses the running profile or starts it. A temporary profile shows a note instead of the list.
 */
export function ProfileRail({ instanceId }: PaneProps) {
  const { list, reload } = useProfiles();
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  if (!list) return null;
  if (!list.persistent) {
    return (
      <nav className="profile-rail" data-testid="profile-rail" data-instance={instanceId} aria-label="Profiles">
        <p className="profile-temporary" title="This window runs a temporary profile: nothing here is kept after it closes and no other profiles are listed.">
          Temporary profile
        </p>
        <PlanUsage />
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
          const badge = badgeText(profile.unread);
          const own = profile.id === list.own;
          return (
            <li key={profile.id}>
              <button
                type="button"
                className="profile-entry"
                data-testid={`profile-${profile.id}`}
                data-running={profile.running}
                data-own={own}
                title={`${profile.name}${profile.running ? '' : ' (not running)'}`}
                aria-label={`${profile.name}${badge ? `, ${badge} unread` : ''}`}
                aria-current={own ? 'true' : undefined}
                onClick={() => open(profile.id)}
              >
                <span className="profile-initial" style={{ background: profile.colour }}>
                  {initialOf(profile.name)}
                </span>
                {profile.running ? <span className="profile-running" aria-hidden="true" /> : null}
                {badge ? (
                  <span className="badge" data-testid={`badge-${profile.id}`}>
                    {badge}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" className="profile-entry profile-add" data-testid="profile-new" aria-label="New profile" onClick={() => setCreating(true)}>
            <span className="profile-initial">+</span>
          </button>
        </li>
      </ul>
      <PlanUsage />
      {problem ? <p className="profile-problem" role="alert">{problem}</p> : null}
      {creating ? (
        <NewProfileForm
          palette={list.palette}
          onDone={() => {
            setCreating(false);
            reload();
          }}
        />
      ) : null}
    </nav>
  );
}
