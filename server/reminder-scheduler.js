import { listDueCalendarNotifications, markCalendarReminderDelivered } from './calendar-store.js';
import { showWindowsNotification } from './windows-notifications.js';

let checking = false;

export async function checkCalendarReminders() {
  if (checking || process.platform !== 'win32') return [];
  checking = true;
  const results = [];
  try {
    for (const reminder of listDueCalendarNotifications()) {
      const start = new Date(reminder.startAt).toLocaleString('zh-CN');
      const result = await showWindowsNotification({
        title: `星空日历 · ${reminder.title}`,
        message: `${start}${reminder.description ? ` · ${reminder.description}` : ''}`,
      });
      if (result.shown) markCalendarReminderDelivered(reminder.reminderId);
      results.push({ reminderId: reminder.reminderId, ...result });
    }
    return results;
  } finally {
    checking = false;
  }
}

export function startReminderScheduler({ intervalMs = 30000 } = {}) {
  const initial = setTimeout(() => { void checkCalendarReminders(); }, 1500);
  const interval = setInterval(() => { void checkCalendarReminders(); }, intervalMs);
  initial.unref?.();
  interval.unref?.();
  return () => { clearTimeout(initial); clearInterval(interval); };
}
