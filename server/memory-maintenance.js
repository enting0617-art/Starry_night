import { Temporal } from 'temporal-polyfill';
import { deduplicateMemories } from './memory.js';
import { deduplicateNotebookNotes } from './notebook.js';

export function millisecondsUntilNightly(timeZone, now = Temporal.Now.instant()) {
  const current = now.toZonedDateTimeISO(timeZone);
  let target = current.with({ hour: 23, minute: 30, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
  if (Temporal.ZonedDateTime.compare(target, current) <= 0) target = target.add({ days: 1 });
  return Math.max(1000, Number(target.epochMilliseconds - current.epochMilliseconds));
}

export async function runMemoryMaintenance() {
  const [memories, notebook] = await Promise.all([deduplicateMemories(), deduplicateNotebookNotes()]);
  return { ranAt: new Date().toISOString(), memories, notebook };
}

export function startMemoryMaintenanceScheduler({ timeZone }) {
  let timer;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        const result = await runMemoryMaintenance();
        console.log(`夜间记忆去重完成：长期记忆移除 ${result.memories.removed} 条，成长档案移除 ${result.notebook.removed} 条。`);
      } catch (error) {
        console.warn(`夜间记忆去重失败：${error.message}`);
      } finally {
        schedule();
      }
    }, millisecondsUntilNightly(timeZone));
    timer.unref?.();
  };
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
