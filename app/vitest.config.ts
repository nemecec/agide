import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
        // Test helpers of the srt and container tests; they run only where those runtimes exist.
        'src/core/isolation/ptyHarness.ts',
        'src/core/isolation/testRuntimes.ts',
        'src/core/blocks/blockRegistryContract.ts',
        'src/core/inbox/inboxServiceContract.ts',
        'src/core/permissions/hookInspectorContract.ts',
        'src/core/permissions/policyBuilderContract.ts',
        'src/core/browser/observationServiceContract.ts',
        'src/core/agents/agentStoreContract.ts',
        'src/main/appForTests.ts',
        'src/renderer/testing/**',
      ],
      thresholds: {
        'src/core/**': { statements: 92, branches: 82, functions: 94, lines: 95 },
        'src/main/**': { statements: 77, branches: 62, functions: 76, lines: 81 },
        'src/main/modules/**': { statements: 81, branches: 63, functions: 79, lines: 85 },
        'src/shared/**': { statements: 98, functions: 98, lines: 98 },
        // Renderer files with logic that runs in Node or jsdom; the components without a unit test are covered by the end-to-end tests only.
        'src/renderer/{layout/{dockviewAdapter,hostModel,useLayoutState},panes/{treeModel,profileModel,useTreeNodes,useProfiles,TerminalPane,InboxPane,SetupPane},panes/inbox/{format,useInbox,ItemCard},panes/browser/{model,useBrowserTab,ObservationControl,ApprovalBar},dialogs/{newSession,NewTaskDialog,task/taskForm}}.{ts,tsx}': {
          statements: 95,
          branches: 89,
          functions: 91,
          lines: 96,
        },
      },
    },
  },
});
