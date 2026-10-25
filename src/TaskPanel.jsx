import { useCallback, useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, CircleDashed, FolderOpen, FolderPlus, ListTodo, PauseCircle, Pencil, Plus, Save, Trash2, Unlink, X } from 'lucide-react';

const statusLabel = { active: '进行中', blocked: '待处理', done: '已完成', archived: '已归档' };

export default function TaskPanel({ conversationId }) {
  const [tasks, setTasks] = useState([]);
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [savingId, setSavingId] = useState('');
  const [workspaceSetupId, setWorkspaceSetupId] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceBusy, setWorkspaceBusy] = useState('');
  const [inbox, setInbox] = useState({ path: '', files: [] });

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

  useEffect(() => {
    fetch('/api/workspace/inbox').then((response) => response.json()).then((data) => setInbox(data)).catch(() => {});
  }, []);

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
    if (response.ok) {
      setTasks((items) => items.map((item) => item.id === id ? data.task : item));
      return true;
    }
    setMessage(data.error || '保存任务失败');
    return false;
  }

  async function saveTask(task) {
    if (!task.title.trim() || !task.goal.trim()) { setMessage('任务标题和目标不能为空。'); return; }
    setSavingId(task.id);
    setMessage('');
    try {
      if (await update(task.id, task)) {
        setEditingId('');
        setMessage('任务信息已更新。');
      }
    } finally {
      setSavingId('');
    }
  }

  async function cancelEdit() {
    setEditingId('');
    await refresh();
  }

  async function remove(task) {
    if (!window.confirm(`确定删除任务“${task.title}”吗？此操作无法撤销。`)) return;
    setDeletingId(task.id);
    setMessage('');
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.removed) throw new Error(data.error || '删除任务失败');
      setTasks((items) => items.filter((item) => item.id !== task.id));
      setMessage('任务已删除。');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setDeletingId('');
    }
  }

  async function setWorkspace(task, create) {
    const path = workspacePath.trim();
    if (!path) { setMessage('请填写文件夹的完整路径。'); return; }
    if (create && !window.confirm(`允许星空创建并使用这个文件夹吗？\n\n${path}\n\n授权后，AI 可以在此目录内创建和修改文件。`)) return;
    if (!create && !window.confirm(`允许星空读取和修改这个已有文件夹吗？\n\n${path}`)) return;
    setWorkspaceBusy(task.id);
    setMessage('');
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/workspace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, create }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.task) throw new Error(data.error || '设置任务目录失败');
      setTasks((items) => items.map((item) => item.id === task.id ? data.task : item));
      setWorkspaceSetupId('');
      setWorkspacePath('');
      setMessage(create ? '任务目录已创建并授权给星空。' : '已有目录已绑定并授权给星空。');
    } catch (error) { setMessage(error.message); } finally { setWorkspaceBusy(''); }
  }

  async function openTaskWorkspace(task) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/workspace/open`, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(data.error || '无法打开目标目录');
  }

  async function detachWorkspace(task) {
    if (!window.confirm('只取消 AI 对此目录的授权吗？文件夹和里面的文件不会被删除。')) return;
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/workspace`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.task) {
      setTasks((items) => items.map((item) => item.id === task.id ? data.task : item));
      setMessage('已取消目录授权，原文件保持不变。');
    } else setMessage(data.error || '取消授权失败');
  }

  async function openInbox() {
    const response = await fetch('/api/workspace/inbox/open', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(data.error || '无法打开资料投递箱');
  }

  return <section className="task-page">
    <div className="task-heading"><div><p className="eyebrow">LOCAL TASK CONTINUITY</p><h1>任务工作台</h1><p>任务状态独立保存在本地。星空继续同一对话时会带上目标、当前结论与下一步。</p></div></div>
    <form className="task-create" onSubmit={create}><label>新任务目标<input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="例如：整理鸣潮角色资料并给我一份可靠的概览" /></label><button type="submit" disabled={!goal.trim() || !conversationId}><Plus size={16} />创建任务</button></form>
    <section className="task-inbox"><BookOpen size={20} /><div><strong>资料投递箱</strong><span>把 PDF、DOCX、TXT、Markdown 等资料放进这里，星空会在对话中读取。当前 {inbox.files?.length || 0} 个文件。</span><code>{inbox.path || '正在读取路径…'}</code></div><button type="button" onClick={openInbox}><FolderOpen size={15} />打开投递箱</button></section>
    {message && <p className="task-notice">{message}</p>}
    <div className="task-list">{loading ? <p>正在读取本地任务…</p> : tasks.length ? tasks.map((task) => {
      const editing = editingId === task.id;
      const change = (changes) => setTasks((items) => items.map((item) => item.id === task.id ? { ...item, ...changes } : item));
      return <article key={task.id} className={`task-card ${task.status} ${editing ? 'editing' : ''}`}>
        <header><span>{task.status === 'done' ? <CheckCircle2 size={17} /> : task.status === 'blocked' ? <PauseCircle size={17} /> : <CircleDashed size={17} />}{statusLabel[task.status]}</span>{!editing && <button type="button" className="task-edit" disabled={Boolean(editingId)} onClick={() => { setEditingId(task.id); setMessage(''); }}><Pencil size={14} />编辑任务信息</button>}</header>
        {editing ? <div className="task-edit-form">
          <label>任务标题<input value={task.title} maxLength={120} onChange={(event) => change({ title: event.target.value })} /></label>
          <label>任务目标<textarea value={task.goal} maxLength={800} onChange={(event) => change({ goal: event.target.value })} /></label>
          <label>任务状态<select value={task.status} onChange={(event) => change({ status: event.target.value })}><option value="active">进行中</option><option value="blocked">待处理</option><option value="done">已完成</option><option value="archived">已归档</option></select></label>
          <label>当前进展<textarea value={task.currentState} maxLength={1000} onChange={(event) => change({ currentState: event.target.value })} placeholder="星空完成或确认了什么？" /></label>
          <label>下一步<textarea value={task.nextStep} maxLength={500} onChange={(event) => change({ nextStep: event.target.value })} placeholder="下一步要做什么？" /></label>
          <footer className="task-card-actions"><button type="button" className="task-cancel" onClick={cancelEdit} disabled={savingId === task.id}><X size={14} />取消</button><button type="button" className="task-save" onClick={() => saveTask(task)} disabled={savingId === task.id}><Save size={14} />{savingId === task.id ? '正在保存…' : '保存修改'}</button></footer>
        </div> : <><h2 className="task-display-title">{task.title}</h2><dl className="task-details"><div><dt>目标</dt><dd>{task.goal}</dd></div><div><dt>当前进展</dt><dd>{task.currentState || '尚未填写'}</dd></div><div><dt>下一步</dt><dd>{task.nextStep || '尚未填写'}</dd></div></dl><section className="task-workspace">{task.workspacePath ? <><div><FolderOpen size={17} /><span><b>AI 工作目录</b><code>{task.workspacePath}</code></span></div><footer><button type="button" onClick={() => openTaskWorkspace(task)}><FolderOpen size={14} />打开目标目录</button><button type="button" className="workspace-unlink" onClick={() => detachWorkspace(task)}><Unlink size={14} />取消授权</button></footer></> : workspaceSetupId === task.id ? <><label>文件夹完整路径<input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="例如 D:\\星空工作区\\论文整理" /></label><small>“绑定”要求目录已存在；“创建”会先请你确认，再创建并授权。</small><footer><button type="button" onClick={() => { setWorkspaceSetupId(''); setWorkspacePath(''); }}>取消</button><button type="button" disabled={workspaceBusy === task.id} onClick={() => setWorkspace(task, false)}>绑定已有目录</button><button type="button" className="workspace-create" disabled={workspaceBusy === task.id} onClick={() => setWorkspace(task, true)}><FolderPlus size={14} />确认创建目录</button></footer></> : <button type="button" className="workspace-setup" onClick={() => { setWorkspaceSetupId(task.id); setWorkspacePath(''); }}><FolderPlus size={15} />设置 AI 工作目录</button>}</section><footer className="task-card-actions"><button type="button" className="task-delete" onClick={() => remove(task)} disabled={deletingId === task.id}><Trash2 size={14} />{deletingId === task.id ? '正在删除…' : '删除任务'}</button></footer></>}
      </article>;
    }) : <div className="task-empty"><ListTodo size={27} /><p>这里还没有任务。创建一个要持续推进的目标后，星空会在后续聊天里保持进度。</p></div>}</div>
  </section>;
}
