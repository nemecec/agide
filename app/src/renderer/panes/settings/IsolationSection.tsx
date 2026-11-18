import { useCallback, useEffect, useState } from 'react';
import type { IsolationStatus, ProviderRow } from '../../../core/isolation/statusTypes';
import { api } from '../../api';

const OPTION_FIELD: Partial<Record<string, { key: 'srtBinary' | 'containerImage'; label: string }>> = {
  srt: { key: 'srtBinary', label: 'srt path' },
  container: { key: 'containerImage', label: 'Image' },
};

function ProviderChoice({
  row,
  selected,
  value,
  onValue,
  onChoose,
}: {
  readonly row: ProviderRow;
  readonly selected: boolean;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly onChoose: () => void;
}) {
  const field = OPTION_FIELD[row.id];
  const { statement } = row;
  return (
    <li data-testid={`isolation-${row.id}`}>
      <label>
        <input type="radio" name="isolation-provider" checked={selected} disabled={!row.selectable && !selected} onChange={onChoose} />
        <strong>{statement.label}</strong>
      </label>
      <p data-testid={`isolation-${row.id}-check`}>
        {row.check.ok ? 'Ready.' : `${row.check.reason}.${row.check.fix ? ` ${row.check.fix}` : ''}`}
        {row.check.ok && row.selectableReason ? ` ${row.selectableReason}` : ''}
      </p>
      {field ? (
        <input aria-label={`${statement.label} ${field.label}`} placeholder={field.label} value={value} onChange={(event) => onValue(event.target.value)} />
      ) : null}
      {statement.isolated.length > 0 ? (
        <>
          <h4>Isolated</h4>
          <ul>{statement.isolated.map((line) => <li key={line}>{line}</li>)}</ul>
        </>
      ) : null}
      <h4>Not isolated</h4>
      <ul>{statement.notIsolated.map((line) => <li key={line}>{line}</li>)}</ul>
      <p data-testid={`isolation-${row.id}-bypass`}>Bypass mode: {statement.bypass.reason}</p>
      {statement.notes.map((note) => <p key={note}>{note}</p>)}
    </li>
  );
}

/**
 * Isolation section (0022, 0029): the provider of the profile's sessions with its check result and what it
 * isolates, what it leaves open and whether bypass mode is allowed.
 */
export function IsolationSection() {
  const [status, setStatus] = useState<IsolationStatus | undefined>(undefined);
  const [tried, setTried] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const refresh = useCallback((options: Record<string, string> = {}) => {
    void api()
      .invoke<IsolationStatus>('isolation_status', options)
      .then((result) => {
        if (result.ok) setStatus(result.value);
        else setProblem(result.error.message);
      });
  }, []);
  useEffect(() => refresh(), [refresh]);

  const optionsOf = (): Record<string, string> => Object.fromEntries(Object.entries(tried).filter(([, value]) => value.trim() !== ''));

  const choose = async (id: string): Promise<void> => {
    setProblem(undefined);
    const field = OPTION_FIELD[id];
    const options = field && tried[field.key] ? { [field.key]: tried[field.key] } : {};
    const result = await api().invoke('isolation_set_provider', { provider: id, ...options });
    if (!result.ok) setProblem(result.error.message);
    refresh(optionsOf());
  };

  return (
    <section data-testid="settings-isolation">
      <h3>Isolation</h3>
      {status === undefined ? (
        <p>Checking providers.</p>
      ) : (
        <>
          <ul className="isolation-providers">
            {status.providers.map((row) => {
              const field = OPTION_FIELD[row.id];
              return (
                <ProviderChoice
                  key={row.id}
                  row={row}
                  selected={status.selected === row.id}
                  value={field ? (tried[field.key] ?? status.options[field.key] ?? '') : ''}
                  onValue={(value) => field && setTried((current) => ({ ...current, [field.key]: value }))}
                  onChoose={() => void choose(row.id)}
                />
              );
            })}
          </ul>
          <button type="button" onClick={() => refresh(optionsOf())}>Check again</button>
        </>
      )}
      {problem ? <p role="alert">{problem}</p> : null}
    </section>
  );
}
