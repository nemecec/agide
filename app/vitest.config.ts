import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/core/**/*.test.ts', 'src/main/**/*.test.ts', 'src/shared/**/*.test.ts', 'src/renderer/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/fixtures/**',
        'src/core/session/FakeSessionService.ts',
        'src/core/mcp/testHarness.ts',
        'src/core/tree/treeServiceContract.ts',
        'src/core/profile/profileContracts.ts',
        'src/core/isolation/isolationProviderContract.ts',
        'src/core/blocks/blockRegistryContract.ts',
        'src/core/inbox/inboxServiceContract.ts',
        'src/main/appForTests.ts',
        'src/renderer/testing/**',
      ],
      thresholds: {
        'src/core/**': { statements: 92, branches: 81, functions: 94, lines: 95 },
        'src/main/**': { statements: 65, branches: 50, functions: 68, lines: 68 },
        'src/main/modules/**': { statements: 77, branches: 61, functions: 77, lines: 80 },
        'src/shared/**': { statements: 98, functions: 98, lines: 98 },
        // Renderer files with logic that runs in Node or jsdom; the components without a unit test are covered by the end-to-end tests only.
        'src/renderer/{layout/{dockviewAdapter,hostModel,useLayoutState},panes/{treeModel,profileModel,useTreeNodes,useProfiles,TerminalPane,InboxPane},panes/inbox/{format,useInbox,ItemCard}}.{ts,tsx}': {
          statements: 93,
          branches: 87,
          functions: 88,
          lines: 95,
        },
      },
    },
  },
});
