import { useCallback, useEffect, useState } from 'react';
import type { IsolationStatus, ProviderRow } from '../../../core/isolation/statusTypes';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { TextField } from '../../ui/Field';
import { Hint } from '../../ui/Hint';
import { TONE_ICONS } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { RadioGroup, RadioItem } from '../../ui/RadioGroup';
import './settings.css';

const OPTION_FIELD: Partial<Record<string, { key: 'srtBinary' | 'containerImage'; label: string }>> = {
  srt: { key: 'srtBinary', label: 'srt path' },
  container: { key: 'containerImage', label: 'Image' },
};

/** Text with `backtick` spans drawn as code. */
function Code({ text }: { readonly text: string }) {
  return (
    <>
      {text.split('`').map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))}
    </>
  );
}

function ProviderChoice({ row, selected, value, onValue }: { readonly row: ProviderRow; readonly selected: boolean; readonly value: string; readonly onValue: (value: string) => void }) {
  const field = OPTION_FIELD[row.id];
  const { statement } = row;
  const open = row.check.ok && statement.isolated.length === 0;
  const checkText = row.check.ok ? 'Ready.' : <Code text={`${row.check.reason}.${row.check.fix ? ` ${row.check.fix}` : ''}`} />;
  return (
    <li data-testid={`isolation-${row.id}`} data-available={row.check.ok}>
      <Card>
        <RadioItem
          value={row.id}
          disabled={!row.selectable && !selected}
          label={
            <span className="isolation-name">
              <strong>{statement.label}</strong>
              {open ? <Chip tone="warning" icon={TONE_ICONS.warning.icon} label="Not isolated" /> : null}
            </span>
          }
        />
        {row.check.ok && !open ? (
          <Hint data-testid={`isolation-${row.id}-check`}>
            {checkText}
            {row.selectableReason ? ` ${row.selectableReason}` : ''}
          </Hint>
        ) : (
          <Notice tone={row.check.ok ? 'warning' : 'danger'} role="status" data-testid={`isolation-${row.id}-check`}>
            {checkText}
            {row.check.ok && row.selectableReason ? ` ${row.selectableReason}` : ''}
          </Notice>
        )}
        {field ? <TextField label={field.label} aria-label={`${statement.label} ${field.label}`} placeholder={field.label} mono value={value} onChange={(event) => onValue(event.target.value)} /> : null}
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
      </Card>
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
    <section className="settings-section" data-testid="settings-isolation">
      <h3>Isolation</h3>
      {status === undefined ? (
        <p>Checking providers.</p>
      ) : (
        <>
          <RadioGroup aria-label="Isolation provider" value={status.selected} onValueChange={(id) => void choose(id)}>
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
                />
              );
            })}
          </ul>
          </RadioGroup>
          <Button size="sm" onClick={() => refresh(optionsOf())}>
            Check again
          </Button>
        </>
      )}
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </section>
  );
}
