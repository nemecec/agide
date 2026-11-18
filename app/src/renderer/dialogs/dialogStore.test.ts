import { afterEach, describe, expect, it } from 'vitest';
import { closeDialog, currentDialog, openDialog } from './dialogStore';

afterEach(closeDialog);

describe('dialog store', () => {
  it('shows one dialog at a time and closes it', () => {
    openDialog({ kind: 'new-task', parentFolderId: null });
    openDialog({ kind: 'settings' });
    expect(currentDialog(), 'the later request replaces the earlier one').toEqual({ kind: 'settings' });
    closeDialog();
    expect(currentDialog(), 'closed').toBeNull();
  });
});
