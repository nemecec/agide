export { applyPatch, patchOperationSchema, type PatchOperation } from './jsonPatch';
export { migrateLayout, LAYOUT_MIGRATIONS, type LayoutMigration } from './migrations';
export { diffLayouts, describeDiff, isEmptyDiff, type LayoutDiff } from './diff';
export { validateLayoutDocument, type LayoutReport } from './validate';
export { InMemoryLayoutHistory, SqliteLayoutHistory, type LayoutHistory } from './LayoutHistory';
export { LayoutFiles } from './LayoutFiles';
export { LayoutManager, LayoutError, DEFAULT_LAYOUT_ID, type LayoutView, type ApplyResult } from './LayoutManager';
export { maskedInstances } from './mask';
export { registerLayoutCommands, MAIN_WINDOW, type WindowCapturer, type CaptureRequest, type WindowCapture } from './commands';
