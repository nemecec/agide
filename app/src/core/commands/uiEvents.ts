import type { NodeId } from '../tree/types';

/** Events of UI commands that change no stored state. The renderer reacts to them. */
export type UiEvent = { readonly type: 'ui.focus_node'; readonly nodeId: NodeId };
