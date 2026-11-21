// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click } from '../testing/dom';
import { render, type Rendered } from '../testing/render';
import { Badge } from './Badge';
import { Banner } from './Banner';
import { Chip, StatusChip } from './Chip';
import { EmptyState } from './EmptyState';
import { Notice } from './Notice';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table';
import { SURFACE_ICONS } from './icons';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const root = () => rendered!.container;

describe('Banner', () => {
  it('is an alert for danger and a status message for the other tones', async () => {
    rendered = await render(createElement(Banner, { tone: 'danger', message: 'Failed' }));
    expect(root().firstElementChild?.getAttribute('role'), 'danger announces itself').toBe('alert');
    await rendered.rerender(createElement(Banner, { tone: 'warning', message: 'Careful' }));
    expect(root().firstElementChild?.getAttribute('role'), 'warning is a status').toBe('status');
  });

  it('draws a tone icon beside the message, so the tone does not rest on colour', async () => {
    rendered = await render(createElement(Banner, { tone: 'warning', message: 'Careful' }));
    expect(root().querySelector('svg'), 'tone icon').not.toBeNull();
    expect(root().textContent, 'message').toBe('Careful');
  });

  it('offers a named dismiss button only when it can be dismissed', async () => {
    const onDismiss = vi.fn();
    rendered = await render(createElement(Banner, { message: 'Hello' }));
    expect(root().querySelector('button'), 'no dismiss without a handler').toBeNull();
    await rendered.rerender(createElement(Banner, { message: 'Hello', onDismiss }));
    const dismiss = root().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    await click(dismiss);
    expect(onDismiss, 'dismissed').toHaveBeenCalledTimes(1);
  });
});

describe('Notice', () => {
  it('lets a static danger note be a status, and announces an error as an alert by default', async () => {
    rendered = await render(createElement(Notice, { tone: 'danger', children: 'Not installed' }));
    expect(root().firstElementChild?.getAttribute('role'), 'default for danger').toBe('alert');
    await rendered.rerender(createElement(Notice, { tone: 'danger', role: 'status', children: 'Not installed' }));
    expect(root().firstElementChild?.getAttribute('role'), 'override').toBe('status');
  });
});

describe('Chip', () => {
  it('names an icon-only chip for assistive technology', async () => {
    rendered = await render(createElement(Chip, { tone: 'warning', icon: SURFACE_ICONS.task.icon, label: 'Waiting', iconOnly: true }));
    const chip = root().querySelector('[role="img"]')!;
    expect(chip.getAttribute('aria-label'), 'name of the icon-only chip').toBe('Waiting');
    expect(chip.textContent, 'no visible text').toBe('');
  });

  it('shows the word beside the icon otherwise', async () => {
    rendered = await render(createElement(Chip, { label: 'Temporary' }));
    expect(root().textContent, 'visible word').toBe('Temporary');
  });
});

describe('StatusChip', () => {
  it('shows the status word with its tone and spins only while busy', async () => {
    rendered = await render(createElement(StatusChip, { status: 'busy' }));
    expect(root().textContent, 'default word').toBe('Busy');
    expect(root().querySelector('.ui-chip')?.getAttribute('data-tone'), 'busy is the info tone').toBe('info');
    expect(root().querySelector('.ui-spin'), 'busy spins').not.toBeNull();
    await rendered.rerender(createElement(StatusChip, { status: 'failed' }));
    expect(root().querySelector('.ui-chip')?.getAttribute('data-tone'), 'failed is the danger tone').toBe('danger');
    expect(root().querySelector('.ui-spin'), 'failed does not spin').toBeNull();
  });
});

describe('Badge', () => {
  it('reads the count and what it counts, and caps the drawn number', async () => {
    rendered = await render(createElement(Badge, { count: 120, label: 'unread' }));
    expect(root().textContent, 'drawn and read text').toContain('99+');
    expect(root().textContent, 'read text carries the real count').toContain('120 unread');
  });

  it('reads only the label for a dot', async () => {
    rendered = await render(createElement(Badge, { label: 'running' }));
    expect(root().textContent, 'dot text').toBe('running');
  });
});

describe('EmptyState', () => {
  it('shows the title and the help line', async () => {
    rendered = await render(createElement(EmptyState, { icon: SURFACE_ICONS.folder.icon, title: 'Nothing waits for you', help: 'New items appear here.' }));
    expect(root().textContent, 'title and help').toBe('Nothing waits for youNew items appear here.');
  });
});

describe('Table', () => {
  it('right aligns numbers, scopes headers to columns and marks the selected row', async () => {
    rendered = await render(
      createElement(Table, {
        children: [
          createElement(TableHead, { key: 'h', children: createElement('tr', null, createElement(TableHeader, { children: 'Name' }), createElement(TableHeader, { numeric: true, children: 'Cost' })) }),
          createElement(TableBody, { key: 'b', children: createElement(TableRow, { selected: true, children: [createElement(TableCell, { key: 'a', children: 'x' }), createElement(TableCell, { key: 'b', numeric: true, children: '1' })] }) }),
        ],
      }),
    );
    expect(root().querySelector('th')?.getAttribute('scope'), 'column header scope').toBe('col');
    expect(root().querySelector('td[data-numeric]')?.textContent, 'numeric cell').toBe('1');
    expect(root().querySelector('tbody tr')?.getAttribute('data-selected'), 'selected row').toBe('true');
  });
});
