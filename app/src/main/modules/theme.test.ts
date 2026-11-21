import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkParity } from '../../core/commands/index';
import { buildZip } from '../../core/theme/vscode/zipFixture';
import { startAppModules, type AppModules } from '../appForTests';

const ui = { kind: 'ui' } as const;
const THEME_COMMANDS = ['theme_apply', 'theme_get', 'theme_import', 'theme_list', 'theme_preview', 'theme_revert_preview', 'theme_undo', 'theme_validate'];

interface Loose {
  ok: boolean;
  value?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  error?: { code: string; message: string; details?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

let app: AppModules;
let dir: string;
const clients: Client[] = [];
const call = (id: string, input: unknown = {}) => app.commands.invoke(id, input, ui) as Promise<Loose>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agide-theme-module-'));
  app = await startAppModules({ dataDir: join(dir, 'data') });
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('theme commands', () => {
  it('are registered as MCP tools, so the parity check lists them', async () => {
    const folder = (await call('ui_create_folder', { title: 'parity' })).value as { id: string };
    const grant = app.services.mcp.grant('parity', folder.id);
    const client = new Client({ name: 'parity', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(grant.url), { requestInit: { headers: { Authorization: `Bearer ${grant.token}` } } }));
    clients.push(client);
    const report = checkParity(app.commands.list(), (await client.listTools()).tools.map((tool) => tool.name));
    expect(report.rows.filter((row) => row.id.startsWith('theme_')).map((row) => [row.id, row.exposed]), 'every theme command is an exposed tool').toEqual(THEME_COMMANDS.map((id) => [id, true]));
    expect(report.missing, 'no command lacks a tool').toEqual([]);
  });

  it('list the themes with the revision, and get returns the schema and the resolved tokens', async () => {
    const listed = await call('theme_list');
    expect(listed.value.themes.map((theme: { id: string }) => theme.id), 'built-in themes').toContain('catppuccin-mocha');
    expect(listed.value.revision, 'revision of the choice').toBe(1);
    const got = await call('theme_get', { id: 'github-dark-default' });
    expect(got.value.jsonSchema.type, 'JSON Schema of a theme').toBe('object');
    expect(got.value.resolved.tokens['accent'], 'resolved accent').toBe('#238636');
  });

  it('preview shows a theme without saving it, and revert ends it', async () => {
    const previewed = await call('theme_preview', { id: 'agide-dark' });
    expect(previewed.ok, 'preview starts').toBe(true);
    expect(app.services.theme.state().preview?.theme.id, 'the service shows the preview').toBe('agide-dark');
    expect((await call('theme_list')).value.themes.find((theme: { active: boolean }) => theme.active).id, 'the saved choice is unchanged').toBe('system');
    expect((await call('theme_revert_preview', { previewId: previewed.value.previewId })).value, 'revert ends it').toEqual({ reverted: true });
    expect(app.services.theme.state().preview, 'no preview left').toBeUndefined();
  });

  it('preview needs exactly one of id and document', async () => {
    expect((await call('theme_preview', {})).error?.code, 'neither').toBe('invalid_input');
    expect((await call('theme_preview', { id: 'agide-dark', document: {} })).error?.code, 'both').toBe('invalid_input');
  });

  it('apply refuses a stale revision, saves with the current one, and undo restores', async () => {
    const applied = await call('theme_apply', { id: 'agide-dark', expectedRevision: 1 });
    expect(applied.value, 'revision 2 with undo arguments').toMatchObject({ revision: 2, themeId: 'agide-dark', undo: { tool: 'theme_undo' } });
    const stale = await call('theme_apply', { id: 'agide-light', expectedRevision: 1 });
    expect(stale.error, 'stale revision is invalid_input with the current revision').toMatchObject({ code: 'invalid_input', details: { currentRevision: 2 } });
    const undone = await call('theme_undo');
    expect(undone.value, 'undo is a new revision that restores System').toMatchObject({ revision: 3, themeId: 'system' });
  });

  it('apply takes the theme of a preview, and an unknown id is not_found', async () => {
    const { previewId } = (await call('theme_preview', { id: 'catppuccin-mocha' })).value;
    expect((await call('theme_apply', { previewId, expectedRevision: 1 })).value, 'kept preview').toMatchObject({ themeId: 'catppuccin-mocha' });
    expect((await call('theme_apply', { id: 'missing-theme', expectedRevision: 2 })).error?.code, 'unknown id').toBe('not_found');
  });

  it('validate reports errors with a code, a pointer and a hint, and changes nothing', async () => {
    const result = await call('theme_validate', { document: { schema: 1, id: 'bad-theme', name: 'Bad', kind: 'dark', extends: 'agide-dark', tokens: { 'surface.panel': '#000000', accent: 'blue' } } });
    expect(result.value.ok, 'invalid').toBe(false);
    expect(result.value.errors.map((issue: { code: string; path: string }) => [issue.code, issue.path]), 'unknown token and invalid value').toEqual([
      ['unknown_token', '/tokens/surface.panel'],
      ['invalid_value', '/tokens/accent'],
    ]);
    expect(result.value.errors[0].hint, 'hint names close tokens').toContain('closest token names');
  });

  it('import saves a theme from a file path and from base64 content, and a dry run saves nothing', async () => {
    const path = join(dir, 'plain.json');
    writeFileSync(path, '{"colors":{"editor.background":"#101010","foreground":"#eeeeee"}}');
    const license = { spdx: 'MIT', copyright: 'Copyright (c) 2024 Acme', text: 'MIT text' };
    const dry = await call('theme_import', { path, license, dryRun: true });
    expect(dry.value, 'dry run result').toMatchObject({ saved: false, theme: { id: 'plain' } });
    expect((await call('theme_list')).value.themes.some((theme: { id: string }) => theme.id === 'plain'), 'dry run saved nothing').toBe(false);
    const saved = await call('theme_import', { path, license });
    expect(saved.value, 'saved').toMatchObject({ saved: true, theme: { id: 'plain', license: { spdx: 'MIT' } } });
    const again = await call('theme_import', { data: Buffer.from('{"colors":{"editor.background":"#ffffff","foreground":"#111111"}}').toString('base64'), fileName: 'Light One.json', license });
    expect(again.value.theme.id, 'content import takes the id from the file name').toBe('light-one');
    expect((await call('theme_apply', { id: 'plain', expectedRevision: 1 })).ok, 'an imported theme can be applied').toBe(true);
  });

  it('import asks for a license, a theme label and refuses other file types', async () => {
    const bare = Buffer.from('{"colors":{"editor.background":"#101010","foreground":"#eeeeee"}}').toString('base64');
    const noLicense = await call('theme_import', { data: bare, fileName: 'x-theme.json' });
    expect(noLicense.error?.details.issues[0].code, 'license_missing').toBe('license_missing');
    const bytes = buildZip([
      { name: 'extension/package.json', data: JSON.stringify({ name: 'p', publisher: 'q', contributes: { themes: [{ label: 'A', path: './a.json' }, { label: 'B', path: './b.json' }] } }) },
      { name: 'extension/a.json', data: '{"colors":{"editor.background":"#101010","foreground":"#eeeeee"}}' },
      { name: 'extension/b.json', data: '{"colors":{"editor.background":"#ffffff","foreground":"#111111"}}' },
      { name: 'extension/LICENSE', data: 'MIT License\n\nCopyright (c) 2024 Q\n\nPermission is hereby granted, free of charge, to any person obtaining a copy' },
    ]);
    const asked = await call('theme_import', { data: bytes.toString('base64'), fileName: 'p.vsix', dryRun: true });
    expect(asked.error?.details.labels, 'labels of the package').toEqual(['A', 'B']);
    const chosen = await call('theme_import', { data: bytes.toString('base64'), fileName: 'p.vsix', themeLabel: 'B', dryRun: true });
    expect(chosen.value.theme, 'chosen theme with the license of the package').toMatchObject({ name: 'B', kind: 'light', license: { spdx: 'MIT' } });
    expect((await call('theme_import', { path: join(dir, 'notes.txt') })).error?.code, 'extension check').toBe('invalid_input');
    expect((await call('theme_import', { path: join(dir, 'missing.json') })).error?.code, 'missing file').toBe('not_found');
  });
});
