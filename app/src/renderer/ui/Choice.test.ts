// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click } from '../testing/dom';
import { render, type Rendered } from '../testing/render';
import { Checkbox } from './Checkbox';
import { RadioGroup, RadioItem } from './RadioGroup';
import { SegmentedControl } from './SegmentedControl';
import { Switch } from './Switch';
import { Tab, TabList, TabPanel, Tabs } from './Tabs';

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
const find = (selector: string) => rendered!.container.querySelector<HTMLElement>(selector)!;

describe('Checkbox', () => {
  it('toggles from a click on its label text and reports a boolean', async () => {
    const onCheckedChange = vi.fn();
    rendered = await render(createElement(Checkbox, { checked: false, onCheckedChange, label: 'I understand' }));
    await click(find('.ui-check-text'));
    expect(onCheckedChange, 'the label is part of the click target').toHaveBeenCalledWith(true);
    expect(find('[role="checkbox"]').getAttribute('aria-checked'), 'unchecked state').toBe('false');
  });

  it('reports the indeterminate state to assistive technology and marks an invalid box', async () => {
    rendered = await render(createElement(Checkbox, { checked: 'indeterminate', invalid: true, onCheckedChange: () => undefined, label: 'All' }));
    expect(find('[role="checkbox"]').getAttribute('aria-checked'), 'mixed state').toBe('mixed');
    expect(find('[role="checkbox"]').getAttribute('aria-invalid'), 'invalid state').toBe('true');
  });

  it('does not toggle while disabled', async () => {
    const onCheckedChange = vi.fn();
    rendered = await render(createElement(Checkbox, { checked: false, disabled: true, onCheckedChange, label: 'Locked' }));
    await click(find('[role="checkbox"]'));
    expect(onCheckedChange, 'disabled box ignores clicks').not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('reports the new state on click', async () => {
    const onCheckedChange = vi.fn();
    rendered = await render(createElement(Switch, { checked: false, onCheckedChange, label: 'Vibrancy' }));
    await click(find('[role="switch"]'));
    expect(onCheckedChange, 'switch on').toHaveBeenCalledWith(true);
  });
});

function Radios({ onChange }: { readonly onChange: (value: string) => void }) {
  const [value, setValue] = useState('local');
  return createElement(RadioGroup, {
    value,
    'aria-label': 'Provider',
    onValueChange: (next: string) => {
      setValue(next);
      onChange(next);
    },
    children: [
      createElement(RadioItem, { key: 'local', value: 'local', label: 'Local' }),
      createElement(RadioItem, { key: 'srt', value: 'srt', label: 'Sandbox', disabled: true }),
      createElement(RadioItem, { key: 'container', value: 'container', label: 'Container' }),
    ],
  });
}

describe('RadioGroup', () => {
  it('checks one item and reports a click on another', async () => {
    const onChange = vi.fn();
    rendered = await render(createElement(Radios, { onChange }));
    const radios = [...rendered.container.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.map((radio) => radio.getAttribute('aria-checked')), 'only the first is checked').toEqual(['true', 'false', 'false']);
    await click(radios[2]!);
    expect(onChange, 'the choice is reported').toHaveBeenCalledWith('container');
  });

  it('cannot choose a disabled item', async () => {
    const onChange = vi.fn();
    rendered = await render(createElement(Radios, { onChange }));
    await click(rendered.container.querySelectorAll<HTMLElement>('[role="radio"]')[1]!);
    expect(onChange, 'disabled item ignores clicks').not.toHaveBeenCalled();
  });
});

function Segments({ onChange }: { readonly onChange: (value: string) => void }) {
  const [value, setValue] = useState('open');
  return createElement(SegmentedControl, {
    value,
    'aria-label': 'Filter',
    segments: [
      { value: 'open', label: 'Open' },
      { value: 'done', label: 'Done' },
    ],
    onValueChange: (next: string) => {
      setValue(next);
      onChange(next);
    },
  });
}

describe('SegmentedControl', () => {
  it('selects the pressed segment and reports it', async () => {
    const onChange = vi.fn();
    rendered = await render(createElement(Segments, { onChange }));
    await click([...rendered.container.querySelectorAll<HTMLElement>('.ui-segment')].find((segment) => segment.textContent === 'Done')!);
    expect(onChange, 'the new value is reported').toHaveBeenCalledWith('done');
    expect(find('[data-state="on"]').textContent, 'the pressed segment is selected').toBe('Done');
  });

  it('keeps the selected segment selected when it is pressed again', async () => {
    const onChange = vi.fn();
    rendered = await render(createElement(Segments, { onChange }));
    await click(find('[data-state="on"]'));
    expect(onChange, 'pressing the selected segment does not clear the value').not.toHaveBeenCalled();
    expect(find('[data-state="on"]').textContent, 'still selected').toBe('Open');
  });
});

describe('Tabs', () => {
  it('shows the panel of the selected tab and switches with the arrow keys', async () => {
    rendered = await render(
      createElement(Tabs, {
        defaultValue: 'a',
        children: [
          createElement(TabList, { key: 'l', 'aria-label': 'Sections', children: [createElement(Tab, { key: 'a', value: 'a', children: 'One' }), createElement(Tab, { key: 'b', value: 'b', children: 'Two' })] }),
          createElement(TabPanel, { key: 'pa', value: 'a', children: 'First panel' }),
          createElement(TabPanel, { key: 'pb', value: 'b', children: 'Second panel' }),
        ],
      }),
    );
    expect(find('[role="tabpanel"]').textContent, 'first panel shows').toBe('First panel');
    const [first, second] = [...rendered.container.querySelectorAll<HTMLElement>('[role="tab"]')] as [HTMLElement, HTMLElement];
    first.focus();
    await act(async () => {
      key(first, 'ArrowRight');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(find('[role="tabpanel"]:not([hidden])').textContent, 'the arrow key moves to the second tab and shows its panel').toBe('Second panel');
    expect(second.getAttribute('aria-selected'), 'the tab reports its selection').toBe('true');
  });
});
