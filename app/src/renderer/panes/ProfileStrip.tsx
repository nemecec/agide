import { useProfiles } from './useProfiles';
import './ProfileRail.css';

/** A colour strip at the top of the window in the colour of this profile, with its name. */
export function ProfileStrip() {
  const { list } = useProfiles();
  const own = list?.profiles.find((profile) => profile.id === list.own);
  if (!list?.persistent || !own) return null;
  return (
    <div className="profile-strip" data-testid="profile-strip" data-colour={own.colour} style={{ background: own.colour }}>
      <span>{own.name}</span>
    </div>
  );
}
