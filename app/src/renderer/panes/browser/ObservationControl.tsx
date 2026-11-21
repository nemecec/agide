import { useEffect, useState } from 'react';
import type { ObservationLogEntry } from '../../../core/browser/types';
import type { ObserveMode } from '../../../core/surfaces/types';
import { api } from '../../api';
import { Hint } from '../../ui/Hint';
import { Popover } from '../../ui/Popover';
import { RadioGroup, RadioItem } from '../../ui/RadioGroup';
import { MODE_LABEL } from './model';
import { ObservationIndicator } from './ObservationIndicator';

const MODES: readonly ObserveMode[] = ['off', 'on-demand', 'live'];

const MODE_HELP: Readonly<Record<ObserveMode, string>> = {
  off: 'Agents cannot read this tab.',
  'on-demand': 'An agent reads the page only when it asks, and each read is logged.',
  live: 'Agents see the page as it changes, without asking each time.',
};

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

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      title="Observation"
      className="observation-popover"
      trigger={
        <button type="button" className="observation-button" data-testid="observation-button" aria-label="What agents may observe in this tab" title="What agents may observe in this tab">
          <ObservationIndicator mode={mode} reading={reading} />
        </button>
      }
    >
      <div data-testid="observation-popover">
        <RadioGroup aria-label="Observation mode" value={mode} onValueChange={(next) => void api().invoke('ui_set_observation', { nodeId: leafId, mode: next })}>
          {MODES.map((candidate) => (
            <div key={candidate} className="observation-option">
              <RadioItem value={candidate} disabled={forcedOff} label={<strong>{MODE_LABEL[candidate]}</strong>} />
              <Hint className="observation-help">{MODE_HELP[candidate]}</Hint>
            </div>
          ))}
        </RadioGroup>
        {forcedOff && <Hint className="observation-blocked">A blocked address keeps observation off.</Hint>}
        <ul className="observation-log" aria-label="Recent access">
          {entries.length === 0 && <li>No agent has read this tab.</li>}
          {entries.map((entry) => (
            <li key={entry.id}>
              <time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString()}</time> {entry.kind} {entry.outcome}
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  );
}
