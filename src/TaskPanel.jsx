import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, CircleDashed, CircleStop, FolderOpen, FolderPlus, ListTodo, MessageSquare, PauseCircle, Pencil, Plus, Save, Send, Trash2, Unlink, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sanitizeAssistantContent } from './chat-format.js';

const statusLabel = { active: '进行中', blocked: '待处理', done: '已完成', archived: '已归档' };

function TaskConversation({ task, model, config, webSearchEnabled, onTaskChange }) {
  const [messages, setMessages] = useState(task.messages || []);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages]);

  async function persist(nextMessages) {
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/messages`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: nextMessages }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '无法保存任务对话');
    onTaskChange(data.task);
  }

  async function submit(event) {
    event?.preventDefault();
    const content = input.trim();
    if (!content || !model || generating) return;
    const now = Date.now();
    const userMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt: now };
    const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', model, createdAt: now + 1 };
    const requestMessages = [...messages, userMessage].map(({ role, content: text }) => ({ role, content: text }));
    let nextMessages = [...messages, userMessage, assistantMessage];
    setMessages(nextMessages); setInput(''); setError(''); setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let assistantText = '';
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ model, messages: requestMessages, conversationId: task.chatConversationId, systemPrompt: config.systemPrompt, temperature: config.temperature, webSearch: webSearchEnabled }) });
      if (!response.ok || !response.body) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `请求失败 (${response.status})`); }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const consume = (line) => {
        const chunk = JSON.parse(line);
        if (chunk.error) throw new Error(chunk.error);
        assistantText += chunk.message?.content || '';
        const visible = sanitizeAssistantContent(assistantText);
        nextMessages = nextMessages.map((message) => message.id === assistantMessage.id ? { ...message, content: visible } : message);
        setMessages(nextMessages);
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.filter((line) => line.trim()).forEach(consume);
        if (done) break;
      }
      if (buffer.trim()) consume(buffer);
      if (!assistantText.trim()) throw new Error('模型没有返回回答。');
    } catch (submitError) {
      const text = submitError.name === 'AbortError' ? '（已停止生成）' : `生成失败：${submitError.message}`;
      nextMessages = nextMessages.map((message) => message.id === assistantMessage.id ? { ...message, content: text } : message);
      setMessages(nextMessages);
      if (submitError.name !== 'AbortError') setError(submitError.message);
    } finally {
      setGenerating(false); abortRef.current = null;
      try { await persist(nextMessages); } catch (saveError) { setError(saveError.message); }
    }
  }

  return <section className="task-conversation"><header><div><MessageSquare size={16} /><strong>任务对话</strong></div><small>AI 可读取并修改此任务目录</small></header><div className="task-chat-messages">{messages.length ? messages.map((message) => <article key={message.id} className={message.role}><b>{message.role === 'user' ? '你' : message.model || '星空'}</b><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || (generating ? '正在思考…' : '')}</ReactMarkdown></article>) : <p>在这里讨论这个任务。对话、任务状态和目录内容会自动关联。</p>}<span ref={bottomRef} /></div>{error && <small className="task-chat-error">{error}</small>}<form onSubmit={submit}><textarea rows="2" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={model ? `询问 ${task.title}…` : '请先启动 Ollama'} disabled={!model || generating} />{generating ? <button type="button" onClick={() => abortRef.current?.abort()}><CircleStop size={16} />停止</button> : <button type="submit" disabled={!input.trim() || !model}><Send size={16} />发送</button>}</form></section>;
}

export default function TaskPanel({ conversationId, model, config, webSearchEnabled }) {
  const [tasks, setTasks] = useState([]);
  const [taskName, setTaskName] = useState('');
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
  const chatTaskId = '';
  function setChatTaskId(updater) {
    const projectId = typeof updater === 'function' ? updater('') : updater;
    window.dispatchEvent(new CustomEvent('starry:open-project', { detail: { projectId } }));
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/tasks');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '无法读取任务');
      setTasks(data.tasks || []);
    } catch (error) { setMessage(error.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    fetch('/api/workspace/inbox').then((response) => response.json()).then((data) => setInbox(data)).catch(() => {});
  }, []);

  async function create(event) {
    event.preventDefault();
    if (!goal.trim() || !taskName.trim() || !conversationId) return;
    const response = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, title: taskName.trim(), goal }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.error || '创建任务失败'); return; }
    setTasks((items) => [data.task, ...items]);
    setTaskName('');
    setGoal('');
    window.dispatchEvent(new CustomEvent('starry:project-created', { detail: { project: data.task } }));
    setMessage(`任务已创建，并建立目录 inbox/${data.task.title}。`);
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
      window.dispatchEvent(new CustomEvent('starry:project-removed', { detail: { projectId: task.id } }));
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
    <div className="task-heading"><div><p className="eyebrow">LOCAL TASK CONTINUITY</p><h1>任务工作台</h1><p>每个任务都有独立对话、英文目录和 AI 工作区。AI 会读取目录及其子文件夹。</p></div></div>
    <form className="task-create" onSubmit={create}><label>英文任务名<input required pattern="[A-Za-z][A-Za-z0-9_-]{1,63}" value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="例如 cmput201-assignment-1" /><small>将作为 inbox 文件夹名，只允许英文字母、数字、- 和 _。</small></label><label>任务目标<input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="例如：完成 CMPUT 201 Assignment 1" /></label><button type="submit" disabled={!goal.trim() || !taskName.trim() || !conversationId}><Plus size={16} />创建任务</button></form>
    <section className="task-inbox"><BookOpen size={20} /><div><strong>资料投递箱</strong><span>把 PDF、DOCX、TXT、Markdown 等资料放进这里，星空会在对话中读取。当前 {inbox.files?.length || 0} 个文件。</span><code>{inbox.path || '正在读取路径…'}</code></div><button type="button" onClick={openInbox}><FolderOpen size={15} />打开投递箱</button></section>
    {message && <p className="task-notice">{message}</p>}
    <div className="task-list">{loading ? <p>正在读取本地任务…</p> : tasks.length ? tasks.map((task) => {
      const editing = editingId === task.id;
      const change = (changes) => setTasks((items) => items.map((item) => item.id === task.id ? { ...item, ...changes } : item));
      return <article key={task.id} className={`task-card ${task.status} ${editing ? 'editing' : ''}`}>
        <header><span>{task.status === 'done' ? <CheckCircle2 size={17} /> : task.status === 'blocked' ? <PauseCircle size={17} /> : <CircleDashed size={17} />}{statusLabel[task.status]}</span>{!editing && <button type="button" className="task-edit" disabled={Boolean(editingId)} onClick={() => { setEditingId(task.id); setMessage(''); }}><Pencil size={14} />编辑任务信息</button>}</header>
        {editing ? <div className="task-edit-form">
          <label>英文任务名<input value={task.title} readOnly title="目录创建后任务名保持不变" /></label>
          <label>任务目标<textarea value={task.goal} maxLength={800} onChange={(event) => change({ goal: event.target.value })} /></label>
          <label>任务状态<select value={task.status} onChange={(event) => change({ status: event.target.value })}><option value="active">进行中</option><option value="blocked">待处理</option><option value="done">已完成</option><option value="archived">已归档</option></select></label>
          <label>当前进展<textarea value={task.currentState} maxLength={1000} onChange={(event) => change({ currentState: event.target.value })} placeholder="星空完成或确认了什么？" /></label>
          <label>下一步<textarea value={task.nextStep} maxLength={500} onChange={(event) => change({ nextStep: event.target.value })} placeholder="下一步要做什么？" /></label>
          <footer className="task-card-actions"><button type="button" className="task-cancel" onClick={cancelEdit} disabled={savingId === task.id}><X size={14} />取消</button><button type="button" className="task-save" onClick={() => saveTask(task)} disabled={savingId === task.id}><Save size={14} />{savingId === task.id ? '正在保存…' : '保存修改'}</button></footer>
        </div> : <><h2 className="task-display-title">{task.title}</h2><dl className="task-details"><div><dt>目标</dt><dd>{task.goal}</dd></div><div><dt>当前进展</dt><dd>{task.currentState || '尚未填写'}</dd></div><div><dt>下一步</dt><dd>{task.nextStep || '尚未填写'}</dd></div></dl><section className="task-workspace">{task.workspacePath ? <><div><FolderOpen size={17} /><span><b>AI 工作目录</b><code>{task.workspacePath}</code></span></div><footer><button type="button" onClick={() => openTaskWorkspace(task)}><FolderOpen size={14} />打开目标目录</button><button type="button" className="workspace-unlink" onClick={() => detachWorkspace(task)}><Unlink size={14} />取消授权</button></footer></> : workspaceSetupId === task.id ? <><label>文件夹完整路径<input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="例如 D:\\StarryWorkspaces\\project-name" /></label><small>路径建议只使用英文。“绑定”要求目录已存在；“创建”会先请你确认。</small><footer><button type="button" onClick={() => { setWorkspaceSetupId(''); setWorkspacePath(''); }}>取消</button><button type="button" disabled={workspaceBusy === task.id} onClick={() => setWorkspace(task, false)}>绑定已有目录</button><button type="button" className="workspace-create" disabled={workspaceBusy === task.id} onClick={() => setWorkspace(task, true)}><FolderPlus size={14} />确认创建目录</button></footer></> : <button type="button" className="workspace-setup" onClick={() => { setWorkspaceSetupId(task.id); setWorkspacePath(''); }}><FolderPlus size={15} />设置 AI 工作目录</button>}</section><footer className="task-card-actions"><button type="button" className="task-chat-toggle" onClick={() => setChatTaskId((value) => value === task.id ? '' : task.id)}><MessageSquare size={14} />{chatTaskId === task.id ? '收起任务对话' : '打开任务对话'}</button><button type="button" className="task-delete" onClick={() => remove(task)} disabled={deletingId === task.id}><Trash2 size={14} />{deletingId === task.id ? '正在删除…' : '删除任务'}</button></footer>{chatTaskId === task.id && <TaskConversation task={task} model={model} config={config} webSearchEnabled={webSearchEnabled} onTaskChange={(nextTask) => setTasks((items) => items.map((item) => item.id === nextTask.id ? nextTask : item))} />}</>}
      </article>;
    }) : <div className="task-empty"><ListTodo size={27} /><p>这里还没有任务。创建一个要持续推进的目标后，星空会在后续聊天里保持进度。</p></div>}</div>
  </section>;
}
