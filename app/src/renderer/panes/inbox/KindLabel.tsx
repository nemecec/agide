import { Icon } from '../../ui/Icon';
import { INBOX_KIND_ICONS, type InboxKind } from '../../ui/icons';
import { KIND_LABEL } from './format';

/** The kind of an inbox item: its glyph in the tone colour, then the kind name, which always shows beside the colour. */
export function KindLabel({ kind }: { readonly kind: string }) {
  const mark = INBOX_KIND_ICONS[kind as InboxKind] ?? INBOX_KIND_ICONS.update;
  return (
    <span className="inbox-kind" data-kind={kind} data-tone={mark.tone}>
      <Icon icon={mark.icon} size="sm" className="inbox-kind-icon" />
      <span className="inbox-kind-word">{KIND_LABEL[kind] ?? kind}</span>
    </span>
  );
}
