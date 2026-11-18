import { useEffect, useState } from 'react';
import type { TrustState } from '../../../core/tasks/types';
import { api } from '../../api';
import './trustBanner.css';

const TEXT: Record<Exclude<TrustState, 'none'>, string> = {
  user_input: 'Claude asks whether to trust this folder; answer in the terminal',
  answering: 'Agide is answering Claude\'s folder-trust question for this folder, which it created',
  needs_user: 'Claude asks whether to trust this folder; answer in the terminal (Agide could not answer)',
};

/** What the session pane shows while Claude's folder-trust question is open (0028 section 11). */
export function TrustBanner({ sessionId }: { readonly sessionId: string }) {
  const [state, setState] = useState<TrustState>('none');
  useEffect(() => {
    let current = true;
    const stop = api().subscribe((event) => {
      if (event.type === 'tasks.trust_changed' && event.sessionId === sessionId) setState(event.state);
    });
    void api()
      .invoke<{ states: Record<string, TrustState> }>('task_trust_state')
      .then((result) => current && result.ok && setState(result.value?.states?.[sessionId] ?? 'none'));
    return () => {
      current = false;
      stop();
    };
  }, [sessionId]);
  if (state === 'none') return null;
  return (
    <div className="trust-banner" role="status" data-testid="trust-banner" data-state={state}>
      {TEXT[state]}
    </div>
  );
}
