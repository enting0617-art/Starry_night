import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, ListTodo, PauseCircle, Plus, Save } from 'lucide-react';

const statusLabel = { active: '进行中', blocked: '待处理', done: '已完成', archived: '已归档' };

export default function TaskPanel({ conversationId }) {
  const [tasks, setTasks] = useState([]);
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/tasks?conversationId=${encodeURIComponent(conversationId || '')}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '无法读取任务');
      setTasks(data.tasks || []);
    } catch (error) { setMessage(error.message); } finally { setLoading(false); }
  }, [conversationId]);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  async function create(event) {
    event.preventDefault();
    if (!goal.trim() || !conversationId) return;
    const response = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, goal }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.error || '创建任务失败'); return; }
    setTasks((items) => [data.task, ...items]);
    setGoal('');
    setMessage('任务已创建。回到聊天继续推进时，星空会自动看到它。');
  }

  async function update(id, changes) {
    const response = await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setTasks((items) => items.map((item) => item.id === id ? data.task : item));
    else setMessage(data.error || '保存任务失败');
  }

  return <section className="task-page">
    <div className="task-heading"><div><p className="eyebrow">LOCAL TASK CONTINUITY</p><h1>任务工作台</h1><p>任务状态独立保存在本地。星空继续同一对话时会带上目标、当前结论与下一步。</p></div></div>
    <form className="task-create" onSubmit={create}><label>新任务目标<input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="例如：整理鸣潮角色资料并给我一份可靠的概览" /></label><button type="submit" disabled={!goal.trim() || !conversationId}><Plus size={16} />创建任务</button></form>
    {message && <p className="task-notice">{message}</p>}
    <div className="task-list">{loading ? <p>正在读取本地任务…</p> : tasks.length ? tasks.map((task) => <article key={task.id} className={`task-card ${task.status}`}><header><span>{task.status === 'done' ? <CheckCircle2 size={17} /> : task.status === 'blocked' ? <PauseCircle size={17} /> : <CircleDashed size={17} />}{statusLabel[task.status]}</span><select value={task.status} onChange={(event) => update(task.id, { status: event.target.value })}><option value="active">进行中</option><option value="blocked">待处理</option><option value="done">已完成</option><option value="archived">已归档</option></select></header><input className="task-title" value={task.title} onChange={(event) => setTasks((items) => items.map((item) => item.id === task.id ? { ...item, title: event.target.value } : item))} onBlur={(event) => update(task.id, { title: event.target.value })} /><p><b>目标</b>{task.goal}</p><label>当前状态<textarea value={task.currentState} onChange={(event) => setTasks((items) => items.map((item) => item.id === task.id ? { ...item, currentState: event.target.value } : item))} onBlur={(event) => update(task.id, { currentState: event.target.value })} placeholder="星空完成或确认了什么？" /></label><label>下一步<textarea value={task.nextStep} onChange={(event) => setTasks((items) => items.map((item) => item.id === task.id ? { ...item, nextStep: event.target.value } : item))} onBlur={(event) => update(task.id, { nextStep: event.target.value })} placeholder="下一步要做什么？" /></label><button type="button" className="task-save" onClick={() => update(task.id, task)}><Save size={14} />保存</button></article>) : <div className="task-empty"><ListTodo size={27} /><p>这里还没有任务。创建一个要持续推进的目标后，星空会在后续聊天里保持进度。</p></div>}</div>
  </section>;
}
