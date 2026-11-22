// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, setValue } from '../../testing/dom';
import { flush, render, type Rendered } from '../../testing/render';
import { FileView, type FileViewProps } from './FileView';
import { CHANGESET, detailFixture, fileRecord, hunkRecord, reportRecord } from './reviewFixtures';
import { installReviewApi, type ReviewServer } from './reviewTestApi';

let rendered: Rendered | undefined;
let server: ReviewServer;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const hunks = (count: number) => Array.from({ length: count }, (_, index) => hunkRecord(0, index, ` keep\n-old ${index}\n+new ${index}`));

async function mount(options: { hunks?: ReturnType<typeof hunks>; props?: Partial<FileViewProps>; detail?: Parameters<typeof detailFixture>[0]; responders?: Record<string, unknown> } = {}): Promise<FileViewProps> {
  server = installReviewApi({ detail: detailFixture(options.detail), hunks: options.hunks ?? hunks(3) }, options.responders);
  const props: FileViewProps = { changesetId: CHANGESET, file: fileRecord(0, 'src/form.ts'), interactive: true, onBack: vi.fn(), onChanged: vi.fn(), ...options.props };
  rendered = await render(createElement(FileView, props));
  await flush();
  return props;
}

const press = (key: string, target: Element = document.activeElement ?? document.body) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));

