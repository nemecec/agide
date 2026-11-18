import { useEffect, useState } from 'react';
import type { PermissionOptions } from '../../../core/permissions/options';
import type { DefaultPermissionMode, PermissionSettings } from '../../../core/permissions/types';
import { api } from '../../api';
import './settings.css';
import { networkSentence, OUTWARD_MODES, parseHostLines, withOutwardMode } from './permissionsModel';

/**
 * Permissions section (0028 section 1): the default mode with a sentence per mode, how outward actions are handled,
 * the Bash sandbox with its host lists, the folder-trust setting, and what the mode allows.
 */
export function PermissionsSection() {
  const [options, setOptions] = useState<PermissionOptions | undefined>(undefined);
  const [settings, setSettings] = useState<PermissionSettings | undefined>(undefined);
  const [allow, setAllow] = useState('');
  const [deny, setDeny] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    void api()
      .invoke<PermissionOptions>('permissions_options', {})
      .then((result) => {
        if (!result.ok) return setMessage(result.error.message);
        setOptions(result.value);
        setSettings(result.value.settings);
        setAllow(result.value.settings.network.allow.join('\n'));
        setDeny(result.value.settings.network.deny.join('\n'));
      });
  }, []);

  if (options === undefined || settings === undefined) {
    return (
      <section data-testid="settings-permissions">
        <h3>Permissions</h3>
        <p>{message ?? 'Loading.'}</p>
      </section>
    );
  }

  const save = async (): Promise<void> => {
    const next: PermissionSettings = { ...settings, network: { ...settings.network, allow: parseHostLines(allow), deny: parseHostLines(deny) } };
    const result = await api().invoke('permissions_set', { settings: next });
    setMessage(result.ok ? 'Saved. New and resumed sessions use it.' : result.error.message);
    if (result.ok) setSettings(next);
  };
  const current = options.modes.find((mode) => mode.id === settings.defaultMode);

  return (
    <section data-testid="settings-permissions">
      <h3>Permissions</h3>
      <label>
        Mode of new sessions
        <select aria-label="Mode of new sessions" data-testid="permissions-default-mode" value={settings.defaultMode} onChange={(e) => setSettings({ ...settings, defaultMode: e.target.value as DefaultPermissionMode })}>
          {options.modes.filter((mode) => mode.id !== 'bypassPermissions').map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
      <p data-testid="permissions-mode-sentence">{current?.sentence}</p>
      <p className="dialog-hint">A session can pick another mode when it starts. Bypass is offered only inside a provider that limits files and the network of the whole process.</p>
      <label className="setting-check">
        <input type="checkbox" data-testid="permissions-sandbox" checked={settings.network.bashSandbox} onChange={(e) => setSettings({ ...settings, network: { ...settings.network, bashSandbox: e.target.checked } })} /> Limit Bash commands to the allowed hosts
      </label>
      <p data-testid="permissions-network">{networkSentence(settings)}</p>
      <label>
        Allowed hosts, one per line
        <textarea aria-label="Allowed hosts" value={allow} rows={4} onChange={(e) => setAllow(e.target.value)} />
      </label>
      <label>
        Denied hosts, one per line
        <textarea aria-label="Denied hosts" value={deny} rows={2} onChange={(e) => setDeny(e.target.value)} />
      </label>
      <label className="setting-check">
        <input type="checkbox" checked={settings.trustAppCreatedFolders} onChange={(e) => setSettings({ ...settings, trustAppCreatedFolders: e.target.checked })} /> Answer Claude&apos;s folder-trust question for folders the app creates
      </label>
      <details>
        <summary>Outward actions</summary>
        <ul>
          {options.classes
            .filter((row) => row.id !== 'read' && row.id !== 'mcp.other.read')
            .map((row) => (
              <li key={row.id}>
                {row.title}{' '}
                <select aria-label={row.title} value={settings.outward?.[row.id] ?? row.defaultMode} onChange={(e) => setSettings(withOutwardMode(settings, row.id, e.target.value as (typeof OUTWARD_MODES)[number], row.defaultMode))}>
                  {OUTWARD_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </li>
            ))}
        </ul>
      </details>
      {options.runsAsUser ? <p data-testid="permissions-runs-as-user">Agents run as your user on this computer and can read what your user can read.</p> : null}
      <div className="dialog-actions">
        {message ? <p role="status" className="dialog-hint">{message}</p> : null}
        <button type="button" className="btn-primary" data-testid="permissions-save" onClick={() => void save()}>
          Save permissions
        </button>
      </div>
    </section>
  );
}
