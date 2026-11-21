import type { HTMLAttributes, Ref } from 'react';
import { Chip, Tooltip } from '../ui/index';
import { ProfileTile } from './ProfileTile';
import { useProfiles } from './useProfiles';
import './ProfileIdentity.css';

export type ProfileIdentityProps = HTMLAttributes<HTMLElement> & { readonly ref?: Ref<HTMLElement> };

/**
 * The profile of this window in the title bar: its tile and name. A temporary profile shows the dashed tile and a
 * "Temporary" chip. It becomes a button when something opens from it (the setup card), which passes `onClick`.
 */
export function ProfileIdentity({ ref, ...rest }: ProfileIdentityProps) {
  const { list } = useProfiles();
  if (!list) return null;
  const own = list.profiles.find((profile) => profile.id === list.own);
  const temporary = !list.persistent || !own;
  const name = own?.name ?? 'Default';
  const content = (
    <>
      <ProfileTile name={name} colour={own?.colour ?? ''} size="bar" temporary={temporary} />
      <span className="profile-identity-name" data-testid="profile-identity-name">
        {name}
      </span>
      {temporary ? (
        <Tooltip content="This profile is not saved">
          <Chip label="Temporary" data-testid="profile-temporary-chip" />
        </Tooltip>
      ) : null}
    </>
  );
  const common = { className: 'profile-identity', 'data-testid': 'profile-identity', 'data-temporary': temporary || undefined, 'data-colour': temporary ? undefined : own?.colour };
  return rest.onClick === undefined ? (
    <div {...rest} {...common} ref={ref as Ref<HTMLDivElement>} role="group" tabIndex={0} aria-label={temporary ? `${name}, temporary profile, not saved` : `${name}, profile`}>
      {content}
    </div>
  ) : (
    <button {...rest} {...common} type="button" ref={ref as Ref<HTMLButtonElement>} aria-label={`${name}, profile setup`}>
      {content}
    </button>
  );
}
