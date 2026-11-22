// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, setValue } from '../../testing/dom';
import { render, type Rendered } from '../../testing/render';
import { HunkView, type HunkViewProps } from './HunkView';
import { BODY, commentRecord, fileRecord, hunkRecord, reportRecord } from './reviewFixtures';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, 'IntersectionObserver');
});

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

const props = (patch: Partial<HunkViewProps> = {}): HunkViewProps => ({
  hunk: hunkRecord(0, 0, BODY),
  file: fileRecord(0, 'src/form.ts'),
  findings: [],
  drafts: [],
  seen: false,
  interactive: true,
  onMarkSeen: vi.fn(),
  onComment: vi.fn(async () => undefined),
  onDeleteDraft: vi.fn(async () => undefined),
  ...patch,
});

async function mount(patch: Partial<HunkViewProps> = {}): Promise<HunkViewProps> {
  const value = props(patch);
  rendered = await render(createElement(HunkView, value));
  return value;
}

describe('HunkView lines', () => {
  it('shows line numbers on both sides and the glyph of each line in its own column', async () => {
    await mount();
    const rows = all('review-line');
    expect(rows.map((row) => row.getAttribute('data-kind')), 'kind per line').toEqual(['ctx', 'del', 'add', 'add']);
    const cells = (row: HTMLElement) => [...row.querySelectorAll('td')].map((cell) => cell.textContent);
    expect(cells(rows[1]!).slice(0, 3), 'a removed line has an old number and the minus glyph').toEqual(['11', '', '-removed']);
    expect(cells(rows[2]!).slice(0, 3), 'an added line has a new number and the plus glyph').toEqual(['', '11', '+added']);
    expect(rows[2]!.querySelector('.review-glyph')?.textContent, 'the glyph column also carries the word for assistive technology').toContain('added');
  });

  it('shows the text of a line as text, with hidden characters escaped and markup left alone', async () => {
    const hostile = ' <img src=x onerror=alert(1)>\n+path‮gnp.exe\n+tab\there';
    await mount({ hunk: hunkRecord(0, 0, hostile) });
    expect(document.querySelector('img'), 'no element was created from agent text').toBeNull();
    const text = all('review-line').map((row) => row.querySelector('.review-code')?.textContent);
    expect(text[0], 'markup shows as characters').toBe('<img src=x onerror=alert(1)>');
    expect(text[1], 'the override is escaped').toBe('path\\u{202E}gnp.exe');
    expect(text[2], 'a tab inside a line stays readable').toBe('tab\there');
  });

  it('marks a line that ends with a carriage return and a note about the missing final newline', async () => {
    await mount({ hunk: hunkRecord(0, 0, '+one\r\n+two\n\\ No newline at end of file') });
    expect(document.querySelectorAll('.review-marker')).toHaveLength(1);
    expect(document.body.textContent, 'the CRLF marker shows').toContain('CRLF');
    expect(document.body.textContent, 'the note line shows').toContain('No newline at end of file');
  });

  it('shows a page of lines of a long hunk, says how many it does not show and shows more on request', async () => {
    const long = Array.from({ length: 900 }, (_, index) => `+line ${index}`).join('\n');
    await mount({ hunk: hunkRecord(0, 0, long) });
    expect(all('review-line'), 'one page of lines').toHaveLength(400);
    expect(byId('review-lines-not-shown')?.textContent, 'the notice names the lines left out').toContain('500 more lines of this hunk are not shown');
    await click(byId('review-show-more-lines')!);
    expect(all('review-line'), 'a second page').toHaveLength(800);
    expect(byId('review-lines-not-shown')?.textContent, 'the notice follows the remainder').toContain('100 more lines');
    await click(byId('review-show-more-lines')!);
    expect(byId('review-lines-not-shown'), 'no notice once everything shows').toBeNull();
  });

  it('shows a finding under its line with its severity, its author and its text as plain text', async () => {
    const finding = { ...reportRecord().findings[0]!, line: 11, title: '<b>Empty</b> name', body: 'Check‮ it' };
    await mount({ findings: [finding] });
    const shown = byId('review-finding')!;
    expect(shown.getAttribute('data-severity'), 'severity').toBe('major');
    expect(shown.textContent, 'title as text and body escaped').toContain('<b>Empty</b> name');
    expect(shown.textContent, 'body escaped').toContain('Check\\u{202E} it');
    expect(shown.textContent, 'author line').toContain('Text written by the reviewer agent');
    expect(shown.closest('tr')?.previousElementSibling?.getAttribute('data-line'), 'it follows line 11 of the new side').toBe('11');
  });

  it('lists a finding on a line that is not shown in a separate block instead of dropping it', async () => {
    const long = Array.from({ length: 450 }, (_, index) => `+line ${index}`).join('\n');
    const late = { ...reportRecord().findings[0]!, line: 10 + 440 };
    await mount({ hunk: hunkRecord(0, 0, long, { newStart: 10 }), findings: [late] });
    expect(byId('review-off-screen')?.textContent, 'the finding of a hidden line stays visible').toContain('Empty name accepted');
  });
});

