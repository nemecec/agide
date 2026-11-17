import { defineConfig } from '@playwright/test';
import { installCoverageHook } from './e2e/coverageHook';

installCoverageHook(process.env['AGIDE_E2E_COVERAGE_DIR']);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
});
