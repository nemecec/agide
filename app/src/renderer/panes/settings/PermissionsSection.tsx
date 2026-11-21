import { useEffect, useState } from 'react';
import type { PermissionOptions } from '../../../core/permissions/options';
import type { DefaultPermissionMode, PermissionSettings } from '../../../core/permissions/types';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Disclosure } from '../../ui/Disclosure';
import { Field, TextArea } from '../../ui/Field';
import { Hint } from '../../ui/Hint';
import { Select } from '../../ui/Select';
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
      <section className="settings-section" data-testid="settings-permissions">
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
    <section className="settings-section" data-testid="settings-permissions">
      <h3>Permissions</h3>
      <Field label="Mode of new sessions">
        {(control) => (
          <Select
            {...control}
            data-testid="permissions-default-mode"
            value={settings.defaultMode}
            onValueChange={(value) => setSettings({ ...settings, defaultMode: value as DefaultPermissionMode })}
            options={options.modes.filter((mode) => mode.id !== 'bypassPermissions').map((mode) => ({ value: mode.id, label: mode.label }))}
          />
        )}
      </Field>
      <Hint data-testid="permissions-mode-sentence">{current?.sentence}</Hint>
      <Hint>A session can pick another mode when it starts. Bypass is offered only inside a provider that limits files and the network of the whole process.</Hint>
      <Checkbox
        data-testid="permissions-sandbox"
        checked={settings.network.bashSandbox}
        onCheckedChange={(checked) => setSettings({ ...settings, network: { ...settings.network, bashSandbox: checked } })}
        label="Limit Bash commands to the allowed hosts"
      />
      <Hint data-testid="permissions-network">{networkSentence(settings)}</Hint>
      <TextArea label="Allowed hosts, one per line" aria-label="Allowed hosts" mono value={allow} rows={4} onChange={(e) => setAllow(e.target.value)} />
      <TextArea label="Denied hosts, one per line" aria-label="Denied hosts" mono value={deny} rows={2} onChange={(e) => setDeny(e.target.value)} />
      <Checkbox checked={settings.trustAppCreatedFolders} onCheckedChange={(checked) => setSettings({ ...settings, trustAppCreatedFolders: checked })} label="Answer Claude's folder-trust question for folders the app creates" />
      <Disclosure label="Outward actions">
        <ul className="settings-outward">
          {options.classes
            .filter((row) => row.id !== 'read' && row.id !== 'mcp.other.read')
            .map((row) => (
              <li key={row.id}>
                <span>{row.title}</span>
                <Select
                  aria-label={row.title}
                  value={settings.outward?.[row.id] ?? row.defaultMode}
                  onValueChange={(value) => setSettings(withOutwardMode(settings, row.id, value as (typeof OUTWARD_MODES)[number], row.defaultMode))}
                  options={OUTWARD_MODES.map((mode) => ({ value: mode, label: mode }))}
                />
              </li>
            ))}
        </ul>
      </Disclosure>
      {options.runsAsUser ? <Hint data-testid="permissions-runs-as-user">Agents run as your user on this computer and can read what your user can read.</Hint> : null}
      <div className="settings-actions">
        {message ? <Hint role="status">{message}</Hint> : null}
        <Button variant="primary" data-testid="permissions-save" onClick={() => void save()}>
          Save permissions
        </Button>
      </div>
    </section>
  );
}
