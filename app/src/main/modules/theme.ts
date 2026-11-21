import { registerThemeCommands } from '../../core/theme/commands';
import { ThemeService } from '../../core/theme/service';
import type { ModuleContext, ModuleHandle } from '../context';

/** Theme module: the themes of the profile, its theme choice with history, previews, VS Code import and the theme tools. */
export function init(ctx: ModuleContext): ModuleHandle<ThemeService> {
  const service = new ThemeService({ dataDir: ctx.dataDir });
  const unregister = registerThemeCommands(ctx.commands, service);
  return {
    service,
    dispose: () => {
      for (const off of unregister) off();
      service.dispose();
    },
  };
}
