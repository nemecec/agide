// Fake state seeded through the app's own commands.
import { callTool, connectAsSession } from './mcp.mjs';
import { createFolder, expandAll, invoke, sleep, startSession, type, value } from './harness.mjs';

/** Folders, sessions and one browser tab with generic names. Returns the ids. */
export async function seedWorkspace(instance, { origin } = {}) {
  const projectA = await createFolder(instance, 'Project A');
  const backend = await createFolder(instance, 'Backend', projectA);
  const frontend = await createFolder(instance, 'Frontend', projectA);
  const checkout = await createFolder(instance, 'Checkout flow', frontend);
  const projectB = await createFolder(instance, 'Project B');
  const research = await createFolder(instance, 'Research', projectB);
  await createFolder(instance, 'Notes');
  const working = await startSession(instance, backend, 'Fix upload retry');
  const waiting = await startSession(instance, checkout, 'Review pull request');
  const idle = await startSession(instance, research, 'Draft summary');
  await type(instance, working, '/hook UserPromptSubmit {"prompt":"Fix the retry in the uploader"}');
  await type(instance, waiting, '/hook PermissionRequest {"tool_name":"Bash","tool_input":{"command":"npm test","description":"Run the unit tests"}}');
  let tab;
  if (origin) tab = (await value(instance, 'browser_new_tab', { folderId: projectA, url: `${origin}/` })).leafId;
  await sleep(600);
  await expandAll(instance);
  return { projectA, backend, frontend, checkout, projectB, research, working, waiting, idle, tab };
}

/** A status post from an agent over MCP, with a long description. */
export async function postStatus(instance, sessionId, message, details) {
  const client = await connectAsSession(instance, sessionId);
  return callTool(client, 'inbox_post', { message, ...(details ? { details } : {}) });
}

export const treeRow = (instance, title) => instance.page.getByRole('treeitem', { name: title });
export { invoke };
