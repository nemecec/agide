import { useEffect, useState } from 'react';
import type { PermissionOptions } from '../../core/permissions/options';
import { api } from '../api';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { DialogContent } from '../ui/Dialog';
import { Field, TextField } from '../ui/Field';
import { Hint } from '../ui/Hint';
import { Notice } from '../ui/Notice';
import { Select } from '../ui/Select';
import { createSession, finishNewSession, newSessionTitle } from './newSession';

/**
 * The new-session dialog of 0028 section 1: title, working directory and permission mode. The mode starts at the
 * profile default; Bypass appears only for a provider that isolates, with its confirmation.
 */
export function NewSessionDialog({ folderId, onClose }: { readonly folderId: string; readonly onClose: () => void }) {
  const [options, setOptions] = useState<PermissionOptions | undefined>(undefined);
  const [title, setTitle] = useState(newSessionTitle());
  const [cwd, setCwd] = useState('');
  const [mode, setMode] = useState('auto');
  const [confirmed, setConfirmed] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    void api()
      .invoke<PermissionOptions>('permissions_options', {})
      .then((result) => {
        if (!result.ok) return setProblem(result.error.message);
        setOptions(result.value);
        setMode(result.value.settings.defaultMode);
      });
  }, []);

  const cancel = (): void => {
    finishNewSession({ error: '' });
    onClose();
  };
  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    void createSession({ folderId, title, cwd, permissionMode: mode, confirmBypassPermissions: confirmed }).then((outcome) => {
      if ('error' in outcome) return setProblem(outcome.error);
      finishNewSession(outcome);
      onClose();
    });
  };
  const chosen = options?.modes.find((candidate) => candidate.id === mode);

  return (
    <DialogContent
      title="New Claude session"
      data-testid="new-session-dialog"
      data-folder={folderId}
      onSubmit={submit}
      footer={
        <>
          <Button data-dialog-cancel onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" data-testid="new-session-start" disabled={options === undefined || (mode === 'bypassPermissions' && !confirmed)}>
            Start
          </Button>
        </>
      }
    >
      <TextField label="Title" aria-label="Session title" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextField label="Working directory" aria-label="Working directory" placeholder="Default directory of the folder" mono value={cwd} onChange={(e) => setCwd(e.target.value)} />
      <Field label="Permission mode">
        {(control) => (
          <Select
            {...control}
            data-testid="new-session-mode"
            value={mode}
            onValueChange={setMode}
            options={(options?.modes ?? []).map((candidate) => ({
              value: candidate.id,
              label: candidate.id === options?.settings.defaultMode ? `${candidate.label} (profile default)` : candidate.label,
            }))}
          />
        )}
      </Field>
      {chosen ? <Hint data-testid="new-session-mode-sentence">{chosen.sentence}</Hint> : null}
      {mode === 'bypassPermissions' ? <Checkbox checked={confirmed} onCheckedChange={setConfirmed} label="I understand that nothing asks in this mode" /> : null}
      {options?.runsAsUser ? <Hint>This session runs as your user on this computer.</Hint> : null}
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </DialogContent>
  );
}
