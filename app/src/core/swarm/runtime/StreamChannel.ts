import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { asRecord, str } from '../../agents/normalise/payload';
import { NdjsonReader, type NdjsonItem } from './ndjson';
import { RuntimeError } from './types';

interface PendingControl {
  readonly resolve: (response: Record<string, unknown>) => void;
  readonly reject: (error: RuntimeError) => void;
  readonly timer: NodeJS.Timeout;
}

export interface StreamChannelOptions {
  /** How long a control request waits for its response (0037 section 2.2). */
  readonly controlTimeoutMs: number;
  readonly onMessage: (message: Record<string, unknown>) => void;
  readonly onUnreadable?: (item: Extract<NdjsonItem, { kind: 'invalid' | 'dropped' }>) => void;
}

/**
 * The two pipes of one stream-json process (0037 section 2.2): NDJSON user messages and control messages to
 * stdin, a tolerant reader on stdout. `control_response` lines answer the app's own control requests and are
 * resolved here; every other line goes to `onMessage`.
 */
export class StreamChannel {
  private readonly reader = new NdjsonReader();
  private readonly pending = new Map<string, PendingControl>();

  constructor(
    private readonly stdin: Writable,
    private readonly options: StreamChannelOptions,
  ) {
    // The process may be gone when a write lands; its exit is reported through the exit event.
    stdin.on('error', () => undefined);
  }

  get writable(): boolean {
    return !this.stdin.destroyed && !this.stdin.writableEnded;
  }

  feed(chunk: Buffer | string): void {
    this.dispatch(this.reader.push(chunk));
  }

  /** The stdout stream ended. */
  finish(): void {
    this.dispatch(this.reader.end());
  }

  writeUser(text: string): void {
    this.write({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    });
  }

  /** The answer to a `can_use_tool` request: `{ behavior: 'allow', updatedInput }` or `{ behavior: 'deny', message }`. */
  writePermissionAnswer(requestId: string, response: Record<string, unknown>): void {
    this.write({
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response },
    });
  }

  writeControlError(requestId: string, error: string): void {
    this.write({
      type: 'control_response',
      response: { subtype: 'error', request_id: requestId, error },
    });
  }

  /** Sends a control request and resolves with its response; rejects with `unsupported` on an error response and `timeout` without one. */
  request(body: { readonly subtype: string; readonly [key: string]: unknown }): Promise<Record<string, unknown>> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new RuntimeError('timeout', `no response to the ${body.subtype} request within ${this.options.controlTimeoutMs} ms`));
      }, this.options.controlTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.write({
          type: 'control_request',
          request_id: requestId,
          request: body,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error as RuntimeError);
      }
    });
  }

  closeStdin(): void {
    if (this.writable) this.stdin.end();
  }

  /** The process ended: open control requests fail at once. */
  rejectAll(error: RuntimeError): void {
    for (const [requestId, entry] of [...this.pending]) {
      clearTimeout(entry.timer);
      this.pending.delete(requestId);
      entry.reject(error);
    }
  }

  private write(message: object): void {
    if (!this.writable) throw new RuntimeError('not_running', 'the process no longer takes input');
    this.stdin.write(JSON.stringify(message) + '\n');
  }

  private dispatch(items: readonly NdjsonItem[]): void {
    for (const item of items) {
      if (item.kind !== 'message') {
        this.options.onUnreadable?.(item);
        continue;
      }
      if (item.value['type'] === 'control_response') this.settle(item.value);
      this.options.onMessage(item.value);
    }
  }

  private settle(message: Record<string, unknown>): void {
    const response = asRecord(message['response']);
    const requestId = str(response?.['request_id']);
    const entry = requestId === undefined ? undefined : this.pending.get(requestId);
    if (entry === undefined || requestId === undefined) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    if (response?.['subtype'] === 'error') entry.reject(new RuntimeError('unsupported', str(response['error']) ?? 'the control request failed'));
    else entry.resolve(asRecord(response?.['response']) ?? {});
  }
}
