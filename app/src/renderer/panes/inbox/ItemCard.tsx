import { useEffect, useState } from 'react';
import type { ItemContextInfo, ItemRow } from '../../../core/inbox/viewTypes';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Disclosure } from '../../ui/Disclosure';
import { Hint } from '../../ui/Hint';
import { Menu } from '../../ui/Menu';
import type { MenuEntry } from '../../ui/menuModel';
import { Notice } from '../../ui/Notice';
import { ageOf, isStructuredText, needsAnswer, payloadText, tomorrowMorning } from './format';
import { KindLabel } from './KindLabel';

const SEEN_AFTER_MS = 1000;
const COLLAPSED_CHARS = 240;

/** Runs an inbox command from a button; the pane refreshes through the inbox events. */
const act = (id: string, input: Record<string, unknown>): void => void api().invoke(id, input);

/**
 * The detail card of one item: kind, message and where it comes from, the long description that expands in place,
 * the raw payload of an approval, and the actions. Every string from an agent renders as a text node.
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
  const structured = details !== undefined && isStructuredText(details);
  const long = details !== undefined && (details.length > COLLAPSED_CHARS || details.split('\n').length > 4);
  const raw = item.kind === 'approval' ? payloadText(item.payload) : undefined;
  const snooze = (until: Date) => act('inbox_snooze', { itemId: item.id, until: until.toISOString() });
  const snoozes: MenuEntry[] = [
    { label: '10 minutes', run: () => snooze(new Date(Date.now() + 10 * 60_000)) },
    { label: '1 hour', run: () => snooze(new Date(Date.now() + 60 * 60_000)) },
    { label: 'Tomorrow 09:00', run: () => snooze(tomorrowMorning()) },
  ];
  const url = item.linkAnchor && 'url' in item.linkAnchor ? item.linkAnchor.url : undefined;
  const browserApprovalId = item.origin === 'browser:approval' ? (item.payload as { approvalId?: unknown } | undefined)?.approvalId : undefined;
  const openSession = (): void => act('ui_focus_node', { nodeId: item.linkNodeId });
  const where = [context.project?.name, context.session?.name].filter(Boolean).join(' / ');

  return (
    <article className="inbox-card" data-testid="inbox-card" data-item-id={item.id} data-state={item.state}>
      <header className="inbox-card-head">
        <p className="inbox-card-kind">
          <KindLabel kind={item.kind} />
          {item.textAuthor === 'agent' && <span className="inbox-muted"> text written by the agent</span>}
          {item.occurrences > 1 && <span className="inbox-muted"> repeated {item.occurrences} times</span>}
          {item.folderRemoved && <span className="inbox-muted"> its folder was removed</span>}
        </p>
        <h2 data-testid="inbox-message">{item.message}</h2>
        <p className="inbox-card-meta">
          {where !== '' && <span>{where}</span>}
          <time dateTime={item.updatedAt}>{ageOf(item.updatedAt)}</time>
        </p>
      </header>

      <dl className="inbox-card-context" data-testid="inbox-card-context">
        <dt>Folder</dt>
        <dd>
          <strong data-testid="inbox-project-name">{context.project?.name ?? 'No project'}</strong>
          {context.project?.summary !== undefined && <p data-testid="inbox-project-summary">{context.project.summary}</p>}
        </dd>
        <dt>Session</dt>
        <dd>
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
        </dd>
      </dl>

      <div className="inbox-card-body">
        {details !== undefined && (
          <>
            <pre className={`${structured ? 'inbox-raw ' : ''}${expanded || !long ? 'inbox-details' : 'inbox-details collapsed'}`} data-testid="inbox-details" data-expanded={expanded}>
              {details}
            </pre>
            {long && (
              <Button variant="quiet" size="sm" className="inbox-expand" data-testid="inbox-expand" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Show less' : 'Show more'}
              </Button>
            )}
          </>
        )}
        {raw !== undefined && (
          <Disclosure label="Details" className="inbox-raw-block" defaultOpen={details === undefined}>
            <pre className="inbox-raw" data-testid="inbox-raw">
              {raw}
            </pre>
          </Disclosure>
        )}
        {needsAnswer(item) && typeof browserApprovalId !== 'string' && (
          <Notice tone="warning" role="status" data-testid="inbox-answer-note">
            The session is waiting for your answer. Allow or deny it in the session; this card cannot answer for it.
          </Notice>
        )}
        {url !== undefined && (
          <p className="inbox-link-line">
            <span className="inbox-label">Link</span> <code data-testid="inbox-url">{url}</code>
          </p>
        )}
        {item.resolution !== undefined && <Hint>Done: {item.resolution}</Hint>}
        {item.snoozedUntil !== undefined && <Hint>Snoozed until {new Date(item.snoozedUntil).toLocaleString()}</Hint>}
      </div>

      <footer className="inbox-actions" data-testid="inbox-actions">
        {item.state === 'done' ? (
          <Button onClick={() => act('inbox_reopen', { itemId: item.id })}>Reopen</Button>
        ) : (
          <>
            {typeof browserApprovalId === 'string' && (
              <>
                <Button onClick={() => act('browser_answer_approval', { id: browserApprovalId, answer: 'deny' })} data-testid="inbox-browser-deny">
                  Deny
                </Button>
                <Button variant="primary" onClick={() => act('browser_answer_approval', { id: browserApprovalId, answer: 'once' })} data-testid="inbox-browser-allow-once">
                  Allow once
                </Button>
              </>
            )}
            {needsAnswer(item) && item.linkNodeId !== undefined && typeof browserApprovalId !== 'string' && (
              <Button variant="primary" onClick={openSession} data-testid="inbox-answer-in-session">
                Open session to answer
              </Button>
            )}
            {item.kind === 'failure' && item.linkNodeId !== undefined && (
              <Button variant="primary" onClick={openSession} data-testid="inbox-open-session">
                Open session
              </Button>
            )}
            <Button
              onClick={() => act('inbox_resolve', { itemId: item.id, resolution: 'dismissed' })}
              data-testid="inbox-done"
              title={item.kind === 'approval' ? 'Hides this item. The request stays open in its session.' : undefined}
            >
              {item.kind === 'approval' ? 'Dismiss without answering' : 'Done'}
            </Button>
            <Menu align="start" entries={snoozes} trigger={<Button chevron>Snooze</Button>} />
            {item.state === 'new' ? (
              <Button variant="quiet" onClick={() => act('inbox_mark_seen', { itemId: item.id })} data-testid="inbox-mark-seen">
                Mark as read
              </Button>
            ) : item.state === 'seen' ? (
              <Button variant="quiet" onClick={() => act('inbox_mark_unread', { itemId: item.id })} data-testid="inbox-mark-unread">
                Mark as unread
              </Button>
            ) : null}
          </>
        )}
        {canPeek && (
          <Button variant="quiet" onClick={onPeek} aria-pressed={peeking} data-testid="inbox-peek-open">
            Peek at session
          </Button>
        )}
      </footer>
    </article>
  );
}
