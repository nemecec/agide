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
        'src/core/inbox/askServiceContract.ts',
        'src/core/access/accessBrokerContract.ts',
        'src/core/hooks/hookEndpointContract.ts',
        'src/core/permissions/hookInspectorContract.ts',
        'src/core/permissions/policyBuilderContract.ts',
        'src/core/browser/observationServiceContract.ts',
        'src/core/agents/agentStoreContract.ts',
        // Test doubles, contracts and fixtures of the review ladder.
        'src/core/review/fakes/**',
        'src/core/review/manager/{reviewManagerContract,reviewDecisionContract,persistentRig}.ts',
        'src/core/review/reviewer/reviewerRuntimeContract.ts',
        'src/core/review/store/{changesetStoreContract,sqliteHarness}.ts',
        'src/core/review/capture/gitFixtures.ts',
        'src/core/review/rules/ruleFixtures.ts',
        'src/main/appForTests.ts',
        // Electron wiring of the appearance adapter; the end-to-end theme tests cover it.
        'src/main/appearanceIpc.ts',
        'src/renderer/testing/**',
      ],
      thresholds: {
        'src/core/**': { statements: 94, branches: 85, functions: 94, lines: 97 },
        'src/main/**': { statements: 81, branches: 68, functions: 78, lines: 84 },
        'src/main/modules/**': { statements: 83, branches: 68, functions: 81, lines: 86 },
        'src/main/modules/review.ts': { statements: 83, branches: 73, functions: 67, lines: 86 },
        'src/core/review/**': { statements: 95, branches: 88, functions: 95, lines: 98 },
        'src/core/swarm/**': { statements: 95, branches: 89, functions: 94, lines: 98 },
        'src/renderer/{dialogs,panes}/swarm/**': { statements: 97, branches: 92, functions: 95, lines: 97 },
        'src/renderer/panes/review/**': { statements: 95, branches: 83, functions: 96, lines: 97 },
        'src/shared/**': { statements: 98, functions: 98, lines: 98 },
        'src/renderer/ui/**': { statements: 92, branches: 82, functions: 92, lines: 94 },
        // Renderer files with logic that runs in Node or jsdom; the components without a unit test are covered by the end-to-end tests only.
        'src/renderer/{layout/{dockviewAdapter,hostModel,useLayoutState},panes/{tree/swarmMenu,treeModel,profileModel,useTreeNodes,useProfiles,TerminalPane,InboxPane,SetupPane},panes/inbox/{format,useInbox,ItemCard},panes/browser/{model,useBrowserTab,ObservationControl,ApprovalBar},dialogs/{newSession,NewTaskDialog,task/taskForm}}.{ts,tsx}': {
          statements: 95,
          branches: 89,
          functions: 91,
          lines: 96,
        },
      },
    },
  },
});
