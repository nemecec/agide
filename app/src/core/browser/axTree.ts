/** Formats `Accessibility.getFullAXTree` nodes as the indented text `read_page` returns. */

export interface AxValue {
  readonly value?: unknown;
}

export interface AxNode {
  readonly nodeId: string;
  readonly parentId?: string;
  readonly childIds?: readonly string[];
  readonly ignored?: boolean;
  readonly role?: AxValue;
  readonly name?: AxValue;
  readonly value?: AxValue;
  readonly properties?: readonly { readonly name: string; readonly value: AxValue }[];
  readonly backendDOMNodeId?: number;
}

export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
]);

const SKIPPED_ROLES = new Set(['none', 'generic', 'InlineTextBox', 'LineBreak', 'presentation']);

const text = (value: AxValue | undefined): string => (typeof value?.value === 'string' || typeof value?.value === 'number' ? String(value.value) : '');

export interface AxLine {
  readonly depth: number;
  readonly role: string;
  readonly name: string;
  readonly value: string;
  readonly backendNodeId: number | undefined;
  readonly protected: boolean;
  readonly disabled: boolean;
  readonly checked: string | undefined;
}

/** Walks the tree from its roots (or from one backend node) and returns the lines to show, ignored nodes promoted away. */
export function axLines(nodes: readonly AxNode[], options: { readonly filter: 'interactive' | 'all'; readonly depth: number; readonly fromBackendNodeId?: number }): AxLine[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const roots = nodes.filter((node) => node.parentId === undefined || !byId.has(node.parentId));
  const start = options.fromBackendNodeId === undefined ? roots : nodes.filter((node) => node.backendDOMNodeId === options.fromBackendNodeId);
  const lines: AxLine[] = [];
  const visit = (node: AxNode, depth: number): void => {
    if (depth > options.depth) return;
    const role = text(node.role);
    const shown = node.ignored !== true && !SKIPPED_ROLES.has(role) && role !== '' && (options.filter === 'all' || INTERACTIVE_ROLES.has(role));
    const named = text(node.name) !== '' || INTERACTIVE_ROLES.has(role) || role === 'heading' || role === 'image';
    const property = (name: string): unknown => node.properties?.find((p) => p.name === name)?.value.value;
    if (shown && (options.filter === 'interactive' || named || role === 'RootWebArea')) {
      lines.push({
        depth,
        role,
        name: text(node.name),
        value: text(node.value),
        backendNodeId: node.backendDOMNodeId,
        protected: property('protected') === true,
        disabled: property('disabled') === true,
        checked: property('checked') === undefined ? undefined : String(property('checked')),
      });
    }
    const next = shown && (options.filter === 'all' || named) ? depth + 1 : depth;
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) visit(child, next);
    }
  };
  for (const node of start) visit(node, 0);
  return lines;
}

/** One line of output: indentation, role, quoted name, value, state flags and the ref. */
export function formatAxLine(line: AxLine, ref: string | undefined, value: string): string {
  const parts = [`${'  '.repeat(line.depth)}${line.role}`];
  if (line.name !== '') parts.push(JSON.stringify(line.name.length > 200 ? `${line.name.slice(0, 199)}…` : line.name));
  if (value !== '') parts.push(`value=${JSON.stringify(value)}`);
  if (line.checked !== undefined) parts.push(`checked=${line.checked}`);
  if (line.disabled) parts.push('disabled');
  if (ref !== undefined) parts.push(`[${ref}]`);
  return parts.join(' ');
}

export interface FindMatch {
  readonly line: AxLine;
}

/** Literal, case-insensitive match on role, accessible name and value. At most `limit` matches and the total. */
export function findInLines(lines: readonly AxLine[], query: string, limit = 20): { readonly matches: AxLine[]; readonly total: number } {
  const needle = query.trim().toLowerCase();
  const hits = lines.filter((line) => line.backendNodeId !== undefined && `${line.role} ${line.name} ${line.value}`.toLowerCase().includes(needle));
  return { matches: hits.slice(0, limit), total: hits.length };
}
