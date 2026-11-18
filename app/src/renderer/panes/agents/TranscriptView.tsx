import { useEffect, useState } from 'react';
import type { TranscriptEntry } from '../../../core/agents/view';
import { api } from '../../api';

interface TranscriptAnswer {
  readonly available: boolean;
  readonly entries: readonly TranscriptEntry[];
  readonly truncated: boolean;
  readonly summary?: string | null;
}

/** A transcript as plain text, read-only. Never a terminal and never `--resume` (0027 section 4). */
export function TranscriptView({ sessionId, agentKey }: { readonly sessionId: string; readonly agentKey: string }) {
  const [answer, setAnswer] = useState<TranscriptAnswer | undefined>(undefined);
  useEffect(() => {
    let current = true;
    setAnswer(undefined);
    void api()
      .invoke<TranscriptAnswer>('agents_transcript', { sessionId, agentKey })
      .then((result) => {
        if (current && result.ok) setAnswer(result.value);
      });
    return () => {
      current = false;
    };
  }, [sessionId, agentKey]);

  if (!answer) return <p className="transcript-status">Loading transcript</p>;
  if (!answer.available) {
    return (
      <div className="transcript-status" data-testid="transcript-removed">
        <p>transcript removed</p>
        {answer.summary ? <p className="transcript-summary">{answer.summary}</p> : null}
      </div>
    );
  }
  return (
    <div className="transcript" data-testid="transcript-view" role="log" aria-label="Transcript">
      {answer.truncated ? <p className="transcript-status">The file is large: showing its last 20 MB.</p> : null}
      {answer.entries.map((entry, index) => (
        <pre key={index} className="transcript-entry" data-role={entry.role}>
          <span className="transcript-role">{entry.role}</span>
          {entry.text}
        </pre>
      ))}
    </div>
  );
}
