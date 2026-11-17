import { LayoutHost } from './layout/LayoutHost';
import { SetupPane } from './panes/SetupPane';

/** The window is a layout host: the layout file says which panes it shows and where. The setup pane floats above it. */
export function App() {
  return (
    <>
      <LayoutHost />
      <SetupPane />
    </>
  );
}
