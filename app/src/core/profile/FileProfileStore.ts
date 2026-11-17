import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { z } from 'zod';
import { ensureDir, readOwnRegularFile, writeFileAtomic } from './fsio';
import { profilePaths, rootPaths } from './paths';
import { defaultSettings, profileDefinitionSchema, profileIdFromName, profileIdSchema, profileSettingsSchema } from './schemas';
import { writeToolFiles } from './toolFiles';
import {
  DEFAULT_PROFILE_ID,
  ProfileError,
  type NewProfileInput,
  type ProfileDefinition,
  type ProfileId,
  type ProfileSettings,
  type ProfileStore,
} from './types';

const MAX_FILE_BYTES = 64 * 1024;

export interface FileProfileStoreOptions {
  /** App root holding `profiles/`. */
  readonly root: string;
  /** The profile whose process uses this store. */
  readonly ownerId: ProfileId;
  readonly now?: () => Date;
}

/** `ProfileStore` over `<root>/profiles/<id>/`. Files are 0600, directories 0700, writes are atomic. */
export class FileProfileStore implements ProfileStore {
  private readonly profilesDir: string;
  private readonly now: () => Date;

  constructor(private readonly options: FileProfileStoreOptions) {
    this.profilesDir = rootPaths(options.root).profiles;
    this.now = options.now ?? (() => new Date());
  }

  list(): ProfileDefinition[] {
    let names: string[];
    try {
      names = readdirSync(this.profilesDir);
    } catch {
      return [];
    }
    const definitions: ProfileDefinition[] = [];
    for (const name of names) {
      const definition = this.get(name);
      if (definition) definitions.push(definition);
    }
    return definitions.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /** A directory without a valid definition is skipped: it may be a creation in progress. */
  get(id: ProfileId): ProfileDefinition | undefined {
    if (!profileIdSchema.safeParse(id).success) return undefined;
    const dir = profilePaths(this.options.root, id).dir;
    try {
      if (!lstatSync(dir).isDirectory()) return undefined;
    } catch {
      return undefined;
    }
    const text = readOwnRegularFile(profilePaths(this.options.root, id).definition, { maxBytes: MAX_FILE_BYTES });
    if (text === undefined) return undefined;
    const parsed = parseJson(text, profileDefinitionSchema);
    return parsed && (parsed as ProfileDefinition).id === id ? (parsed as ProfileDefinition) : undefined;
  }

  create(input: NewProfileInput): ProfileDefinition {
    const base = input.id ?? profileIdFromName(input.name);
    if (!profileIdSchema.safeParse(base).success) throw new ProfileError('invalid', `profile id ${base} is not valid`);
    // Validate everything before the claim, so a refused input leaves no directory behind.
    const preview = this.build(base, input);
    ensureDir(this.profilesDir);
    const id = input.id === undefined ? this.claimUnique(base) : this.claim(base);
    const paths = profilePaths(this.options.root, id);
    try {
      for (const dir of [paths.data, paths.claude, paths.tools.gh]) ensureDir(dir);
      const { definition, settings } = this.build(id, input, preview.definition.createdAt);
      writeFileAtomic(paths.settings, json(settings));
      writeToolFiles(settings, paths);
      writeFileAtomic(paths.definition, json(definition));
      return definition;
    } catch (error) {
      rmSync(paths.dir, { recursive: true, force: true });
      throw error;
    }
  }

  readSettings(id: ProfileId): ProfileSettings {
    this.requireOwner(id);
    const text = readOwnRegularFile(profilePaths(this.options.root, id).settings, { maxBytes: MAX_FILE_BYTES });
    if (text === undefined) throw new ProfileError('not_found', `profile ${id} has no settings`);
    const settings = parseJson(text, profileSettingsSchema);
    if (!settings) throw new ProfileError('invalid', `settings of profile ${id} are not valid`);
    return settings as ProfileSettings;
  }

  updateSettings(id: ProfileId, change: Partial<Omit<ProfileSettings, 'schema'>>): ProfileSettings {
    const next = parse<ProfileSettings>(profileSettingsSchema, { ...this.readSettings(id), ...change, schema: 1 });
    const paths = profilePaths(this.options.root, id);
    writeToolFiles(next, paths);
    writeFileAtomic(paths.settings, json(next));
    return next;
  }

  updateDefinition(id: ProfileId, change: { readonly name?: string; readonly colour?: string }): ProfileDefinition {
    this.requireOwner(id);
    const current = this.get(id);
    if (!current) throw new ProfileError('not_found', `no profile ${id}`);
    const next = parse<ProfileDefinition>(profileDefinitionSchema, {
      ...current,
      ...(change.name === undefined ? {} : { name: change.name.trim() }),
      ...(change.colour === undefined ? {} : { colour: change.colour }),
    });
    writeFileAtomic(profilePaths(this.options.root, id).definition, json(next));
    return next;
  }

  private build(id: ProfileId, input: NewProfileInput, createdAt: string = this.now().toISOString()) {
    const definition = parse<ProfileDefinition>(profileDefinitionSchema, { schema: 1, id, name: input.name.trim(), colour: input.colour, createdAt });
    const base = defaultSettings({ isDefaultProfile: id === DEFAULT_PROFILE_ID, claudeConfigDir: profilePaths(this.options.root, id).claude });
    const settings = parse<ProfileSettings>(profileSettingsSchema, { ...base, ...input.settings, schema: 1 });
    return { definition, settings };
  }

  /** `mkdir` is the claim: it fails when the id exists, also when another process creates it at the same moment. */
  private claim(id: ProfileId): ProfileId {
    try {
      mkdirSync(profilePaths(this.options.root, id).dir, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ProfileError('exists', `profile ${id} exists`);
      throw error;
    }
    chmodSync(profilePaths(this.options.root, id).dir, 0o700);
    return id;
  }

  private claimUnique(base: string): ProfileId {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (!profileIdSchema.safeParse(candidate).success) throw new ProfileError('invalid', `profile id ${candidate} is not valid`);
      try {
        return this.claim(candidate);
      } catch (error) {
        if (!(error instanceof ProfileError && error.code === 'exists')) throw error;
      }
    }
  }

  private requireOwner(id: ProfileId): void {
    if (id !== this.options.ownerId) throw new ProfileError('not_owner', `profile ${this.options.ownerId} cannot change or read the settings of ${id}`);
  }
}

/** True when `<root>/profiles` exists. */
export const hasProfilesDirectory = (root: string): boolean => existsSync(rootPaths(root).profiles);

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function parseJson(text: string, schema: z.ZodType): unknown {
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** zod types optional keys as `T | undefined`; a parsed object never holds an `undefined` value for them. */
function parse<T>(schema: z.ZodType, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ProfileError('invalid', z.prettifyError(result.error));
  return result.data as T;
}
