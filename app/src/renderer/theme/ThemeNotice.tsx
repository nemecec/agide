import { useEffect, useState } from 'react';
import type { PreviewState } from '../../core/theme/appearance';
import { useDialog } from '../dialogs/dialogStore';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { keepPreview, revertPreview, undoThemeChange } from './themeCommands';
import { useTheme } from './themeContext';
import './themeNotice.css';

const CHANGE_NOTICE_MS = 10_000;

/** The notice of a theme preview: Keep saves the previewed theme, Revert (or Escape) shows the saved one again. */
export function PreviewBar({ preview, revision }: { readonly preview: PreviewState; readonly revision: number }) {
  const [message, setMessage] = useState<string | undefined>(undefined);
  const revert = (): void => void revertPreview(preview.previewId).catch((error: Error) => setMessage(error.message));
  const keep = (): void => void keepPreview(preview.previewId, revision).catch((error: Error) => setMessage(error.message));
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') revert();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Banner
      tone={message ? 'danger' : 'info'}
      data-testid="theme-preview-bar"
      message={message ?? `Previewing ${preview.name}`}
      actions={
        <>
          <Button size="sm" variant="primary" onClick={keep} data-autofocus>
            Keep
          </Button>
          <Button size="sm" onClick={revert}>
            Revert
          </Button>
        </>
      }
    />
  );
}

/** The notice of a saved theme change, with Undo. It ends after a few seconds. */
function ChangeBar({ suppressed }: { readonly suppressed: boolean }) {
  const { message } = useTheme();
  const { change } = message;
  const [seen] = useState(change?.at);
  const [dismissed, setDismissed] = useState<number | undefined>(undefined);
  const shown = change !== undefined && change.at !== seen && change.at !== dismissed;
  useEffect(() => {
    if (!shown || !change) return;
    const timer = setTimeout(() => setDismissed(change.at), CHANGE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [shown, change]);
  if (!shown || !change || suppressed) return null;
  return (
    <Banner
      tone="success"
      data-testid="theme-change-bar"
      message={change.kind === 'undo' ? `Theme restored to ${change.name}` : `Theme changed to ${change.name}`}
      actions={
        <Button size="sm" onClick={() => void undoThemeChange().then(() => setDismissed(change.at))}>
          Undo
        </Button>
      }
      onDismiss={() => setDismissed(change.at)}
    />
  );
}

/**
 * Floats the theme notices at the foot of the window: the preview bar while a preview runs, and the Undo bar after a
 * change. While a dialog is open the dialog's own picker shows the preview bar, because the dialog holds focus.
 */
export function ThemeNotice() {
  const { message } = useTheme();
  const dialog = useDialog();
  const preview = message.preview;
  return (
    <div className="theme-notice">
      {preview && dialog === null ? <PreviewBar preview={preview} revision={message.revision ?? 1} /> : null}
      <ChangeBar suppressed={preview !== undefined} />
    </div>
  );
}
