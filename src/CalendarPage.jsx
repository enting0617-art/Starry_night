import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Clock3, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react';
import { createViewDay, createViewMonthGrid, createViewWeek } from '@schedule-x/calendar';
import { createEventsServicePlugin } from '@schedule-x/events-service';
import 'temporal-polyfill/global';
import '@schedule-x/theme-default/dist/index.css';

function localInput(iso, allDay = false) {
  if (!iso) return '';
  const date = new Date(iso);
  if (allDay) return date.toISOString().slice(0, 10);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function initialForm(event) {
  const start = event ? new Date(event.startAt) : new Date(Date.now() + 3600000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = event ? new Date(event.endAt) : new Date(start.getTime() + 3600000);
  return {
    title: event?.title || '',
    description: event?.description || '',
    allDay: Boolean(event?.allDay),
    start: localInput(start.toISOString(), event?.allDay),
    end: localInput(end.toISOString(), event?.allDay),
    remindBeforeMinutes: event?.remindBeforeMinutes ?? 10,
  };
}

function toApiValue(form, timezone) {
  const startAt = form.allDay ? new Date(`${form.start}T00:00:00Z`).toISOString() : new Date(form.start).toISOString();
  const endAt = form.allDay ? new Date(`${form.end}T00:00:00Z`).toISOString() : new Date(form.end).toISOString();
  return { ...form, startAt, endAt, timezone, remindBeforeMinutes: form.remindBeforeMinutes === '' ? null : Number(form.remindBeforeMinutes) };
}

function calendarValue(event, timezone) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    start: event.allDay ? Temporal.PlainDate.from(event.startAt.slice(0, 10)) : Temporal.Instant.from(event.startAt).toZonedDateTimeISO(timezone),
    end: event.allDay ? Temporal.PlainDate.from(event.endAt.slice(0, 10)) : Temporal.Instant.from(event.endAt).toZonedDateTimeISO(timezone),
    calendarId: 'starry',
  };
}

function EventEditor({ event, timezone, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(() => initialForm(event));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputType = form.allDay ? 'date' : 'datetime-local';

  function change(name, value) { setForm((current) => ({ ...current, [name]: value })); }

  function toggleAllDay(checked) {
    setForm((current) => {
      if (checked) {
        const startDate = current.start.slice(0, 10);
        let endDate = current.end.slice(0, 10);
        if (!endDate || endDate <= startDate) {
          const next = new Date(`${startDate}T00:00:00`);
          next.setDate(next.getDate() + 1);
          endDate = localInput(next.toISOString(), true);
        }
        return { ...current, allDay: true, start: startDate, end: endDate };
      }
      return { ...current, allDay: false, start: `${current.start}T09:00`, end: `${current.end}T10:00` };
    });
  }

  async function save(submitEvent) {
    submitEvent.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(event ? `/api/calendar/events/${event.id}` : '/api/calendar/events', {
        method: event ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toApiValue(form, timezone)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '保存日程失败');
      onSaved(data.event);
    } catch (saveError) { setError(saveError.message); } finally { setSaving(false); }
  }

  async function remove() {
    if (!event || !window.confirm(`删除日程“${event.title}”？`)) return;
    setSaving(true);
    const response = await fetch(`/api/calendar/events/${event.id}`, { method: 'DELETE' });
    if (response.ok) onDeleted(event.id);
    else { setError((await response.json().catch(() => ({}))).error || '删除日程失败'); setSaving(false); }
  }

  return <div className="calendar-modal-backdrop" onMouseDown={onClose}>
    <form className="calendar-editor" onSubmit={save} onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}>
      <header><div><span>{event ? <Pencil size={16} /> : <Plus size={16} />}</span><div><strong>{event ? '编辑日程' : '新建日程'}</strong><small>{timezone}</small></div></div><button type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
      <label>标题<input autoFocus required maxLength="160" value={form.title} onChange={(inputEvent) => change('title', inputEvent.target.value)} placeholder="例如：复习 SQL" /></label>
      <label>说明<textarea maxLength="2000" value={form.description} onChange={(inputEvent) => change('description', inputEvent.target.value)} placeholder="可选：地点、资料或要完成的内容" /></label>
      <label className="calendar-check"><input type="checkbox" checked={form.allDay} onChange={(inputEvent) => toggleAllDay(inputEvent.target.checked)} />全天日程</label>
      <div className="calendar-time-grid"><label>开始<input required type={inputType} value={form.start} onChange={(inputEvent) => change('start', inputEvent.target.value)} /></label><label>结束<input required type={inputType} value={form.end} onChange={(inputEvent) => change('end', inputEvent.target.value)} /></label></div>
      <label>提前提醒<select value={form.remindBeforeMinutes} onChange={(inputEvent) => change('remindBeforeMinutes', inputEvent.target.value)}><option value="">不提醒</option><option value="0">准时</option><option value="5">5 分钟</option><option value="10">10 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="1440">1 天</option></select></label>
      {error && <p role="alert" className="calendar-error">{error}</p>}
      <footer>{event && <button type="button" className="calendar-delete" onClick={remove} disabled={saving}><Trash2 size={15} />删除</button>}<span /><button type="button" onClick={onClose}>取消</button><button type="submit" className="calendar-primary" disabled={saving}>{saving ? '保存中…' : '保存日程'}</button></footer>
    </form>
  </div>;
}

