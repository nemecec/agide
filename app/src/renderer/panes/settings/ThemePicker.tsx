import { useCallback, useEffect, useState } from 'react';
import type { ThemeSummary } from '../../../core/theme/summary';
import { PreviewBar } from '../../theme/ThemeNotice';
import { applyTheme, listThemes, previewTheme } from '../../theme/themeCommands';
import { useTheme } from '../../theme/themeContext';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Hint } from '../../ui/Hint';
import { CONTROL_ICONS, THEME_ICONS, TONE_ICONS } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { ImportThemeDialog } from './ImportThemeDialog';
import './themes.css';

const UNKNOWN_LICENSE = 'License unknown';

function ThemeRow({ theme, busy, onPreview, onApply }: { readonly theme: ThemeSummary; readonly busy: boolean; readonly onPreview: () => void; readonly onApply: () => void }) {
  const kind = THEME_ICONS[theme.kind];
  return (
    <li className="theme-row" data-testid={`theme-row-${theme.id}`} data-active={theme.active || undefined}>
      <div className="theme-row-main">
        <span className="theme-row-title">
          <strong>{theme.name}</strong>
          <Chip icon={kind.icon} label={kind.label} />
          {theme.active ? <Chip tone="success" icon={CONTROL_ICONS.check} label="Active" /> : null}
          {theme.lowContrast ? <Chip tone="warning" icon={TONE_ICONS.warning.icon} label="Low contrast" /> : null}
          {theme.detail.includes(UNKNOWN_LICENSE) ? <Chip label={UNKNOWN_LICENSE} /> : null}
        </span>
        <Hint data-testid={`theme-detail-${theme.id}`}>{theme.detail}</Hint>
      </div>
      <div className="theme-row-actions">
        <Button size="sm" variant="quiet" disabled={busy || theme.active} onClick={onPreview}>
          Preview
        </Button>
        <Button size="sm" variant="secondary" disabled={busy || theme.active} onClick={onApply}>
          Use
        </Button>
      </div>
    </li>
  );
}

/**
 * The theme section of Settings (0035 5.4): the themes of the profile with their license and source, Preview,
 * Use and the VS Code import. Every action is a theme command, so an agent can do the same.
 */
export function ThemePicker() {
  const { message } = useTheme();
  const [themes, setThemes] = useState<readonly ThemeSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const revision = message.revision ?? 1;
  const previewId = message.preview?.previewId;

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setThemes((await listThemes()).themes);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  useEffect(() => void refresh(), [refresh, revision, previewId]);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" data-testid="settings-themes">
      <h3>Theme</h3>
      {message.preview ? <PreviewBar preview={message.preview} revision={revision} /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {themes === undefined ? (
        <Hint>Loading.</Hint>
      ) : (
        <ul className="theme-list" aria-label="Themes">
          {themes.map((theme) => (
            <ThemeRow key={theme.id} theme={theme} busy={busy} onPreview={() => void run(() => previewTheme(theme.id))} onApply={() => void run(() => applyTheme(theme.id, revision))} />
          ))}
        </ul>
      )}
      <div className="settings-actions">
        <Button onClick={() => setImporting(true)} data-testid="theme-import-open">
          Import VS Code theme
        </Button>
      </div>
      <ImportThemeDialog open={importing} onOpenChange={setImporting} onKept={() => void refresh()} />
    </section>
  );
}
