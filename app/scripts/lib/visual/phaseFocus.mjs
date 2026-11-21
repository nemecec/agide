// State 13: keyboard focus. Walks Tab through the main window, records what has focus and whether a ring is drawn.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, menu, shoot, sleep, startApp } from './harness.mjs';
import { seedWorkspace } from './seed.mjs';

const describeFocus = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return { element: 'body' };
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    element: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    label: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40),
    testid: el.getAttribute('data-testid'),
    outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
    boxShadow: style.boxShadow,
    size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
  };
};

export async function phaseFocus(context) {
  const instance = await startApp(context, { name: 'focus' });
  try {
    await seedWorkspace(instance);
    const trail = [];
    await instance.page.getByRole('treeitem', { name: 'Notes', exact: true }).click();
    await instance.page.keyboard.press('Escape');
    await instance.page.evaluate(() => {
      const start = document.createElement('span');
      start.tabIndex = -1;
      document.body.prepend(start);
      start.focus();
      start.remove();
    });
    for (let step = 0; step < 14; step++) {
      await instance.page.keyboard.press('Tab');
      await sleep(150);
      const focus = await instance.page.evaluate(describeFocus);
      trail.push({ step: step + 1, ...focus });
      if ([1, 2, 3, 5, 8].includes(step + 1)) await shoot(context, instance, `13-focus-main-tab-${String(step + 1).padStart(2, '0')}`);
    }
    await instance.page.getByRole('treeitem', { name: 'Notes', exact: true }).focus();
    await instance.page.keyboard.press('ArrowDown');
    await sleep(200);
    await shoot(context, instance, '13-focus-tree-arrow');
    await menu(instance, 'Backend', 'New Claude session…');
    await instance.page.getByTestId('new-session-dialog').waitFor();
    const dialogTrail = [];
    for (let step = 0; step < 6; step++) {
      await instance.page.keyboard.press('Tab');
      await sleep(150);
      dialogTrail.push({ step: step + 1, ...(await instance.page.evaluate(describeFocus)) });
      if (step === 1 || step === 3) await shoot(context, instance, `13-focus-dialog-tab-${step + 1}`);
    }
    writeFileSync(join(context.run.shots, 'focus-order.json'), JSON.stringify({ main: trail, dialog: dialogTrail }, null, 2));
  } finally {
    await closeApp(instance);
  }
}
