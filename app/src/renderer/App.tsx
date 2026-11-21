import { DialogHost } from './dialogs/DialogHost';
import { LayoutHost } from './layout/LayoutHost';
import { ThemeNotice } from './theme/ThemeNotice';
import { TooltipProvider } from './ui/index';

/** The window is a layout host: the layout file says which panes it shows and where. Dialogs float above it. */
export function App() {
  return (
    <TooltipProvider>
      <LayoutHost />
      <DialogHost />
      <ThemeNotice />
    </TooltipProvider>
  );
}
