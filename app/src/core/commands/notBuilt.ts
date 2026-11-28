import { CommandError } from './types';

/**
 * The handler of a command that a contracts step registered and its builder has not filled yet (0043 section 5).
 * The command, its schema and its parity row exist; a call answers the error code `not_built`.
 */
export function notBuilt(commandId: string): never {
  throw new CommandError('not_built', `${commandId} is not built yet`);
}
