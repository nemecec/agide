import { z } from 'zod';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { DEFAULT_SURFACE_TYPES, type SurfaceTypeInfo } from './surfaceCatalog';

/** Registers `ui_list_surface_types`, the source of the tree's "new surface" menu entries. */
export function registerSurfaceTypeCommands(
  registry: CommandRegistry,
  surfaceTypes: readonly SurfaceTypeInfo[] = DEFAULT_SURFACE_TYPES,
): () => void {
  return registry.register({
    id: 'ui_list_surface_types',
    title: 'List surface types',
    description: 'List the surface types a leaf can show, each with id and label.',
    input: z.strictObject({}),
    ui: false,
    mcp: true,
    run: () => ({ surfaceTypes }),
  });
}
