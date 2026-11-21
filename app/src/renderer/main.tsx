import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { App } from './App';
import { PANE_COMPONENTS } from './panes/paneComponents';
import { startTheme } from './theme/themeContext';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

/** `#pane=<pane type id>` shows one pane alone, so a pane can be developed and tested without a layout. */
const standalone = new URLSearchParams(window.location.hash.slice(1)).get('pane');
const Standalone = standalone === null ? undefined : PANE_COMPONENTS[standalone as keyof typeof PANE_COMPONENTS];

// The tokens are on `:root` before the first render, so the page never paints in the wrong theme.
void startTheme().then(() => {
  createRoot(root).render(
    <StrictMode>{Standalone ? <Standalone instanceId="standalone" config={{}} inputs={{}} /> : <App />}</StrictMode>,
  );
});
