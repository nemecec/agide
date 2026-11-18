import type { SurfaceType } from './types';

/** The surface types the app knows. A module registers the type it owns; the tree and the layout host look them up by id. */
export class SurfaceTypeRegistry {
  private readonly types = new Map<string, SurfaceType<any>>();

  /** Throws when the id is taken. Returns a function that unregisters. */
  register<State extends object>(type: SurfaceType<State>): () => void {
    if (this.types.has(type.id)) throw new Error(`surface type ${type.id} is already registered`);
    this.types.set(type.id, type);
    return () => this.types.delete(type.id);
  }

  get(id: string): SurfaceType<any> | undefined {
    return this.types.get(id);
  }

  list(): SurfaceType<any>[] {
    return [...this.types.values()];
  }
}
