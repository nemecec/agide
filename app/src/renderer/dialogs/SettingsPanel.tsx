import { IsolationSection } from '../panes/settings/IsolationSection';
import { PermissionsSection } from '../panes/settings/PermissionsSection';
import { ThemePicker } from '../panes/settings/ThemePicker';
import { useProfiles } from '../panes/useProfiles';
import { Button } from '../ui/Button';
import { DialogContent } from '../ui/Dialog';
import { Hint } from '../ui/Hint';
import '../panes/settings/settings.css';

/**
 * Profile settings above the layout, for every profile including the default one (the setup pane shows only
 * while a new profile is being set up). Each section belongs to one builder; this host belongs to the integration step.
 */
export function SettingsPanel({ onClose }: { readonly onClose: () => void }) {
  const { list } = useProfiles();
  const own = list?.profiles.find((profile) => profile.id === list.own);
  return (
    <DialogContent
      title="Profile settings"
      meta={<span data-testid="settings-profile-name">{list?.persistent === false ? '(temporary profile)' : own ? `(${own.name})` : ''}</span>}
      size={640}
      className="settings-panel"
      data-testid="settings-panel"
      footer={
        <Button data-dialog-cancel onClick={onClose}>
          Close
        </Button>
      }
    >
      <ThemePicker />
      <PermissionsSection />
      <IsolationSection />
      <Hint>Agents run as your user on this computer unless the profile uses an isolating provider.</Hint>
    </DialogContent>
  );
}
