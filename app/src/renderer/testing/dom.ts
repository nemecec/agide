import { act } from 'react';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Sets the value of a form field the way a user's input does, so React's change handler runs. */
export async function setValue(field: Field, value: string): Promise<void> {
  const prototype = Object.getPrototypeOf(field) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

export const click = (element: Element): Promise<void> => act(async () => (element as HTMLElement).click());

/** Opens a Select from its trigger with the keyboard and picks the option with the given label. */
export async function chooseOption(trigger: Element, label: string): Promise<void> {
  await act(async () => {
    (trigger as HTMLElement).focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) => candidate.textContent === label);
  if (!option) throw new Error(`no option "${label}" in the open list`);
  await click(option);
}
