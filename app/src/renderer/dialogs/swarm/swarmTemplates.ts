import { definitionToForm, type SwarmForm } from './swarmForm';

export interface SwarmTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly definition: Record<string, unknown>;
}

/** Starting points for the form. A template that needs a repository leaves its path empty for the user to fill. */
export const SWARM_TEMPLATES: readonly SwarmTemplate[] = [
  {
    id: 'implement-review',
    label: 'Implement, test and review',
    description: 'One worker implements, one writes tests, and a read-only reviewer follows in the next stage.',
    definition: {
      version: 1,
      goal: 'Describe the change to make, with tests, and review it',
      repository: { path: '', base: 'main' },
      budget: { usdTotal: 3, reviewShare: 0.3 },
      agents: [
        { name: 'impl', prompt: 'Implement the change described in the goal. Commit when done.', tier: 'mid', owns: ['src/**'] },
        { name: 'tests', role: 'mechanical', prompt: 'Write tests for the change described in the goal.', owns: ['test/**'] },
        { name: 'review', role: 'reviewer', stage: 1, workspace: 'readonly', prompt: 'Review the changes of impl and tests. Report findings; do not edit.' },
      ],
    },
  },
  {
    id: 'parallel-workers',
    label: 'Parallel workers',
    description: 'Two workers on separate paths of one repository, at the same time.',
    definition: {
      version: 1,
      goal: 'Describe the two tasks',
      repository: { path: '', base: 'main' },
      budget: { usdTotal: 2 },
      agents: [
        { name: 'first', prompt: 'Do the first task of the goal.', owns: ['src/first/**'] },
        { name: 'second', prompt: 'Do the second task of the goal.', owns: ['src/second/**'] },
      ],
    },
  },
  {
    id: 'research',
    label: 'Research, no repository',
    description: 'Small agents in scratch directories read and summarise; nothing is collected.',
    definition: {
      version: 1,
      goal: 'Describe the question to research',
      budget: { usdTotal: 1 },
      agents: [
        { name: 'scout-one', role: 'mechanical', workspace: 'scratch', prompt: 'Research the first half of the question and write a short summary.' },
        { name: 'scout-two', role: 'mechanical', workspace: 'scratch', prompt: 'Research the second half of the question and write a short summary.' },
      ],
    },
  },
];

export const templateForm = (template: SwarmTemplate): SwarmForm => definitionToForm(template.definition);
