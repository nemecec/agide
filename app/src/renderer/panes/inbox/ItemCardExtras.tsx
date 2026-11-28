import type { ItemRow } from '../../../core/inbox/viewTypes';

/**
 * The kind-independent slot of the item card, after its actions. Renders nothing; notes (0044) fill it with
 * "Capture as note" for any item. Owner: the notes integration.
 */
export function ItemCardExtras(_props: { readonly item: ItemRow }) {
  return null;
}
