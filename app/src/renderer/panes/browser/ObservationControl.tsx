import { useEffect, useState } from 'react';
import type { ObservationLogEntry } from '../../../core/browser/types';
import type { ObserveMode } from '../../../core/surfaces/types';
import { api } from '../../api';
import { MODE_LABEL } from './model';
import { ObservationIndicator } from './ObservationIndicator';
import { useViewSuspension } from './suspension';

const MODES: readonly ObserveMode[] = ['off', 'on-demand', 'live'];

/** The indicator of a tab as a button; it opens the switch and the tab's recent access log entries. */
export function ObservationControl({ leafId, mode, reading, forcedOff }: { readonly leafId: string; readonly mode: ObserveMode; readonly reading: boolean; readonly forcedOff: boolean }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ObservationLogEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api()
      .invoke<{ entries: ObservationLogEntry[] }>('browser_access_log', { nodeId: leafId, limit: 8 })
      .then((result) => {
        if (!cancelled && result.ok) setEntries(result.value.entries);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leafId, reading]);

  useViewSuspension(open);

  return (
    <span className="observation-control">
      <button type="button" className="chrome-button" data-testid="observation-button" aria-haspopup="dialog" aria-expanded={open} title="What agents may observe in this tab" onClick={() => setOpen((value) => !value)}>
        <ObservationIndicator mode={mode} reading={reading} />
      </button>
      {open && (
        <div className="observation-popover" role="dialog" aria-label="Observation" data-testid="observation-popover">
          <div role="radiogroup" aria-label="Observation mode">
            {MODES.map((candidate) => (
              <label key={candidate} className="observation-option">
                <input
                  type="radio"
                  name={`observe-${leafId}`}
                  checked={mode === candidate}
                  disabled={forcedOff}
                  onChange={() => void api().invoke('ui_set_observation', { nodeId: leafId, mode: candidate })}
                />{' '}
                {MODE_LABEL[candidate]}
              </label>
            ))}
          </div>
          {forcedOff && <p className="muted">A blocked address keeps observation off.</p>}
          <ol className="observation-log" aria-label="Recent access">
            {entries.length === 0 && <li className="muted">No agent has read this tab.</li>}
            {entries.map((entry) => (
              <li key={entry.id}>
                {new Date(entry.at).toLocaleTimeString()} {entry.kind} {entry.outcome}
              </li>
            ))}
          </ol>
        </div>
      )}
    </span>
  );
}
