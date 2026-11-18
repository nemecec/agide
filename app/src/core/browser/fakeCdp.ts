import type { CdpTransport } from './cdp';

type Responder = (params: Record<string, unknown>) => unknown;

/** A recording CDP transport for tests: answers each method from a table and lets a test emit events. */
export class FakeCdp implements CdpTransport {
  readonly calls: { method: string; params: Record<string, unknown> }[] = [];
  private readonly handlers = new Map<string, Responder>();
  private readonly listeners = new Set<(method: string, params: Record<string, unknown>) => void>();

  on(method: string, responder: Responder | unknown): this {
    this.handlers.set(method, typeof responder === 'function' ? (responder as Responder) : () => responder);
    return this;
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    const handler = this.handlers.get(method);
    return handler ? handler(params) : {};
  }

  onEvent(handler: (method: string, params: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  emit(method: string, params: Record<string, unknown> = {}): void {
    for (const listener of this.listeners) listener(method, params);
  }

  methods(): string[] {
    return this.calls.map((call) => call.method);
  }

  callsTo(method: string): Record<string, unknown>[] {
    return this.calls.filter((call) => call.method === method).map((call) => call.params);
  }
}

const ax = (nodeId: string, role: string, name: string, extra: Record<string, unknown> = {}) => ({ nodeId, role: { value: role }, name: { value: name }, ...extra });

/** A small page: a heading, a button, a text field and a password field. */
export function samplePageTree() {
  return {
    nodes: [
      ax('1', 'RootWebArea', 'Sample', { childIds: ['2', '3', '4', '5'], backendDOMNodeId: 1 }),
      ax('2', 'heading', 'Welcome', { parentId: '1', backendDOMNodeId: 2 }),
      ax('3', 'button', 'Save', { parentId: '1', backendDOMNodeId: 3 }),
      ax('4', 'textbox', 'Name', { parentId: '1', backendDOMNodeId: 4, value: { value: 'Ada' } }),
      ax('5', 'textbox', 'Password', { parentId: '1', backendDOMNodeId: 5, value: { value: 'hunter2' } }),
    ],
  };
}

/** The attributes `DOM.describeNode` returns for the sample fields. */
export function sampleDescribeNode(params: Record<string, unknown>): unknown {
  const attributes: Record<number, string[]> = { 4: ['type', 'text', 'name', 'name'], 5: ['type', 'password', 'name', 'pw'] };
  return { node: { nodeName: 'INPUT', attributes: attributes[params['backendNodeId'] as number] ?? [] } };
}