describe('FileView', () => {
  it('loads the hunks of the file only, in order, and shows the path as text', async () => {
    await mount({ props: { file: fileRecord(0, 'src/<b>x</b>.ts') } });
    expect(server.calls('review_get'), 'one request for this file with its hunks').toEqual([{ changesetId: CHANGESET, hunks: true, file: 0 }]);
    expect(all('review-hunk').map((hunk) => hunk.getAttribute('data-hunk')), 'hunks in order').toEqual(['0', '1', '2']);
    expect(byId('review-file-title')?.textContent, 'the path shows as characters').toBe('src/<b>x</b>.ts');
    expect(document.querySelector('b'), 'no element came from the path').toBeNull();
  });

  it('shows a loading state, then the failure with a way back and a retry', async () => {
    let attempts = 0;
    await mount({
      responders: {
        review_get: () => {
          attempts += 1;
          return attempts === 1 ? { ok: false, error: { code: 'failed', message: 'the store is busy' } } : { ...detailFixture(), hunks: hunks(1) };
        },
      },
    });
    expect(byId('review-file-error')?.textContent, 'the failure message').toContain('the store is busy');
    await click([...document.querySelectorAll('button')].find((button) => button.textContent === 'Try again')!);
    expect(all('review-hunk'), 'the retry loads the hunks').toHaveLength(1);
  });

  it('shows a page of hunks, says how many it does not show and shows the next page on request', async () => {
    await mount({ hunks: hunks(45) });
    expect(all('review-hunk'), 'one page').toHaveLength(20);
    expect(byId('review-hunks-not-shown')?.textContent, 'the notice names the rest').toContain('25 more hunks of this file are not shown');
    await click(byId('review-show-more-hunks')!);
    expect(all('review-hunk'), 'two pages').toHaveLength(40);
    expect(byId('review-hunks-not-shown')?.textContent, 'the remainder').toContain('5 more hunks');
  });

  it('marks a hunk seen through review_seen at hunk level and tells the changeset view to reload', async () => {
    const props = await mount();
    await click(all('review-mark-hunk')[1]!);
    expect(server.calls('review_seen'), 'file index, hunk index and the manual mark').toEqual([{ changesetId: CHANGESET, level: 'hunk', how: 'marked', file: 0, hunk: 1 }]);
    expect(props.onChanged, 'the parent reloads its counts').toHaveBeenCalled();
    expect(all('review-hunk').map((hunk) => hunk.getAttribute('data-seen')), 'only the marked hunk shows as seen after the reload').toEqual(['false', 'true', 'false']);
  });

  it('puts findings under the hunk they point at and drafts under their line', async () => {
    const list = hunks(2);
    await mount({
      hunks: list,
      detail: { report: reportRecord({ findings: [{ ...reportRecord().findings[0]!, hunkHash: list[1]!.hunkHash, line: 11 }] }) },
    });
    const second = all('review-hunk')[1]!;
    expect(second.querySelector('[data-testid="review-finding"]'), 'the finding sits in the second hunk').not.toBeNull();
    expect(all('review-hunk')[0]!.querySelector('[data-testid="review-finding"]'), 'and not in the first').toBeNull();
  });

  it('stores a draft comment through review_comment with the file, side and line', async () => {
    await mount();
    await click(all('review-hunk')[0]!.querySelectorAll<HTMLElement>('[data-testid="review-comment-open"]')[2]!);
    await setValue(byId('review-comment-text') as HTMLTextAreaElement, 'Please explain');
    await click(byId('review-comment-add')!);
    expect(server.calls('review_comment'), 'file index, new side, line of the added line').toEqual([{ changesetId: CHANGESET, file: 0, side: 'new', line: 11, body: 'Please explain' }]);
    expect(byId('review-draft')?.textContent, 'the draft shows under the line after the reload').toContain('Please explain');
  });

  describe('keys', () => {
    it('moves between hunks with j and k and stops at the ends', async () => {
      await mount();
      const list = all('review-hunk');
      await press('j', byId('review-file')!);
      expect(document.activeElement, 'first j focuses the first hunk').toBe(list[0]);
      await press('j');
      await press('j');
      await press('j');
      expect(document.activeElement, 'stays on the last hunk').toBe(list[2]);
      await press('k');
      expect(document.activeElement, 'k goes back one').toBe(list[1]);
    });

    it('marks the focused hunk with m and jumps to the next unseen hunk with n', async () => {
      await mount();
      const list = all('review-hunk');
      list[0]!.focus();
      await press('m');
      expect(server.calls('review_seen'), 'm marks the focused hunk as marked by hand').toEqual([{ changesetId: CHANGESET, level: 'hunk', how: 'marked', file: 0, hunk: 0 }]);
      await flush();
      await press('n', all('review-hunk')[0]);
      expect(document.activeElement, 'n skips the seen hunk').toBe(all('review-hunk')[1]);
    });

    it('does not mark anything when m is typed in a comment box or when the changeset takes no decisions', async () => {
      await mount();
      await click(all('review-hunk')[0]!.querySelectorAll<HTMLElement>('[data-testid="review-comment-open"]')[2]!);
      const box = byId('review-comment-text') as HTMLTextAreaElement;
      box.focus();
      await press('m', box);
      expect(server.calls('review_seen'), 'typing m in a text box marks nothing').toEqual([]);
      await rendered!.unmount();
      await mount({ props: { interactive: false } });
      all('review-hunk')[0]!.focus();
      await press('m');
      expect(server.calls('review_seen'), 'a closed changeset takes no mark').toEqual([]);
    });

    it('opens the next page when j moves past the last shown hunk', async () => {
      await mount({ hunks: hunks(25) });
      all('review-hunk')[19]!.focus();
      await press('j');
      await flush();
      expect(all('review-hunk'), 'the next page opened').toHaveLength(25);
      expect(document.activeElement, 'focus is on the first hunk of the new page').toBe(all('review-hunk')[20]);
    });
  });

  describe('a file without hunks', () => {
    it('says why and is seen by its own mark', async () => {
      await mount({ hunks: [], props: { file: fileRecord(1, 'logo.png', { kind: 'binary' }) } });
      expect(byId('review-hunkless')?.textContent, 'the notice for a binary file').toContain('Binary file');
      await click(byId('review-mark-file')!);
      expect(server.calls('review_seen'), 'file level mark').toEqual([{ changesetId: CHANGESET, level: 'file', how: 'marked', file: 1 }]);
    });
  });

  it('returns to the changeset', async () => {
    const props = await mount();
    await click(byId('review-file-back')!);
    expect(props.onBack).toHaveBeenCalled();
  });
});
