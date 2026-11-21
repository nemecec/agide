import type { CSSProperties } from 'react';
import { initialOf } from './profileModel';
import { profileTileColour } from '../../core/theme/profileColour';
import './ProfileTile.css';

export interface ProfileTileProps {
  readonly name: string;
  readonly colour: string;
  readonly size: 'bar' | 'rail';
  /** A profile that is not kept on disk: an outline without a fill. */
  readonly temporary?: boolean;
}

/** The first letter of a profile on its colour; the same tile marks the profile in the title bar and in the rail. */
export function ProfileTile({ name, colour, size, temporary = false }: ProfileTileProps) {
  const style = temporary ? undefined : ({ '--profile-tile': profileTileColour(colour) } as CSSProperties);
  return (
    <span className="profile-tile" data-size={size} data-temporary={temporary || undefined} style={style} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}
