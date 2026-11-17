/**
 * What the layout host gives every pane component (0020 section 7: the same host contract for first-party
 * and code panes). The layout builder adds `setConfig`, `invoke`, `subscribe`, `context` and `storage`.
 */
export interface PaneProps<Config extends object = Record<string, unknown>> {
  readonly instanceId: string;
  readonly config: Config;
  /** Values of the pane's inputs, resolved from its bindings (context key, fixed value or data source). */
  readonly inputs: Readonly<Record<string, unknown>>;
}
