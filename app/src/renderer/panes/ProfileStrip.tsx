import { useProfiles } from './useProfiles';
import './ProfileRail.css';

/**
 * A colour strip at the top of the window in the colour of this profile, with its name. A profile that is not
 * kept on disk (a temporary run) gets a grey strip that says so.
 */
export function ProfileStrip() {
  const { list } = useProfiles();
  if (!list) return null;
  const own = list.profiles.find((profile) => profile.id === list.own);
  if (!list.persistent || !own) {
    return (
      <div className="profile-strip profile-strip-temporary" data-testid="profile-strip" data-temporary="true">
        <span>{own?.name ?? 'Profile'} (temporary profile, not saved)</span>
      </div>
    );
  }
  return (
    <div className="profile-strip" data-testid="profile-strip" data-colour={own.colour} style={{ background: own.colour }}>
      <span>{own.name}</span>
    </div>
  );
}
