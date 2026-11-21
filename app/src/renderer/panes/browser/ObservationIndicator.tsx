import type { ObserveMode } from '../../../core/surfaces/types';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { ACTION_ICONS } from '../../ui/icons';
import { MODE_LABEL } from './model';

/** A crossed eye for off, an eye for on demand (accented for 2 s on each read) and for live, which also carries the word Live (0026 section 6). */
export function ObservationIndicator({ mode, reading }: { readonly mode: ObserveMode; readonly reading: boolean }) {
  const icon = mode === 'off' ? ACTION_ICONS['observe-off'].icon : ACTION_ICONS['observe-on'].icon;
  return (
    <>
      <span className="observation-indicator" data-testid="observation-indicator" data-mode={mode} data-reading={reading ? 'true' : 'false'} role="img" aria-label={`Observation ${MODE_LABEL[mode].toLowerCase()}`}>
        <Icon icon={icon} size="md" />
      </span>
      {mode === 'live' && <Chip className="observation-live" tone="info" icon={ACTION_ICONS.live.icon} label="Live" data-testid="observation-live" />}
    </>
  );
}