export default function CalendarPage({ theme = 'night' }) {
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const [eventsService] = useState(() => createEventsServicePlugin());
  const [events, setEvents] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState([]);
  const selected = editingId ? events.find((event) => event.id === editingId) : null;

  const calendar = useCalendarApp({
    locale: 'zh-CN',
    timezone,
    defaultView: 'month-grid',
    views: [createViewMonthGrid(), createViewWeek(), createViewDay()],
    events: [],
    calendars: { starry: { colorName: 'starry', lightColors: { main: '#526fc2', container: '#e4eafd', onContainer: '#243763' }, darkColors: { main: '#a4b9ff', container: '#24345d', onContainer: '#edf1ff' } } },
    isDark: theme === 'night',
    callbacks: { onEventClick: (event) => setEditingId(String(event.id)) },
    plugins: [eventsService],
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/calendar/events');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '无法读取日程');
      setEvents(data.events || []);
      eventsService.set((data.events || []).map((event) => calendarValue(event, timezone)));
      setError('');
    } catch (loadError) { setError(loadError.message); } finally { setLoading(false); }
  }, [eventsService, timezone]);

  const checkNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/calendar/notifications');
      const data = await response.json();
      if (response.ok && data.notifications?.length) setNotifications((current) => [...data.notifications, ...current].slice(0, 5));
    } catch { /* The next poll will retry. */ }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    const initialTimer = setTimeout(() => { void checkNotifications(); }, 0);
    const interval = setInterval(checkNotifications, 30000);
    return () => { clearTimeout(initialTimer); clearInterval(interval); };
  }, [checkNotifications]);

  function upsert(event) {
    setEvents((current) => {
      const next = current.some((item) => item.id === event.id) ? current.map((item) => item.id === event.id ? event : item) : [...current, event];
      eventsService.set(next.map((item) => calendarValue(item, timezone)));
      return next;
    });
    setEditingId(null);
    setCreating(false);
  }

  function removed(id) {
    setEvents((current) => {
      const next = current.filter((item) => item.id !== id);
      eventsService.set(next.map((item) => calendarValue(item, timezone)));
      return next;
    });
    setEditingId(null);
  }

  return <section className="calendar-page">
    <div className="calendar-heading"><div><p className="workspace-kicker">LOCAL CALENDAR & REMINDERS</p><h1>星空日历</h1><p>日程和提醒保存在本地 SQLite。点击日程可以编辑，提醒会在应用打开时显示。</p></div><div className="calendar-actions"><button type="button" onClick={refresh} disabled={loading}><RefreshCw size={16} />刷新</button><button type="button" className="calendar-primary" onClick={() => setCreating(true)}><Plus size={17} />新建日程</button></div></div>
    {notifications.map((notice) => <div className="calendar-notification" key={notice.reminderId}><CalendarClock size={19} /><div><strong>日程提醒 · {notice.title}</strong><span>{new Date(notice.startAt).toLocaleString('zh-CN', { timeZone: timezone })}{notice.description ? ` · ${notice.description}` : ''}</span></div><button type="button" onClick={() => setNotifications((items) => items.filter((item) => item.reminderId !== notice.reminderId))}><X size={16} /></button></div>)}
    {error && <p role="alert" className="calendar-error">{error}</p>}
    <div className="calendar-layout"><div className="calendar-canvas">{loading && !events.length ? <div className="calendar-loading"><Clock3 size={22} />正在读取本地日程…</div> : <ScheduleXCalendar calendarApp={calendar} />}</div><aside className="calendar-upcoming"><header><CalendarClock size={17} /><strong>接下来</strong></header>{events.filter((event) => new Date(event.endAt) >= new Date()).slice(0, 8).map((event) => <button type="button" key={event.id} onClick={() => setEditingId(event.id)}><time>{new Date(event.startAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: event.allDay ? undefined : '2-digit', minute: event.allDay ? undefined : '2-digit', timeZone: timezone })}</time><strong>{event.title}</strong><small>{event.remindBeforeMinutes === null ? '无提醒' : event.reminderStatus === 'delivered' ? '已提醒' : `提前 ${event.remindBeforeMinutes} 分钟`}</small></button>)}{!events.length && !loading && <p>还没有日程，创建第一条计划吧。</p>}</aside></div>
    {(creating || selected) && <EventEditor key={selected?.id || 'new'} event={selected} timezone={timezone} onClose={() => { setCreating(false); setEditingId(null); }} onSaved={upsert} onDeleted={removed} />}
  </section>;
}
