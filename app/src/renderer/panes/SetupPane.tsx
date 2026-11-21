import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { api } from '../api';
import { Button, Card, Hint, Notice, Popover, PopoverClose, TextField } from '../ui/index';
import { Chip } from '../ui/Chip';
import { TONE_ICONS } from '../ui/icons';
import './SetupPane.css';

function StepTitle({ title, done }: { readonly title: string; readonly done: boolean }) {
  return (
    <div className="setup-step-head">
      <h4 className="setup-step-title">{title}</h4>
      {done ? <Chip tone="success" icon={TONE_ICONS.success.icon} label="Done" /> : null}
    </div>
  );
}

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
 * A card in a popover anchored to the profile identity (`trigger`). It opens by itself for profiles with isolated
 * tool credentials until login and git identity are done; "Later" and Escape close it, and the trigger opens it again.
 */
export function SetupPane({ trigger }: { trigger: ReactElement }) {
  const [status, setStatus] = useState<SetupStatus | undefined>(undefined);
  const [open, setOpen] = useState(true);
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

  if (!status?.needed || (status.login.signedIn && status.git)) return trigger;

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

  const incomplete = userName.trim() === '' || userEmail.trim() === '';
  return (
    <Popover trigger={trigger} title="Set up this profile" open={open} onOpenChange={setOpen} className="setup-popover">
      <Card data-testid="setup-pane" aria-label="Profile setup" className="setup-card">
        <section className="setup-step">
          <StepTitle title="Claude login" done={status.login.signedIn} />
          {status.login.signedIn ? null : (
            <>
              <Hint>Start a terminal session and sign in there. The app does not read the credential.</Hint>
              <div className="setup-actions">
                <Button size="sm" variant="secondary" onClick={() => void startLogin()}>Open login terminal</Button>
                <Button size="sm" variant="quiet" onClick={refresh}>Check again</Button>
              </div>
            </>
          )}
        </section>
        <section className="setup-step">
          <StepTitle title="Git identity" done={status.git} />
          {status.git ? null : (
            <>
              <TextField label="Name" aria-label="Git name" placeholder="Name" value={userName} onChange={(e) => setUserName(e.target.value)} />
              <TextField label="E-mail" aria-label="Git e-mail" placeholder="E-mail" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} />
              <div className="setup-actions">
                <Button size="sm" variant="primary" disabled={incomplete} focusableWhenDisabled onClick={() => void saveGit()}>Save</Button>
                {incomplete ? <Hint>Enter a name and an e-mail to save.</Hint> : null}
              </div>
            </>
          )}
        </section>
        {status.agentAccess === 'host-user' ? <Hint>Agents run as your user on this computer. This profile keeps credentials and settings apart, but an agent can read what your user can read. Plain ssh and scp outside git still use your default keys.</Hint> : null}
        <Hint data-testid="setup-permission-note">New sessions start in auto mode unless you choose another: Claude decides with its safety classifier, and outward actions such as pushes, comments and messages still ask. Change this in the profile settings.</Hint>
        <Hint>GitHub and ssh keys can be set up later in the profile settings; without a key git uses HTTPS.</Hint>
        {problem ? <Notice tone="danger">{problem}</Notice> : null}
        <div className="setup-actions setup-footer">
          <PopoverClose asChild>
            <Button size="sm" variant="quiet">Later</Button>
          </PopoverClose>
        </div>
      </Card>
    </Popover>
  );
}
