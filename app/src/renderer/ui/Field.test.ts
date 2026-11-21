// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseOption, setValue } from '../testing/dom';
import { installFakeApi } from '../testing/fakeApi';
import { render, type Rendered } from '../testing/render';
import { Field, TextArea, TextField } from './Field';
import { Select } from './Select';

let rendered: Rendered | undefined;
beforeEach(() => void installFakeApi());
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  document.body.innerHTML = '';
});

const input = () => rendered!.container.querySelector('input')!;

describe('TextField', () => {
  it('links its label to the control', async () => {
    rendered = await render(createElement(TextField, { label: 'Title' }));
    expect(rendered.container.querySelector('label')?.getAttribute('for'), 'the label points at the input').toBe(input().id);
  });

  it('shows help below the control and links it by aria-describedby', async () => {
    rendered = await render(createElement(TextField, { label: 'Title', help: 'Shown in the tree' }));
    const note = rendered.container.querySelector('.ui-field-note')!;
    expect(note.textContent, 'help text').toBe('Shown in the tree');
    expect(input().getAttribute('aria-describedby'), 'the control is described by the help').toBe(note.id);
    expect(input().getAttribute('aria-invalid'), 'help is not an error').toBeNull();
  });

  it('marks the control invalid and replaces the help with an error that starts with an icon', async () => {
    rendered = await render(createElement(TextField, { label: 'Title', help: 'Shown in the tree', error: 'Enter a title' }));
    const note = rendered.container.querySelector('.ui-field-note')!;
    expect(input().getAttribute('aria-invalid'), 'invalid state').toBe('true');
    expect(note.textContent, 'the error replaces the help').toBe('Enter a title');
    expect(note.firstElementChild?.tagName.toLowerCase(), 'the error starts with an icon, so it does not rest on colour').toBe('svg');
    expect(input().getAttribute('aria-describedby'), 'the control is described by the error').toBe(note.id);
  });

  it('passes read-only and mono state to the stylesheet', async () => {
    rendered = await render(createElement(TextField, { label: 'Path', readOnly: true, mono: true, defaultValue: '/a' }));
    expect(input().readOnly, 'read-only').toBe(true);
    expect(input().hasAttribute('data-mono'), 'mono step').toBe(true);
    expect(input().value, 'the value stays readable').toBe('/a');
  });
});

describe('TextArea', () => {
  it('starts at three rows and reports changes', async () => {
    const onChange = vi.fn();
    rendered = await render(createElement(TextArea, { label: 'Notes', onChange }));
    const area = rendered.container.querySelector('textarea')!;
    expect(area.rows, 'minimum rows').toBe(3);
    await setValue(area, 'text');
    expect(onChange, 'change reported').toHaveBeenCalledTimes(1);
  });
});

function Chosen({ onChange }: { readonly onChange: (value: string) => void }) {
  const [value, setValue] = useState('a');
  return createElement(Field, {
    label: 'Parent',
    error: undefined,
    children: (control) =>
      createElement(Select, {
        ...control,
        value,
        onValueChange: (next: string) => {
          setValue(next);
          onChange(next);
        },
        options: [
          { value: '', label: 'Top level' },
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta', disabled: true },
        ],
      }),
  });
}

describe('Select', () => {
  it('is named by the label of its Field and shows the chosen option', async () => {
    rendered = await render(createElement(Chosen, { onChange: () => undefined }));
    const trigger = rendered.container.querySelector<HTMLElement>('[role="combobox"]')!;
    expect(trigger.textContent, 'trigger shows the label of the value').toBe('Alpha');
    expect(trigger.getAttribute('data-value'), 'trigger carries the value').toBe('a');
    expect(rendered.container.querySelector('label')?.getAttribute('for'), 'label points at the trigger').toBe(trigger.id);
  });

  it('reports an empty option as the empty string, which Radix would refuse as a value', async () => {
    const onChange = vi.fn();
    rendered = await render(createElement(Chosen, { onChange }));
    await chooseOption(rendered.container.querySelector('[role="combobox"]')!, 'Top level');
    expect(onChange, 'the empty option arrives as an empty string').toHaveBeenCalledWith('');
  });

  it('offers a disabled option as disabled', async () => {
    rendered = await render(createElement(Chosen, { onChange: () => undefined }));
    const trigger = rendered.container.querySelector<HTMLElement>('[role="combobox"]')!;
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const beta = [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === 'Beta');
    expect(beta?.getAttribute('aria-disabled'), 'the disabled option cannot be chosen').toBe('true');
  });
});
