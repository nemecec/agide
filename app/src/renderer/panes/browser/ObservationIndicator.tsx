import type { ObserveMode } from '../../../core/surfaces/types';
import { MODE_LABEL } from './model';

/** Crossed eye for off, outline eye for on demand (filled for 2 s on each read), filled eye for live (0026 section 6). */
export function ObservationIndicator({ mode, reading }: { readonly mode: ObserveMode; readonly reading: boolean }) {
  const filled = mode === 'live' || (mode === 'on-demand' && reading);
  return (
    <>
    <svg
      className="observation-indicator"
      data-testid="observation-indicator"
      data-mode={mode}
      data-reading={reading ? 'true' : 'false'}
      role="img"
      aria-label={`Observation ${MODE_LABEL[mode].toLowerCase()}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
    >
      <path d="M1 8c2-3.5 4.3-5 7-5s5 1.5 7 5c-2 3.5-4.3 5-7 5s-5-1.5-7-5z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" fill={filled ? 'var(--bg, #fff)' : 'currentColor'} />
      {mode === 'off' && <line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
    {mode === 'live' && <span className="observation-live" data-testid="observation-live">Live</span>}
    </>
  );
}
