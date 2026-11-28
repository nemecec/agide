import { z } from 'zod';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { notBuilt } from '../commands/notBuilt';
import type { CommandContext } from '../commands/types';
import { ITEM_KINDS, ITEM_STATES, URGENCIES } from './types';
import type { InboxView } from './viewTypes';

/** The commands of saved views and of opening an item (0043 sections 4.6 and 4.8): the schemas, and the registration with the handlers a builder fills. */

export const viewFilterSchema = z
  .object({
    kinds: z.array(z.enum(ITEM_KINDS)).max(ITEM_KINDS.length).optional(),
    states: z.array(z.enum(ITEM_STATES)).max(ITEM_STATES.length).optional(),
    minUrgency: z.enum(URGENCIES).optional(),
    sources: z.array(z.enum(['hook', 'agent', 'app', 'scheduler'])).max(4).optional(),
    text: z.string().max(200).optional(),
  })
  .strict();

export const inboxViewSaveInput = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(60),
    folderId: z.string().min(1).max(64).nullable(),
    filter: viewFilterSchema,
    sort: z.enum(['urgency_then_time', 'time', 'project']),
    position: z.number().int().min(0).max(1000),
  })
  .strict();

export const inboxViewDeleteInput = z.object({ id: z.string().min(1).max(64) }).strict();
export const inboxOpenItemInput = z.object({ itemId: z.string().min(1).max(64) }).strict();

export interface ViewCommandHandlers {
  list(ctx: CommandContext): readonly InboxView[];
  save(input: z.output<typeof inboxViewSaveInput>, ctx: CommandContext): InboxView;
  remove(input: z.output<typeof inboxViewDeleteInput>, ctx: CommandContext): unknown;
  openItem(input: z.output<typeof inboxOpenItemInput>, ctx: CommandContext): unknown;
}

/** Until w-inbox-ui fills them, each handler answers `not_built`. */
export const NOT_BUILT_VIEW_HANDLERS: ViewCommandHandlers = {
  list: () => notBuilt('inbox_views_list'),
  save: () => notBuilt('inbox_view_save'),
  remove: () => notBuilt('inbox_view_delete'),
  openItem: () => notBuilt('inbox_open_item'),
};

/** Registers the view commands and `inbox_open_item`; all arrange the user's own screen and are not agent tools. */
export function registerViewCommands(registry: CommandRegistry, handlers: ViewCommandHandlers = NOT_BUILT_VIEW_HANDLERS): () => void {
  const off = [
    registry.register({
      id: 'inbox_views_list',
      title: 'List inbox views',
      description: 'The built-in views and the views the user saved.',
      input: z.object({}).strict(),
      ui: {},
      mcp: false,
      mcpExempt: 'Views arrange the user\'s own screen.',
      run: (_input, ctx) => handlers.list(ctx),
    }),
    registry.register({
      id: 'inbox_view_save',
      title: 'Save an inbox view',
      description: 'Creates or replaces a saved view: a name, a folder, a filter and a sort.',
      input: inboxViewSaveInput,
      ui: {},
      mcp: false,
      mcpExempt: 'Views arrange the user\'s own screen.',
      run: (input, ctx) => handlers.save(input, ctx),
    }),
    registry.register({
      id: 'inbox_view_delete',
      title: 'Delete an inbox view',
      description: 'Deletes a saved view. The built-in views stay.',
      input: inboxViewDeleteInput,
      ui: {},
      mcp: false,
      mcpExempt: 'Views arrange the user\'s own screen.',
      run: (input, ctx) => handlers.remove(input, ctx),
    }),
    registry.register({
      id: 'inbox_open_item',
      title: 'Open an inbox item',
      description: 'Opens the inbox on an item. For a reminder that a permission dialog waits in a terminal it brings that terminal to the front.',
      input: inboxOpenItemInput,
      ui: {},
      mcp: false,
      mcpExempt: 'It changes the user\'s screen.',
      run: (input, ctx) => handlers.openItem(input, ctx),
    }),
  ];
  return () => off.forEach((unregister) => unregister());
}
