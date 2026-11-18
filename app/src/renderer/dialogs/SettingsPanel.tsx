import { IsolationSection } from '../panes/settings/IsolationSection';
import { PermissionsSection } from '../panes/settings/PermissionsSection';

/**
 * Profile settings above the layout, for every profile including the default one (the setup pane shows only
 * while a new profile is being set up). Each section belongs to one builder; this host belongs to the integration step.
 */
export function SettingsPanel({ onClose }: { readonly onClose: () => void }) {
  return (
    <aside className="dialog settings-panel" role="dialog" aria-label="Profile settings" data-testid="settings-panel">
      <h2>Profile settings</h2>
      <PermissionsSection />
      <IsolationSection />
      <p>Agents run as your user on this computer unless the profile uses an isolating provider.</p>
      <button type="button" onClick={onClose}>Close</button>
    </aside>
  );
}
