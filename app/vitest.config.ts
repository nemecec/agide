import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/core/**/*.test.ts', 'src/main/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/fixtures/**',
        'src/core/session/FakeSessionService.ts',
        'src/core/mcp/testHarness.ts',
        'src/core/tree/treeServiceContract.ts',
        'src/main/appForTests.ts',
      ],
      thresholds: {
        'src/core/**': { statements: 85, branches: 70, functions: 85, lines: 85 },
        'src/main/modules/**': { statements: 70, branches: 55, functions: 65, lines: 70 },
      },
    },
  },
});
