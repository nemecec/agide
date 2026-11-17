import { useEffect, useState } from 'react';
import type { ItemContextInfo, ItemRow } from '../../../core/inbox/viewTypes';
import { api } from '../../api';
import { ageOf, KIND_LABEL, payloadText, tomorrowMorning } from './format';

const SEEN_AFTER_MS = 1000;
const COLLAPSED_CHARS = 240;

/** Runs an inbox command from a button; the pane refreshes through the inbox events. */
const act = (id: string, input: Record<string, unknown>): void => void api().invoke(id, input);

/**
 * The detail card of one item: project and session layers, the short message, the long description that expands
 * in place, the raw payload of an approval, and the actions. Every string from an agent renders as a text node.
 */
export function ItemCard({ item, canPeek, peeking, onPeek }: { item: ItemRow; canPeek: boolean; peeking: boolean; onPeek: () => void }) {
  const [context, setContext] = useState<ItemContextInfo>({});
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let live = true;
    void api()
      .invoke<ItemContextInfo>('inbox_context', { itemId: item.id })
      .then((result) => live && result.ok && setContext(result.value));
    return () => {
      live = false;
    };
  }, [item.id, item.updatedAt]);

  useEffect(() => setExpanded(false), [item.id]);

  useEffect(() => {
    if (item.state !== 'new') return;
    const timer = setTimeout(() => act('inbox_mark_seen', { itemId: item.id }), SEEN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [item.id, item.state, item.updatedAt]);

  const details = item.details;
  const long = details !== undefined && (details.length > COLLAPSED_CHARS || details.split('\n').length > 4);
  const raw = item.kind === 'approval' ? payloadText(item.payload) : undefined;
  const snooze = (until: Date) => act('inbox_snooze', { itemId: item.id, until: until.toISOString() });
  const url = item.linkAnchor && 'url' in item.linkAnchor ? item.linkAnchor.url : undefined;

  return (
    <article className="inbox-card" data-testid="inbox-card" data-item-id={item.id} data-state={item.state}>
      <header className="inbox-card-context" data-testid="inbox-card-context">
        <div>
          <span className="inbox-label">Project</span>{' '}
          <strong data-testid="inbox-project-name">{context.project?.name ?? 'No project'}</strong>
          {context.project?.summary !== undefined && <p data-testid="inbox-project-summary">{context.project.summary}</p>}
        </div>
        <div>
          <span className="inbox-label">Session</span>{' '}
          <strong data-testid="inbox-session-name">{context.session?.name ?? 'No session'}</strong>
          {context.session?.summary !== undefined && (
            <p data-testid="inbox-session-summary">
              {context.session.summary}{' '}
              <span className="inbox-muted" data-testid="inbox-session-summary-time">
                (summary generated {ageOf(context.session.summaryGeneratedAt ?? item.createdAt)}
                {context.session.summaryModel ? ` by ${context.session.summaryModel}` : ''})
              </span>
            </p>
          )}
        </div>
      </header>

      <div className="inbox-card-body">
        <p className="inbox-kind">
          {KIND_LABEL[item.kind] ?? item.kind}
          {item.textAuthor === 'agent' && <span className="inbox-muted"> - text written by the agent</span>}
          {item.occurrences > 1 && <span className="inbox-muted"> - repeated {item.occurrences} times</span>}
          {item.folderRemoved && <span className="inbox-muted"> - its folder was removed</span>}
        </p>
        <h2 data-testid="inbox-message">{item.message}</h2>
        {details !== undefined && (
          <>
            <pre className={expanded || !long ? 'inbox-details' : 'inbox-details collapsed'} data-testid="inbox-details" data-expanded={expanded}>
              {details}
            </pre>
            {long && (
              <button type="button" className="inbox-link" data-testid="inbox-expand" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </>
        )}
        {raw !== undefined && (
          <>
            <p className="inbox-label">Raw request</p>
            <pre className="inbox-raw" data-testid="inbox-raw">
              {raw}
            </pre>
          </>
        )}
        {url !== undefined && (
          <p>
            <span className="inbox-label">Link</span> <code data-testid="inbox-url">{url}</code>
          </p>
        )}
        {item.resolution !== undefined && <p className="inbox-muted">Done: {item.resolution}</p>}
        {item.snoozedUntil !== undefined && <p className="inbox-muted">Snoozed until {new Date(item.snoozedUntil).toLocaleString()}</p>}
      </div>

      <footer className="inbox-actions" data-testid="inbox-actions">
        {item.state === 'done' ? (
          <button type="button" onClick={() => act('inbox_reopen', { itemId: item.id })}>
            Reopen
          </button>
        ) : (
          <>
            <button type="button" onClick={() => act('inbox_resolve', { itemId: item.id, resolution: 'dismissed' })} data-testid="inbox-done">
              Done
            </button>
            {item.state === 'new' ? (
              <button type="button" onClick={() => act('inbox_mark_seen', { itemId: item.id })} data-testid="inbox-mark-seen">
                Mark seen
              </button>
            ) : item.state === 'seen' ? (
              <button type="button" onClick={() => act('inbox_mark_unread', { itemId: item.id })} data-testid="inbox-mark-unread">
                Mark unread
              </button>
            ) : null}
            <button type="button" onClick={() => snooze(new Date(Date.now() + 10 * 60_000))}>
              Snooze 10 min
            </button>
            <button type="button" onClick={() => snooze(new Date(Date.now() + 60 * 60_000))}>
              Snooze 1 h
            </button>
            <button type="button" onClick={() => snooze(tomorrowMorning())}>
              Snooze to tomorrow 09:00
            </button>
          </>
        )}
        {canPeek && (
          <button type="button" onClick={onPeek} aria-pressed={peeking} data-testid="inbox-peek-open">
            Peek at session
          </button>
        )}
      </footer>
    </article>
  );
}
