import { useEffect, useState } from 'react';
import type { PermissionOptions } from '../../core/permissions/options';
import { api } from '../api';
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
    <form className="dialog" role="dialog" aria-label="New Claude session" data-testid="new-session-dialog" data-folder={folderId} onSubmit={submit}>
      <h2>New Claude session</h2>
      <label>
        Title
        <input aria-label="Session title" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Working directory
        <input aria-label="Working directory" placeholder="Default directory of the folder" value={cwd} onChange={(e) => setCwd(e.target.value)} />
      </label>
      <label>
        Permission mode
        <select aria-label="Permission mode" data-testid="new-session-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          {(options?.modes ?? []).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.id === options?.settings.defaultMode ? `${candidate.label} (profile default)` : candidate.label}
            </option>
          ))}
        </select>
      </label>
      {chosen ? <p className="dialog-hint" data-testid="new-session-mode-sentence">{chosen.sentence}</p> : null}
      {mode === 'bypassPermissions' ? (
        <label>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I understand that nothing asks in this mode
        </label>
      ) : null}
      {options?.runsAsUser ? <p className="dialog-hint">This session runs as your user on this computer.</p> : null}
      {problem ? <p role="alert" className="dialog-error">{problem}</p> : null}
      <div className="dialog-actions">
        <button type="button" data-dialog-cancel onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" data-testid="new-session-start" disabled={options === undefined || (mode === 'bypassPermissions' && !confirmed)}>
          Start
        </button>
      </div>
    </form>
  );
}
