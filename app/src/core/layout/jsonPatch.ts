import { z } from 'zod';

/** JSON Patch (RFC 6902) over plain JSON values, the form in which an agent edits a layout. */

const pointer = z.string().regex(/^(\/[^/]*)*$/, 'a JSON Pointer such as /instances/main/config/emptyText');

export const patchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: pointer, value: z.json() }).strict(),
  z.object({ op: z.literal('replace'), path: pointer, value: z.json() }).strict(),
  z.object({ op: z.literal('test'), path: pointer, value: z.json() }).strict(),
  z.object({ op: z.literal('remove'), path: pointer }).strict(),
  z.object({ op: z.literal('move'), from: pointer, path: pointer }).strict(),
  z.object({ op: z.literal('copy'), from: pointer, path: pointer }).strict(),
]);

export type PatchOperation = z.output<typeof patchOperationSchema>;

export interface PatchIssue {
  /** Pointer into the patch itself, such as `/patch/2`. */
  readonly path: string;
  readonly message: string;
}

export type PatchResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issues: readonly PatchIssue[] };

type Container = Record<string, unknown> | unknown[];

const isContainer = (value: unknown): value is Container => typeof value === 'object' && value !== null;

function parsePointer(path: string): string[] {
  if (path === '') return [];
  return path
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

class PatchFailure extends Error {}

function keysOf(value: unknown): string {
  if (Array.isArray(value)) return `array of length ${value.length}`;
  if (isContainer(value)) return `keys ${Object.keys(value).join(', ') || '(none)'}`;
  return 'a value that has no children';
}

function walk(root: unknown, parts: readonly string[]): unknown {
  let current = root;
  for (const [position, part] of parts.entries()) {
    if (!isContainer(current) || !Object.hasOwn(current, part)) {
      const where = `/${parts.slice(0, position).join('/')}`;
      throw new PatchFailure(`no value at /${parts.slice(0, position + 1).join('/')}; ${where === '/' ? 'the document' : where} has ${keysOf(current)}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function parentOf(root: unknown, parts: readonly string[]): { parent: Container; key: string } {
  const key = parts.at(-1);
  if (key === undefined) throw new PatchFailure('the document root cannot be the target of this operation');
  const parent = walk(root, parts.slice(0, -1));
  if (!isContainer(parent)) throw new PatchFailure(`the parent of /${parts.join('/')} has no children`);
  return { parent, key };
}

function insert(root: unknown, parts: readonly string[], value: unknown, mode: 'add' | 'replace'): unknown {
  if (parts.length === 0) return value;
  const { parent, key } = parentOf(root, parts);
  if (Array.isArray(parent)) {
    const index = key === '-' ? parent.length : Number(key);
    const limit = mode === 'add' ? parent.length : parent.length - 1;
    if (!Number.isInteger(index) || index < 0 || index > limit) {
      throw new PatchFailure(`index ${key} is outside the array at /${parts.slice(0, -1).join('/')} (length ${parent.length})`);
    }
    if (mode === 'add') parent.splice(index, 0, value);
    else parent[index] = value;
  } else {
    if (mode === 'replace' && !Object.hasOwn(parent, key)) {
      throw new PatchFailure(`replace needs an existing value at /${parts.join('/')}; use add to create it`);
    }
    parent[key] = value;
  }
  return root;
}

function take(root: unknown, parts: readonly string[]): unknown {
  walk(root, parts);
  const { parent, key } = parentOf(root, parts);
  if (Array.isArray(parent)) return parent.splice(Number(key), 1)[0];
  const value = parent[key];
  delete parent[key];
  return value;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function applyOne(root: unknown, op: PatchOperation): unknown {
  const target = parsePointer(op.path);
  switch (op.op) {
    case 'add':
    case 'replace':
      return insert(root, target, structuredClone(op.value), op.op);
    case 'remove':
      take(root, target);
      return root;
    case 'test': {
      const actual = walk(root, target);
      if (!same(actual, op.value)) throw new PatchFailure(`test failed: ${op.path} holds ${JSON.stringify(actual)}, the patch expected ${JSON.stringify(op.value)}`);
      return root;
    }
    case 'copy':
      return insert(root, target, structuredClone(walk(root, parsePointer(op.from))), 'add');
    case 'move': {
      const from = parsePointer(op.from);
      if (op.path.startsWith(`${op.from}/`)) throw new PatchFailure(`cannot move ${op.from} into itself`);
      return insert(root, target, take(root, from), 'add');
    }
  }
}

/** Applies the operations in order to a copy of `document`. The first failing operation is reported with its index. */
export function applyPatch(document: unknown, operations: readonly PatchOperation[]): PatchResult {
  let root = structuredClone(document);
  for (const [index, op] of operations.entries()) {
    try {
      root = applyOne(root, op);
    } catch (error) {
      if (!(error instanceof PatchFailure)) throw error;
      return { ok: false, issues: [{ path: `/patch/${index}`, message: `operation ${index} (${op.op} ${op.path}): ${error.message}` }] };
    }
  }
  return { ok: true, value: root };
}
