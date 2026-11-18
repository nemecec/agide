import { DialogHost } from './dialogs/DialogHost';
import { LayoutHost } from './layout/LayoutHost';
import { SetupPane } from './panes/SetupPane';
import './dialogs/dialogs.css';

/** The window is a layout host: the layout file says which panes it shows and where. The setup pane and dialogs float above it. */
export function App() {
  return (
    <>
      <LayoutHost />
      <SetupPane />
      <DialogHost />
    </>
  );
}
