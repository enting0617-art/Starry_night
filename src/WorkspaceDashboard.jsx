import { Activity, Brain, CalendarDays, CheckCircle2, Clock3, MessageSquare, NotebookPen, Sparkles } from 'lucide-react';

function relativeTime(value) {
  const elapsed = Math.max(0, Date.now() - Number(value || 0));
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return `${Math.floor(elapsed / 86_400_000)} 天前`;
}

export default function WorkspaceDashboard({ companionName, conversations, memories, notes, status, onNavigate }) {
  const recentConversations = [...conversations].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)).slice(0, 4);
  const recentNotes = notes.slice(0, 3);
  return (
    <section className="workspace-page workspace-dashboard" aria-labelledby="workspace-title">
      <header className="workspace-hero">
        <div>
          <p className="workspace-kicker">STARLIGHT WORKSPACE</p>
          <h1 id="workspace-title">晚上好，工作台已经准备好了。</h1>
          <p>在这里整理和 {companionName || '星空'} 的对话、长期记忆与任务。切回陪伴模式时，当前会话和生成不会中断。</p>
        </div>
        <div className={`workspace-health ${status?.ok ? 'healthy' : 'offline'}`}><span />{status?.ok ? '本地模型已连接' : '等待 Ollama 连接'}</div>
      </header>

      <div className="workspace-stat-grid">
        <button type="button" className="workspace-stat-card" onClick={() => onNavigate('tasks')}><CheckCircle2 /><span>任务工作台</span><strong>继续推进</strong><small>将长期目标拆成可追踪步骤</small></button>
        <button type="button" className="workspace-stat-card" onClick={() => onNavigate('memory')}><Brain /><span>长期记忆</span><strong>{memories.length} 条</strong><small>可查看、固定和修正重要信息</small></button>
        <button type="button" className="workspace-stat-card" onClick={() => onNavigate('notes')}><NotebookPen /><span>成长档案</span><strong>{notes.length} 条</strong><small>星空自主记录的长期约定</small></button>
        <button type="button" className="workspace-stat-card" onClick={() => onNavigate('calendar')}><CalendarDays /><span>日历与提醒</span><strong>已启用</strong><small>AI 可在对话中参考你的近期安排</small></button>
      </div>

      <div className="workspace-grid">
        <section className="workspace-card recent-card"><header><div><Clock3 /><span>最近对话</span></div><button type="button" onClick={() => onNavigate('companion')}>打开陪伴</button></header>{recentConversations.length ? <div className="workspace-list">{recentConversations.map((conversation) => <button type="button" key={conversation.id} onClick={() => onNavigate('companion', conversation.id)}><MessageSquare /><span><strong>{conversation.title || '未命名对话'}</strong><small>{conversation.messages?.length || 0} 条消息 · {relativeTime(conversation.updatedAt)}</small></span></button>)}</div> : <p className="workspace-empty">从一次对话开始，内容会自动保存在本地。</p>}</section>
        <section className="workspace-card notes-card"><header><div><Sparkles /><span>最近记录</span></div><button type="button" onClick={() => onNavigate('notes')}>查看全部</button></header>{recentNotes.length ? <div className="workspace-note-list">{recentNotes.map((note) => <article key={note.id}><span>{note.pinned ? '固定' : note.category || '记录'}</span><p>{note.text}</p></article>)}</div> : <p className="workspace-empty">还没有成长档案。你可以对星空说“请记住……”。</p>}</section>
        <section className="workspace-card activity-card"><header><div><Activity /><span>运行状态</span></div><button type="button" onClick={() => onNavigate('tools')}>打开诊断</button></header><div className="workspace-activity"><span className={status?.ok ? 'activity-dot ok' : 'activity-dot'} /> <div><strong>{status?.ok ? 'Ollama 本地服务正常' : 'Ollama 等待连接'}</strong><small>{status?.message || '可以从调试中心检查本机服务。'}</small></div></div></section>
      </div>
    </section>
  );
}
