import { app, BrowserWindow, Notification } from 'electron';
import type { Desktop, DesktopNotification } from './context';

/** Notifications a quiet desktop recorded, read by the end-to-end tests through `app.evaluate`. */
export const QUIET_NOTIFICATIONS_KEY = '__agideNotifications';

/**
 * Electron's notifications and dock badge. A quiet desktop (hidden end-to-end runs) records notifications
 * in a global list and shows nothing.
 */
export function createDesktop(options: { readonly quiet: boolean }): Desktop {
  const recorded: DesktopNotification[] = [];
  if (options.quiet) (globalThis as Record<string, unknown>)[QUIET_NOTIFICATIONS_KEY] = recorded;
  return {
    notify(notification) {
      if (options.quiet || !Notification.isSupported()) {
        recorded.push(notification);
        return;
      }
      const shown = new Notification({ title: notification.title, body: notification.body, silent: false });
      shown.on('click', () => {
        const [window] = BrowserWindow.getAllWindows();
        if (window?.isMinimized()) window.restore();
        app.focus({ steal: true });
        window?.focus();
        notification.onClick?.();
      });
      shown.show();
    },
    setBadgeCount(count) {
      app.setBadgeCount(count);
    },
  };
}
