import { z } from 'zod';

/**
 * Input schemas of the hosted browser tools on `agide-browser` (0026 section 3), named and shaped as the Claude
 * in Chrome tools (`notes/browser-tools-mapping.md`), so a skill written for `mcp__claude-in-chrome__*` works
 * after the server part of the name changes. Command ids are `browser_<name>` with `mcpServer: 'agide-browser'`.
 */

const tabId = z.number().int().nonnegative();
const coordinate = z.tuple([z.number(), z.number()]);
const actionSummary = z.string().max(500).optional();

export const COMPUTER_ACTIONS = [
  'left_click',
  'right_click',
  'double_click',
  'triple_click',
  'type',
  'screenshot',
  'wait',
  'scroll',
  'key',
  'left_click_drag',
  'zoom',
  'scroll_to',
  'hover',
] as const;

/** `computer` actions that do not act on the page; every other action is an acting call (0026 section 3). */
export const NON_ACTING_COMPUTER_ACTIONS: readonly (typeof COMPUTER_ACTIONS)[number][] = ['screenshot', 'zoom', 'scroll', 'scroll_to', 'hover', 'wait'];

export const BROWSER_TOOL_INPUTS = {
  tabs_context_mcp: z.object({ createIfEmpty: z.boolean().optional() }).strict(),
  tabs_create_mcp: z.object({}).strict(),
  tabs_close_mcp: z.object({ tabId }).strict(),
  navigate: z.object({ url: z.string().min(1).max(8192), tabId: tabId.optional() }).strict(),
  computer: z
    .object({
      action: z.enum(COMPUTER_ACTIONS),
      tabId,
      coordinate: coordinate.optional(),
      start_coordinate: coordinate.optional(),
      text: z.string().max(10_000).optional(),
      ref: z.string().max(64).optional(),
      region: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
      scroll_direction: z.enum(['up', 'down', 'left', 'right']).optional(),
      scroll_amount: z.number().int().min(1).max(10).optional(),
      duration: z.number().min(0).max(10).optional(),
      repeat: z.number().int().min(1).max(100).optional(),
      modifiers: z.string().max(64).optional(),
      scale: z.number().min(0.1).max(1).optional(),
      save_to_disk: z.boolean().optional(),
      action_summary: actionSummary,
    })
    .strict(),
  read_page: z
    .object({
      tabId,
      filter: z.enum(['interactive', 'all']).optional(),
      depth: z.number().int().min(1).max(100).optional(),
      max_chars: z.number().int().min(100).max(200_000).optional(),
      ref_id: z.string().max(64).optional(),
    })
    .strict(),
  find: z.object({ query: z.string().min(1).max(500), tabId }).strict(),
  form_input: z.object({ ref: z.string().min(1).max(64), value: z.union([z.string().max(10_000), z.boolean(), z.number()]), tabId, action_summary: actionSummary }).strict(),
  get_page_text: z.object({ tabId }).strict(),
  javascript_tool: z.object({ action: z.literal('javascript_exec'), text: z.string().min(1).max(100_000), tabId }).strict(),
  read_console_messages: z
    .object({ tabId, pattern: z.string().max(500).optional(), onlyErrors: z.boolean().optional(), limit: z.number().int().min(1).max(1000).optional(), clear: z.boolean().optional() })
    .strict(),
  read_network_requests: z
    .object({ tabId, urlPattern: z.string().max(500).optional(), limit: z.number().int().min(1).max(1000).optional(), clear: z.boolean().optional() })
    .strict(),
  browser_batch: z
    .object({ actions: z.array(z.object({ name: z.string().min(1).max(64), input: z.record(z.string(), z.unknown()) }).strict()).min(1).max(50) })
    .strict(),
  resize_window: z.object({ width: z.number().int().min(200).max(8000), height: z.number().int().min(200).max(8000), tabId }).strict(),
  file_upload: z.object({ paths: z.array(z.string().min(1)).min(1).max(20), ref: z.string().min(1).max(64), tabId }).strict(),
  upload_image: z
    .object({ imageId: z.string().min(1).max(128), tabId, ref: z.string().max(64).optional(), coordinate: coordinate.optional(), filename: z.string().max(255).optional() })
    .strict(),
  gif_creator: z
    .object({
      action: z.enum(['start_recording', 'stop_recording', 'export', 'clear']),
      tabId,
      download: z.boolean().optional(),
      filename: z.string().max(255).optional(),
      options: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
} as const;

export type BrowserToolName = keyof typeof BROWSER_TOOL_INPUTS;

/** Whether the first slice hosts a tool (0026 section 3 table). `no` tools answer that Agide has one browser. */
export const BROWSER_TOOL_STATUS: Readonly<Record<BrowserToolName | 'list_connected_browsers' | 'select_browser' | 'switch_browser', 'yes' | 'partial' | 'later' | 'no'>> = {
  tabs_context_mcp: 'yes',
  tabs_create_mcp: 'yes',
  tabs_close_mcp: 'yes',
  navigate: 'yes',
  computer: 'yes',
  read_page: 'yes',
  find: 'partial',
  form_input: 'yes',
  get_page_text: 'yes',
  javascript_tool: 'yes',
  read_console_messages: 'yes',
  read_network_requests: 'yes',
  browser_batch: 'yes',
  resize_window: 'later',
  file_upload: 'later',
  upload_image: 'later',
  gif_creator: 'later',
  list_connected_browsers: 'no',
  select_browser: 'no',
  switch_browser: 'no',
};

/** The registry command id of a hosted tool. */
export const browserCommandId = (tool: BrowserToolName): string => `browser_${tool}`;

/** `surfaces_observe` on the `app` server (0026 section 6). */
export const surfacesObserveInput = z.object({ nodeId: z.string().min(1).optional(), kind: z.enum(['summary', 'text', 'tree', 'screenshot']) }).strict();

/** True for a call that acts on the page and needs the site check (0026 section 3). */
export function isActingCall(tool: BrowserToolName, input: { readonly action?: string }): boolean {
  if (tool === 'computer') return !NON_ACTING_COMPUTER_ACTIONS.includes(input.action as (typeof COMPUTER_ACTIONS)[number]);
  return tool === 'form_input' || tool === 'javascript_tool' || tool === 'file_upload' || tool === 'upload_image';
}