describe('HunkView comments', () => {
  it('opens a comment box on a line and hands the side, line and text to the caller', async () => {
    const value = await mount();
    const removed = all('review-line')[1]!;
    await click(removed.querySelector('[data-testid="review-comment-open"]')!);
    expect(byId('review-composer'), 'the box opens under the line').not.toBeNull();
    await setValue(byId('review-comment-text') as HTMLTextAreaElement, '  Why remove this?  ');
    await click(byId('review-comment-add')!);
    expect(value.onComment, 'old side for a removed line, trimmed text').toHaveBeenCalledWith('old', 11, 'Why remove this?');
    expect(byId('review-composer'), 'the box closes once the draft is stored').toBeNull();
  });

  it('closes the comment box on Escape and returns the focus to the button of the line', async () => {
    await mount();
    const opener = all('review-line')[2]!.querySelector<HTMLElement>('[data-testid="review-comment-open"]')!;
    await click(opener);
    const field = byId('review-comment-text') as HTMLTextAreaElement;
    await setValue(field, 'unsent');
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await act(async () => undefined);
    expect(byId('review-composer'), 'the box is gone').toBeNull();
    expect(document.activeElement, 'the button of the line has the focus').toBe(opener);
  });

  it('keeps the box open and shows the failure when the comment is refused', async () => {
    const value = await mount({ onComment: vi.fn(async () => 'that line is not in the diff') });
    await click(all('review-line')[2]!.querySelector('[data-testid="review-comment-open"]')!);
    await setValue(byId('review-comment-text') as HTMLTextAreaElement, 'text');
    await click(byId('review-comment-add')!);
    expect(value.onComment).toHaveBeenCalledWith('new', 11, 'text');
    expect(byId('review-composer')?.textContent, 'the refusal shows in the box').toContain('that line is not in the diff');
  });

  it('shows drafts under their line and deletes one on request', async () => {
    const value = await mount({ drafts: [commentRecord({ line: 11, side: 'new', body: 'Why not trim?' })] });
    expect(byId('review-draft')?.textContent, 'draft text and its state').toContain('Why not trim?');
    expect(byId('review-draft')?.textContent, 'what happens to it').toContain('Sent with the next send-back');
    await click(byId('review-draft-delete')!);
    expect(value.onDeleteDraft).toHaveBeenCalledWith('cm1');
  });

  it('offers no comment box, no mark and no delete when the changeset takes no decisions', async () => {
    await mount({ interactive: false, drafts: [commentRecord()] });
    expect(byId('review-comment-open'), 'no comment button').toBeNull();
    expect(byId('review-mark-hunk'), 'no mark button').toBeNull();
    expect(byId('review-draft-delete'), 'no delete button').toBeNull();
  });
});

describe('HunkView seen marks', () => {
  it('marks the hunk seen by hand and shows the mark once the view says it is seen', async () => {
    const value = await mount();
    expect(byId('review-hunk')?.getAttribute('data-seen'), 'not seen at first').toBe('false');
    await click(byId('review-mark-hunk')!);
    expect(value.onMarkSeen, 'marked by hand').toHaveBeenCalledWith('marked');
    await rendered!.rerender(createElement(HunkView, { ...value, seen: true }));
    expect(byId('review-hunk')?.getAttribute('data-seen'), 'seen').toBe('true');
    expect(byId('review-mark-hunk'), 'no button once seen').toBeNull();
  });

  describe('by dwell', () => {
    let observe: (isIntersecting: boolean, ratio: number) => void;
    let created = 0;
    beforeEach(() => {
      vi.useFakeTimers();
      created = 0;
      class FakeObserver {
        constructor(private readonly callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
          created++;
          observe = (isIntersecting, ratio) => this.callback([{ isIntersecting, intersectionRatio: ratio }]);
        }
        observe(): void {}
        disconnect(): void {}
      }
      (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver;
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    });

    it('marks the hunk after half of it stayed in view for the dwell time while the window had focus', async () => {
      const value = await mount({ dwellMs: 1_500 });
      await act(async () => observe(true, 0.6));
      await act(async () => void vi.advanceTimersByTime(1_499));
      expect(value.onMarkSeen, 'not yet after a shorter time').not.toHaveBeenCalled();
      await act(async () => void vi.advanceTimersByTime(2));
      expect(value.onMarkSeen, 'marked as a dwell').toHaveBeenCalledWith('dwell');
    });

    it('does not mark a hunk that left the view before the dwell time or showed less than half', async () => {
      const value = await mount({ dwellMs: 1_500 });
      await act(async () => observe(true, 0.4));
      await act(async () => void vi.advanceTimersByTime(3_000));
      expect(value.onMarkSeen, 'less than half in view').not.toHaveBeenCalled();
      await act(async () => observe(true, 0.8));
      await act(async () => void vi.advanceTimersByTime(1_000));
      await act(async () => observe(false, 0));
      await act(async () => void vi.advanceTimersByTime(3_000));
      expect(value.onMarkSeen, 'left the view in time').not.toHaveBeenCalled();
    });

    it('does not count time in a window without focus', async () => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      const value = await mount({ dwellMs: 1_500 });
      await act(async () => observe(true, 1));
      await act(async () => void vi.advanceTimersByTime(5_000));
      expect(value.onMarkSeen, 'an unfocused window does not read').not.toHaveBeenCalled();
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      await act(async () => void window.dispatchEvent(new Event('focus')));
      await act(async () => void vi.advanceTimersByTime(1_600));
      expect(value.onMarkSeen, 'counting starts when focus returns').toHaveBeenCalledWith('dwell');
    });

    it('records nothing for a hunk that is seen already', async () => {
      const seen = await mount({ seen: true, dwellMs: 100 });
      expect(created, 'nothing watches a hunk that is seen').toBe(0);
      await act(async () => void vi.advanceTimersByTime(500));
      expect(seen.onMarkSeen, 'already seen').not.toHaveBeenCalled();
    });

    it('records nothing for a changeset that takes no decisions', async () => {
      const value = await mount({ interactive: false, dwellMs: 100 });
      expect(created, 'nothing watches a hunk of a closed changeset').toBe(0);
      await act(async () => void vi.advanceTimersByTime(500));
      expect(value.onMarkSeen, 'a superseded changeset gets no marks').not.toHaveBeenCalled();
    });
  });
});
