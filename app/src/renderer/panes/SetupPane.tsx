import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface SetupStatus {
  readonly needed: boolean;
  readonly login: { readonly signedIn: boolean; readonly authMethod?: string };
  readonly git: boolean;
  readonly ssh: boolean;
  readonly loginDirectory: string;
  readonly agentAccess?: string;
}

/**
 * The steps that remain for a new profile: Claude login in a terminal session, git identity, ssh key (optional).
 * Shown for profiles with isolated tool credentials until login and git identity are done, or dismissed.
 */
export function SetupPane() {
  const [status, setStatus] = useState<SetupStatus | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const refresh = useCallback(() => {
    void api()
      .invoke<SetupStatus>('profile_setup_status', {})
      .then((result) => {
        if (result.ok) setStatus(result.value);
      });
  }, []);
  useEffect(refresh, [refresh]);

  if (!status?.needed || dismissed || (status.login.signedIn && status.git)) return null;

  const startLogin = async (): Promise<void> => {
    setProblem(undefined);
    const folder = await api().invoke<{ id: string }>('ui_create_folder', { title: 'Claude login' });
    if (!folder.ok) return setProblem(folder.error.message);
    const session = await api().invoke('session_create', { folderId: folder.value.id, cwd: status.loginDirectory, title: 'Claude login' });
    if (!session.ok) {
      setProblem(session.error.message);
      await api().invoke('ui_remove_node', { nodeId: folder.value.id });
    }
  };

  const saveGit = async (): Promise<void> => {
    setProblem(undefined);
    const result = await api().invoke('profile_set_git', { userName, userEmail });
    if (!result.ok) return setProblem(result.error.message);
    refresh();
  };

  return (
    <aside className="setup-pane" data-testid="setup-pane" aria-label="Profile setup">
      <h2>Set up this profile</h2>
      <section>
        <h3>Claude login {status.login.signedIn ? '(done)' : ''}</h3>
        {status.login.signedIn ? null : (
          <>
            <p>Start a terminal session and sign in there. The app does not read the credential.</p>
            <button type="button" onClick={() => void startLogin()}>Open login terminal</button>{' '}
            <button type="button" onClick={refresh}>Check again</button>
          </>
        )}
      </section>
      <section>
        <h3>Git identity {status.git ? '(done)' : ''}</h3>
        {status.git ? null : (
          <>
            <label className="setup-field">
              Name
              <input aria-label="Git name" placeholder="Name" value={userName} onChange={(e) => setUserName(e.target.value)} />
            </label>
            <label className="setup-field">
              E-mail
              <input aria-label="Git e-mail" placeholder="E-mail" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} />
            </label>
            <button type="button" disabled={userName.trim() === '' || userEmail.trim() === ''} onClick={() => void saveGit()}>Save</button>
            {userName.trim() === '' || userEmail.trim() === '' ? <span className="muted"> Enter a name and an e-mail to save.</span> : null}
          </>
        )}
      </section>
      {status.agentAccess === 'host-user' ? <p>Agents run as your user on this computer. This profile keeps credentials and settings apart, but an agent can read what your user can read. Plain ssh and scp outside git still use your default keys.</p> : null}
      <p data-testid="setup-permission-note">New sessions start in auto mode unless you choose another: Claude decides with its safety classifier, and outward actions such as pushes, comments and messages still ask. Change this in the profile settings.</p>
      <p>GitHub and ssh keys can be set up later in the profile settings; without a key git uses HTTPS.</p>
      {problem ? <p role="alert">{problem}</p> : null}
      <button type="button" onClick={() => setDismissed(true)}>Later</button>
    </aside>
  );
}
