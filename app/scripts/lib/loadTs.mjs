// Loads TypeScript modules of src/ into a plain Node script through Vite's SSR loader.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export async function loadTs(paths) {
  const vite = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    ssr: { external: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const modules = await Promise.all(paths.map((path) => vite.ssrLoadModule(path)));
  return { modules, close: () => vite.close() };
}
