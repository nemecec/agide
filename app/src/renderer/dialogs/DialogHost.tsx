import { NewSessionDialog } from './NewSessionDialog';
import { NewTaskDialog } from './NewTaskDialog';
import { SettingsPanel } from './SettingsPanel';
import { useViewSuspension } from '../panes/browser/suspension';
import { closeDialog, useDialog } from './dialogStore';

/** Renders the open dialog above the layout. Each dialog body belongs to one builder (0029 ownership). */
export function DialogHost() {
  const dialog = useDialog();
  useViewSuspension(dialog !== null);
  if (dialog === null) return null;
  switch (dialog.kind) {
    case 'new-session':
      return <NewSessionDialog folderId={dialog.folderId} onClose={closeDialog} />;
    case 'new-task':
      return <NewTaskDialog parentFolderId={dialog.parentFolderId} onClose={closeDialog} />;
    case 'settings':
      return <SettingsPanel onClose={closeDialog} />;
  }
}
