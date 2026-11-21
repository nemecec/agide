import { useRef, useState } from 'react';
import { useViewSuspension } from '../browser/suspension';
import { importTheme, ThemeCommandError, toBase64, type ImportResult } from '../../theme/themeCommands';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Dialog } from '../../ui/Dialog';
import { Field, TextArea, TextField } from '../../ui/Field';
import { Hint } from '../../ui/Hint';
import { Notice } from '../../ui/Notice';
import { Select } from '../../ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { importInput, stepOf, UNKNOWN_LICENSE_CHOICE, type ImportChoices, type ImportStep } from './importModel';

interface Loaded {
  readonly data: string;
  readonly fileName: string;
}

const NO_CHOICES: ImportChoices = { themeLabel: undefined, license: undefined, keepOriginalContrast: false };

function Review({ result, keepOriginal, onKeepOriginal }: { readonly result: ImportResult; readonly keepOriginal: boolean; readonly onKeepOriginal: (keep: boolean) => void }) {
  const { theme } = result;
  const lowContrast = result.warnings.length > 0;
  return (
    <div className="import-review" data-testid="theme-import-review">
      <p>
        <strong>{theme.name}</strong> ({theme.kind})
      </p>
      <Hint data-testid="theme-import-source">
        {[theme.source?.extension, theme.source?.version, theme.source?.name].filter(Boolean).join(' · ') || 'Theme file'}
        {theme.source?.sha256 ? ` · sha256 ${theme.source.sha256.slice(0, 12)}` : ''}
      </Hint>
      <TextArea label={`License: ${theme.license?.spdx ?? 'none'}`} help={theme.license?.copyright} readOnly rows={6} mono value={theme.license?.text ?? ''} data-testid="theme-import-license" />
      {theme.license?.spdx === 'LicenseRef-unknown' ? <Notice tone="warning">The license is not known. Keep the theme for personal use only.</Notice> : null}
      {result.adjustments.length > 0 ? (
        <>
          <Hint>Colours moved to reach the contrast targets:</Hint>
          <Table aria-label="Contrast adjustments" data-testid="theme-import-adjustments">
            <TableHead>
              <TableRow>
                <TableHeader>Token</TableHeader>
                <TableHeader>From</TableHeader>
                <TableHeader>To</TableHeader>
                <TableHeader>Reason</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.adjustments.map((adjustment) => (
                <TableRow key={adjustment.token}>
                  <TableCell>{adjustment.token}</TableCell>
                  <TableCell>{adjustment.from}</TableCell>
                  <TableCell>{adjustment.to}</TableCell>
                  <TableCell>{adjustment.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : null}
      <Checkbox
        checked={keepOriginal}
        onCheckedChange={onKeepOriginal}
        label="Keep the original colours"
        description="The theme may then fall under the contrast targets, and the picker marks it Low contrast."
        data-testid="theme-import-keep-original"
      />
      {lowContrast ? (
        <Notice tone="warning" data-testid="theme-import-low-contrast">
          With these colours {result.warnings.length > 0 ? 'some pairs miss their contrast target' : ''}: {result.warnings[0]?.message}
        </Notice>
      ) : null}
    </div>
  );
}

/**
 * Imports a VS Code theme from a file the user picks (a `.json` theme or a `.vsix` package). The dialog runs the import
 * without saving, shows the license, the source and the contrast adjustments, and saves the theme on Keep.
 */
export function ImportThemeDialog({ open, onOpenChange, onKept }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onKept: () => void }) {
  useViewSuspension(open);
  const input = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [choices, setChoices] = useState<ImportChoices>(NO_CHOICES);
  const [step, setStep] = useState<ImportStep | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [licenseText, setLicenseText] = useState({ spdx: '', copyright: '', text: '' });

  const analyse = async (file: Loaded, next: ImportChoices): Promise<void> => {
    setBusy(true);
    try {
      setStep(stepOf(await importTheme(importInput(file.data, file.fileName, next, true))));
    } catch (failure) {
      setStep(failure instanceof ThemeCommandError ? stepOf(failure) : { kind: 'failed', message: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const next = { data: toBase64(new Uint8Array(await file.arrayBuffer())), fileName: file.name };
    setLoaded(next);
    setChoices(NO_CHOICES);
    await analyse(next, NO_CHOICES);
  };

  const choose = (next: ImportChoices): void => {
    setChoices(next);
    if (loaded) void analyse(loaded, next);
  };

  const keep = async (): Promise<void> => {
    if (!loaded) return;
    setBusy(true);
    try {
      await importTheme(importInput(loaded.data, loaded.fileName, choices, false));
      onKept();
      onOpenChange(false);
    } catch (failure) {
      setStep({ kind: 'failed', message: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      setBusy(false);
    }
  };

  const customLicense = licenseText.spdx.trim() !== '' && licenseText.copyright.trim() !== '' && licenseText.text.trim() !== '';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import VS Code theme"
      size={640}
      data-testid="theme-import-dialog"
      description="Pick a theme file (.json) or an extension package (.vsix). Only the theme data and the license file are read; no code runs."
      footer={
        <>
          <Button data-dialog-cancel onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || step?.kind !== 'ready'} onClick={() => void keep()} data-testid="theme-import-keep">
            Keep theme
          </Button>
        </>
      }
    >
      <input ref={input} type="file" accept=".json,.jsonc,.vsix" hidden data-testid="theme-import-file" onChange={(event) => void pick(event.target.files?.[0])} />
      <div className="settings-actions">
        <Button onClick={() => input.current?.click()}>{loaded ? `Change file (${loaded.fileName})` : 'Choose file'}</Button>
      </div>
      {step?.kind === 'failed' ? <Notice tone="danger">{step.message}</Notice> : null}
      {step?.kind === 'choose-theme' ? (
        <Field label="Theme in the package">
          {(control) => <Select {...control} value={choices.themeLabel ?? ''} placeholder="Choose a theme" options={step.labels.map((label) => ({ value: label, label }))} onValueChange={(themeLabel) => choose({ ...choices, themeLabel })} />}
        </Field>
      ) : null}
      {step?.kind === 'need-license' ? (
        <div className="import-license" data-testid="theme-import-license-form">
          <Notice tone="warning">This file has no license. Give the license of the theme, or accept that it is unknown and use the theme for yourself only.</Notice>
          <TextField label="SPDX id (for example MIT)" value={licenseText.spdx} onChange={(event) => setLicenseText({ ...licenseText, spdx: event.target.value })} />
          <TextField label="Copyright line" value={licenseText.copyright} onChange={(event) => setLicenseText({ ...licenseText, copyright: event.target.value })} />
          <TextArea label="License text" rows={4} value={licenseText.text} onChange={(event) => setLicenseText({ ...licenseText, text: event.target.value })} />
          <div className="settings-actions">
            <Button onClick={() => choose({ ...choices, license: UNKNOWN_LICENSE_CHOICE })} data-testid="theme-import-license-unknown">
              License unknown, personal use
            </Button>
            <Button variant="primary" disabled={!customLicense} onClick={() => choose({ ...choices, license: { spdx: licenseText.spdx.trim(), copyright: licenseText.copyright.trim(), text: licenseText.text.trim() } })}>
              Use this license
            </Button>
          </div>
        </div>
      ) : null}
      {step?.kind === 'ready' ? <Review result={step.result} keepOriginal={choices.keepOriginalContrast} onKeepOriginal={(keepOriginalContrast) => choose({ ...choices, keepOriginalContrast })} /> : null}
    </Dialog>
  );
}
