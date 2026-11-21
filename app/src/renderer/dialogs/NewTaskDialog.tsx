import { useEffect, useState } from 'react';
import type { TaskStartResult } from '../../core/tasks/types';
import type { TreeNode } from '../../core/tree/types';
import type { PermissionOptions } from '../../core/permissions/options';
import { api } from '../api';
import { buildStartInput, detectKind, KIND_LABEL, type ModeChoice, type TaskForm } from './task/taskForm';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { DialogContent } from '../ui/Dialog';
import { Disclosure } from '../ui/Disclosure';
import { Field, TextArea, TextField } from '../ui/Field';
import { Hint } from '../ui/Hint';
import { Notice } from '../ui/Notice';
import { Select } from '../ui/Select';
import './task/task.css';

interface Preview {
  readonly commands: readonly string[];
  readonly prompt: string;
  readonly repoPath?: string;
}

const MODES: { readonly value: ModeChoice; readonly label: string }[] = [
  { value: 'profile', label: 'Profile default' },
  { value: 'auto', label: 'Auto' },
  { value: 'default', label: 'Ask every time' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan' },
];

/**
 * The new-task dialog of 0028 section 13: source with a detected-kind chip, instruction, repository, base,
 * parent folder, permission mode and a preview. The isolation provider is the profile's.
 */
export function NewTaskDialog({ parentFolderId, onClose }: { readonly parentFolderId: string | null; readonly onClose: () => void }) {
  const [form, setForm] = useState<TaskForm>({ source: '', instruction: '', repoPath: '', base: '', parentFolderId: parentFolderId ?? '', mode: 'profile' });
  const [folders, setFolders] = useState<readonly TreeNode[]>([]);
  const [repositories, setRepositories] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<Preview | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [profileMode, setProfileMode] = useState<string | undefined>();
  const kind = detectKind(form.source);
  const set = <K extends keyof TaskForm>(key: K, value: TaskForm[K]): void => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    void api().invoke<{ nodes: TreeNode[] }>('ui_list_tree').then((result) => result.ok && setFolders(result.value.nodes.filter((node) => node.kind === 'folder')));
    void api()
      .invoke<PermissionOptions>('permissions_options', {})
      .then((result) => {
        const label = result.ok ? result.value?.modes.find((mode) => mode.id === result.value.settings.defaultMode)?.label : undefined;
        if (label !== undefined) setProfileMode(label);
      });
    void api().invoke<{ repositories: string[] }>('task_repositories').then((result) => result.ok && setRepositories(result.value.repositories));
  }, []);

  useEffect(() => {
    if (!previewOpen || kind === undefined) {
      setPreview(undefined);
      return;
    }
    const input = buildStartInput(form);
    const { source, instruction, repoPath, base } = input as { source: string; instruction?: string; repoPath?: string; base?: string };
    let current = true;
    void api()
      .invoke<Preview>('task_preview', { source, ...(instruction === undefined ? {} : { instruction }), ...(repoPath === undefined ? {} : { repoPath }), ...(base === undefined ? {} : { base }) })
      .then((result) => current && setPreview(result.ok ? result.value : undefined));
    return () => {
      current = false;
    };
  }, [previewOpen, form, kind]);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await api().invoke<TaskStartResult>('task_start', buildStartInput(form));
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error.message);
  };

  const repoFromPreview = preview?.repoPath;
  return (
    <DialogContent
      title="New task"
      className="task-dialog"
      data-testid="new-task-dialog"
      data-parent={parentFolderId ?? ''}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && kind !== undefined) void start();
      }}
      footer={
        <>
          <Button data-dialog-cancel onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" data-testid="task-start" disabled={busy || kind === undefined} loading={busy}>
            {busy ? 'Starting…' : 'Start'}
          </Button>
        </>
      }
    >
      <TextArea
        label="Source"
        data-autofocus
        data-testid="task-source"
        rows={3}
        value={form.source}
        placeholder="A prompt, a GitHub pull request URL, or a Jira key"
        onChange={(event) => set('source', event.target.value)}
      />
      <div>
        <Chip data-testid="task-kind" label={kind === undefined ? 'Nothing entered' : KIND_LABEL[kind]} />
      </div>
      {kind !== undefined && kind !== 'prompt' && <TextArea label="Instruction (optional)" data-testid="task-instruction" rows={2} value={form.instruction} onChange={(event) => set('instruction', event.target.value)} />}
      <TextField
        label="Repository"
        data-testid="task-repo"
        title={form.repoPath || repoFromPreview}
        list="task-repositories"
        mono
        value={form.repoPath}
        placeholder={repoFromPreview ?? 'No repository'}
        onChange={(event) => set('repoPath', event.target.value)}
      />
      <datalist id="task-repositories">
        {repositories.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      {(kind === 'prompt' || kind === 'jira') && form.repoPath.trim() !== '' && <TextField label="Base" data-testid="task-base" mono value={form.base} placeholder="origin/HEAD" onChange={(event) => set('base', event.target.value)} />}
      <Field label="Parent folder">
        {(control) => (
          <Select {...control} data-testid="task-parent" value={form.parentFolderId} onValueChange={(value) => set('parentFolderId', value)} options={[{ value: '', label: 'Top level' }, ...folders.map((folder) => ({ value: folder.id, label: folder.title }))]} />
        )}
      </Field>
      <Field label="Permission mode">
        {(control) => (
          <Select
            {...control}
            data-testid="task-mode"
            value={form.mode}
            onValueChange={(value) => set('mode', value as ModeChoice)}
            options={MODES.map((mode) => ({ value: mode.value, label: mode.value === 'profile' && profileMode !== undefined ? `${mode.label} (${profileMode})` : mode.label }))}
          />
        )}
      </Field>
      <Hint>Isolation: the profile&apos;s provider.</Hint>
      <Disclosure label="Preview" open={previewOpen} onOpenChange={setPreviewOpen}>
        {preview && (
          <div data-testid="task-preview">
            <pre>{preview.commands.join('\n') || 'No commands run before the session starts.'}</pre>
            <pre>{preview.prompt}</pre>
          </div>
        )}
      </Disclosure>
      {error && (
        <Notice tone="danger" data-testid="task-error">
          {error}
        </Notice>
      )}
    </DialogContent>
  );
}
