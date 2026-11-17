import type { z } from 'zod';
import { validationMessage } from './validationMessage';
import { CommandError, type Caller, type Command, type CommandDescriptor, type CommandResult } from './types';

const COMMAND_ID = /^[a-z]+(_[a-z0-9]+)+$/;

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  /** Throws when the id is taken or does not follow `<area>_<verb>`. Returns a function that unregisters. */
  register<I extends z.ZodType, O>(command: Command<I, O>): () => void {
    if (!COMMAND_ID.test(command.id)) throw new Error(`command id ${command.id} does not follow <area>_<verb>`);
    if (this.commands.has(command.id)) throw new Error(`command ${command.id} is already registered`);
    this.commands.set(command.id, command as unknown as Command);
    return () => this.commands.delete(command.id);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  list(filter: { mcp?: boolean } = {}): Command[] {
    return [...this.commands.values()].filter((c) => filter.mcp === undefined || c.mcp === filter.mcp);
  }

  describe(): CommandDescriptor[] {
    return this.list().map(({ id, title, description, ui, mcp }) => ({ id, title, description, ui, mcp }));
  }

  /**
   * Validates the input and runs the command. An MCP caller can invoke only commands with `mcp: true`.
   * Never throws: errors come back as `{ ok: false }`.
   */
  async invoke(id: string, rawInput: unknown, caller: Caller): Promise<CommandResult> {
    const command = this.commands.get(id);
    if (!command || (caller.kind === 'mcp' && !command.mcp)) {
      return failure(new CommandError('not_found', `no command ${id}`));
    }
    const parsed = command.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      return failure(new CommandError('invalid_input', validationMessage(command, parsed.error.issues), parsed.error.issues));
    }
    try {
      return { ok: true, value: await command.run(parsed.data, { caller }) };
    } catch (error) {
      return failure(error instanceof CommandError ? error : new CommandError('failed', messageOf(error)));
    }
  }
}

function failure(error: CommandError): CommandResult {
  return {
    ok: false,
    error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
