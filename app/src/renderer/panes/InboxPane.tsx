import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import { Chip } from '../ui/Chip';
import { EmptyState } from '../ui/EmptyState';
import { ACTION_ICONS, PANE_ICONS } from '../ui/icons';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ItemCard } from './inbox/ItemCard';
import { KindLabel } from './inbox/KindLabel';
import { ageOf, needsAnswer, orderItems } from './inbox/format';
import { SessionPeek } from './inbox/SessionPeek';
import { useInbox, type Filter } from './inbox/useInbox';
import type { PaneProps } from './paneTypes';
import './inbox/InboxPane.css';

const resolveItem = (itemId: string): void => void api().invoke('inbox_resolve', { itemId, resolution: 'dismissed' });

/**
 * The inbox pane (`agide/inbox`): the list of items, the detail card of the selected one and, beside it, a peek at
 * the linked session. All agent text renders as React text nodes only (0021 section 9).
 */
export function InboxPane({ instanceId }: PaneProps<{ viewId?: string; folderId?: string }>) {
  const [filter, setFilter] = useState<Filter>('open');
  const { items: fetched, unread, loaded } = useInbox(filter);
  const items = useMemo(() => orderItems(fetched), [fetched]);
  const waiting = items.filter(needsAnswer).length;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [peekSession, setPeekSession] = useState<string | undefined>(undefined);
  const list = useRef<HTMLUListElement>(null);

  const selected = items.find((item) => item.id === selectedId);
  useEffect(() => {
    if (selectedId !== undefined && !items.some((item) => item.id === selectedId) && loaded) setSelectedId(undefined);
  }, [items, selectedId, loaded]);
  // Another card replaces the peek; a card that resolves while the peek is open leaves it in place.
  useEffect(() => {
    if (selectedId !== undefined) setPeekSession(undefined);
  }, [selectedId]);

  const move = (delta: number): void => {
    if (items.length === 0) return;
    const at = items.findIndex((item) => item.id === selectedId);
    const next = items[Math.min(items.length - 1, Math.max(0, at + delta))];
    if (next) setSelectedId(next.id);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLButtonElement && event.key === 'Enter') return;
    if (event.key === 'ArrowDown') move(1);
    else if (event.key === 'ArrowUp') move(-1);
    else if (event.key === 'e' && selected) resolveItem(selected.id);
    else if (event.key === 'u' && selected) void api().invoke('inbox_mark_unread', { itemId: selected.id });
    else if (event.key === 's' && selected) void api().invoke('inbox_snooze', { itemId: selected.id, until: new Date(Date.now() + 3_600_000).toISOString() });
    else return;
    event.preventDefault();
  };

  return (
    <section className="inbox-pane" data-testid="inbox-pane" data-instance={instanceId} aria-label="Inbox" onKeyDown={onKeyDown}>
      <div className="inbox-list-column">
        <header className="inbox-header">
          <h1>Inbox</h1>
          <SegmentedControl
            aria-label="Filter"
            value={filter}
            onValueChange={(value) => setFilter(value as Filter)}
            segments={[
              { value: 'open', label: 'Open', testId: 'inbox-filter-open' },
              { value: 'done', label: 'Done', testId: 'inbox-filter-done' },
            ]}
          />
          <p className="inbox-counts">
            <span data-testid="inbox-unread" data-count={unread}>
              {unread === 0 ? 'No unread items' : `${unread} unread`}
            </span>
            {waiting > 0 && (
              <Chip tone="warning" icon={ACTION_ICONS['needs-answer'].icon} className="inbox-waiting" data-testid="inbox-waiting" label={`${waiting} need${waiting === 1 ? 's' : ''} an answer`} />
            )}
          </p>
        </header>
        {loaded && items.length === 0 ? (
          <EmptyState
            className="inbox-empty"
            data-testid="inbox-empty"
            icon={PANE_ICONS.inbox.icon}
            title={filter === 'open' ? 'Nothing waits for you' : 'Nothing done yet'}
            help={filter === 'open' ? 'New items appear here.' : 'Items you finish appear here.'}
          />
        ) : (
          <ul className="inbox-list" ref={list} aria-label="Items">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="inbox-row"
                  data-testid="inbox-row"
                  data-state={item.state}
                  data-kind={item.kind}
                  data-urgency={item.urgency}
                  aria-current={item.id === selectedId}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="inbox-row-top">
                    <span className="inbox-dot" role="img" aria-label={item.state === 'new' ? 'unread' : 'read'} data-unread={item.state === 'new'} />
                    <KindLabel kind={item.kind} />
                    {needsAnswer(item) && <Chip tone="warning" icon={ACTION_ICONS['needs-answer'].icon} className="inbox-needs-answer" data-testid="inbox-needs-answer" label="Needs answer" />}
                    <span className="inbox-row-where">{[item.projectName, item.sessionName].filter(Boolean).join(' / ')}</span>
                    <span className="inbox-row-age">{ageOf(item.updatedAt)}</span>
                  </span>
                  <span className="inbox-row-message">
                    {item.message}
                    {item.occurrences > 1 && <span className="inbox-muted"> x{item.occurrences}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="inbox-detail-column">
        {selected ? (
          <ItemCard item={selected} canPeek={selected.sessionId !== undefined} peeking={peekSession !== undefined} onPeek={() => setPeekSession(selected.sessionId)} />
        ) : loaded && items.length === 0 ? null : (
          <EmptyState icon={PANE_ICONS.inbox.icon} title="Select an item" help="Its message and actions show here." />
        )}
      </div>
      {peekSession !== undefined && <SessionPeek key={peekSession} sessionId={peekSession} onBack={() => setPeekSession(undefined)} />}
    </section>
  );
}
