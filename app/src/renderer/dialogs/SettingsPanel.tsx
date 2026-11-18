import { IsolationSection } from '../panes/settings/IsolationSection';
import { PermissionsSection } from '../panes/settings/PermissionsSection';
import { useProfiles } from '../panes/useProfiles';
import '../panes/settings/settings.css';

/**
 * Profile settings above the layout, for every profile including the default one (the setup pane shows only
 * while a new profile is being set up). Each section belongs to one builder; this host belongs to the integration step.
 */
export function SettingsPanel({ onClose }: { readonly onClose: () => void }) {
  const { list } = useProfiles();
  const own = list?.profiles.find((profile) => profile.id === list.own);
  return (
    <aside className="dialog settings-panel" role="dialog" aria-label="Profile settings" data-testid="settings-panel">
      <h2>
        Profile settings <span className="muted" data-testid="settings-profile-name">{list?.persistent === false ? '(temporary profile)' : own ? `(${own.name})` : ''}</span>
      </h2>
      <PermissionsSection />
      <IsolationSection />
      <p className="dialog-hint">Agents run as your user on this computer unless the profile uses an isolating provider.</p>
      <div className="dialog-actions">
        <button type="button" data-dialog-cancel onClick={onClose}>Close</button>
      </div>
    </aside>
  );
}
