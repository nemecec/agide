import { ObservationIndicator } from '../browser/ObservationIndicator';
import { useBrowserTab } from '../browser/useBrowserTab';

/** Observation indicator on a browser-tab leaf (0026 section 6). A leaf the module did not record shows nothing. */
export function BrowserTabDecorations({ surfaceId }: { readonly surfaceId: string }) {
  const { state, reading } = useBrowserTab({ surfaceId }, { poll: false });
  if (state === undefined || !state.known) return null;
  return (
    <span className="tree-observation" data-testid="tree-observation" data-mode={state.mode}>
      <ObservationIndicator mode={state.mode} reading={reading} />
    </span>
  );
}
