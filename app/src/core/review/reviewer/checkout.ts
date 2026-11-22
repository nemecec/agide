import { chmod, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Git } from '../../swarm/workspace/git';
import type { PromptInputFile } from './prompt';

/** A read-only checkout of the checkpoint and the directory of per-file inputs, both removed when the run ends. */
export interface ReviewerCheckout {
  readonly cwd: string;
  readonly inputsDir: string;
  dispose(): Promise<void>;
}

export interface CheckoutRequest {
  readonly runId: string;
  readonly commonDir: string;
  readonly checkpointCommit: string;
  readonly inputFiles: readonly PromptInputFile[];
}

export interface ReviewerCheckouts {
  prepare(request: CheckoutRequest): Promise<ReviewerCheckout>;
}

/** Makes every file and directory below `root` read-only (the `.git` entry of a worktree is a file and goes with them). */
async function lock(root: string, writable: boolean): Promise<void> {
  const stat = await lstat(root);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    if (writable) await chmod(root, stat.mode | 0o200);
    for (const name of await readdir(root)) await lock(join(root, name), writable);
    if (!writable) await chmod(root, stat.mode & ~0o222);
    return;
  }
  await chmod(root, writable ? stat.mode | 0o200 : stat.mode & ~0o222);
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Detached worktree of the checkpoint commit in `root/<runId>/tree`, made from the common git directory. The
 * checkout reads no attributes from the tree or the global file, every filter and merge driver the configuration
 * names is blanked (`info/attributes` still applies), and no hook runs, so a filter or a hook the working agent
 * configured does not run. Files are made read-only after the checkout.
 * The per-file inputs go to `root/<runId>/inputs/files/<index>.diff`; the names are built from the index only.
 */
export class GitReviewerCheckouts implements ReviewerCheckouts {
  constructor(
    private readonly git: Git,
    /** Outside every checkout and outside the profile data directory. */
    private readonly root: string,
  ) {}

  async prepare(request: CheckoutRequest): Promise<ReviewerCheckout> {
    const base = join(this.root, request.runId);
    const cwd = join(base, 'tree');
    const inputsDir = join(base, 'inputs');
    await mkdir(inputsDir, { recursive: true, mode: 0o700 });
    try {
      await this.git.run(request.commonDir, [
        '--attr-source',
        EMPTY_TREE,
        '-c',
        'core.attributesFile=/dev/null',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        'worktree',
        'add',
        '--detach',
        '--',
        cwd,
        request.checkpointCommit,
      ], { blank: true });
      await this.writeInputs(inputsDir, request.inputFiles);
      await lock(cwd, false);
    } catch (error) {
      await this.remove(request.commonDir, base, cwd);
      throw error;
    }
    return { cwd, inputsDir, dispose: () => this.remove(request.commonDir, base, cwd) };
  }

  private async writeInputs(inputsDir: string, files: readonly PromptInputFile[]): Promise<void> {
    if (files.length === 0) return;
    await mkdir(join(inputsDir, 'files'), { recursive: true, mode: 0o700 });
    for (const file of files) {
      if (!/^files\/[0-9]+\.diff$/.test(file.name)) throw new Error(`input file name ${file.name} is not built from an index`);
      await writeFile(join(inputsDir, file.name), file.content, { mode: 0o400 });
    }
  }

  private async remove(commonDir: string, base: string, cwd: string): Promise<void> {
    await lock(base, true).catch(() => undefined);
    await this.git.removeWorktree(commonDir, cwd, true).catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  }
}
