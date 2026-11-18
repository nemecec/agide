import { useEffect, useState } from 'react';
import type { TaskStartResult } from '../../core/tasks/types';
import type { TreeNode } from '../../core/tree/types';
import { api } from '../api';
import { buildStartInput, detectKind, KIND_LABEL, type ModeChoice, type TaskForm } from './task/taskForm';
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
  const kind = detectKind(form.source);
  const set = <K extends keyof TaskForm>(key: K, value: TaskForm[K]): void => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    void api().invoke<{ nodes: TreeNode[] }>('ui_list_tree').then((result) => result.ok && setFolders(result.value.nodes.filter((node) => node.kind === 'folder')));
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
    <div className="dialog task-dialog" role="dialog" aria-label="New task" data-testid="new-task-dialog" data-parent={parentFolderId ?? ''}>
      <h2>New task</h2>
      <label>
        Source
        <textarea
          data-testid="task-source"
          rows={3}
          value={form.source}
          placeholder="A prompt, a GitHub pull request URL, or a Jira key"
          onChange={(event) => set('source', event.target.value)}
        />
      </label>
      <p data-testid="task-kind">{kind === undefined ? 'Nothing entered' : KIND_LABEL[kind]}</p>
      {kind !== undefined && kind !== 'prompt' && (
        <label>
          Instruction (optional)
          <textarea data-testid="task-instruction" rows={2} value={form.instruction} onChange={(event) => set('instruction', event.target.value)} />
        </label>
      )}
      <label>
        Repository
        <input data-testid="task-repo" list="task-repositories" value={form.repoPath} placeholder={repoFromPreview ?? 'No repository'} onChange={(event) => set('repoPath', event.target.value)} />
        <datalist id="task-repositories">
          {repositories.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
      </label>
      {(kind === 'prompt' || kind === 'jira') && form.repoPath.trim() !== '' && (
        <label>
          Base
          <input data-testid="task-base" value={form.base} placeholder="origin/HEAD" onChange={(event) => set('base', event.target.value)} />
        </label>
      )}
      <label>
        Parent folder
        <select data-testid="task-parent" value={form.parentFolderId} onChange={(event) => set('parentFolderId', event.target.value)}>
          <option value="">Top level</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Permission mode
        <select data-testid="task-mode" value={form.mode} onChange={(event) => set('mode', event.target.value as ModeChoice)}>
          {MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
      <p>Isolation: the profile's provider.</p>
      <details open={previewOpen} onToggle={(event) => setPreviewOpen(event.currentTarget.open)}>
        <summary>Preview</summary>
        {preview && (
          <div data-testid="task-preview">
            <pre>{preview.commands.join('\n') || 'No commands run before the session starts.'}</pre>
            <pre>{preview.prompt}</pre>
          </div>
        )}
      </details>
      {error && (
        <p role="alert" data-testid="task-error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" data-testid="task-start" disabled={busy || kind === undefined} onClick={() => void start()}>
          {busy ? 'Starting…' : 'Start'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
