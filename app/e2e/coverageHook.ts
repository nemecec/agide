import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/**
 * Coverage collection for `pnpm coverage:e2e`. With `AGIDE_E2E_COVERAGE_DIR` set, every launched app writes V8
 * coverage of its main process (`NODE_V8_COVERAGE`) to `<dir>/main` and of each window to `<dir>/renderer`.
 * Without the variable the tests run unchanged.
 */
export function installCoverageHook(dir: string | undefined): void {
  if (!dir) return;
  const launch = electron.launch.bind(electron);
  electron.launch = async (options) => {
    // A spec that passes its own environment has removed variables on purpose (the inherited Claude login), so
    // the process environment is the base only when the spec passes none, as in `electron.launch` itself.
    const app = await launch({ ...options, env: { ...(options?.env ?? process.env), NODE_V8_COVERAGE: join(dir, 'main') } as Record<string, string> });
    watchWindows(app, join(dir, 'renderer'));
    return app;
  };
}

function watchWindows(app: ElectronApplication, outDir: string): void {
  const started = new Set<Page>();
  const start = async (page: Page) => {
    try {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      started.add(page);
    } catch {
      // The window closed before coverage started.
    }
  };
  for (const page of app.windows()) void start(page);
  app.on('window', (page) => void start(page));

  const close = app.close.bind(app);
  app.close = async () => {
    mkdirSync(outDir, { recursive: true });
    for (const page of started) {
      try {
        const entries = await page.coverage.stopJSCoverage();
        writeFileSync(join(outDir, `${randomUUID()}.json`), JSON.stringify(entries));
      } catch {
        // The window is gone; its coverage is lost.
      }
    }
    // The app leaves through `app.exit`, which may skip Node's exit hook; the main-process counters are written now.
    await app.evaluate(() => (require('node:v8') as { takeCoverage(): void }).takeCoverage()).catch(() => undefined);
    await close();
  };
}
