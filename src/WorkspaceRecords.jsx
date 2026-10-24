import { Brain, NotebookPen, Pencil, Pin, Trash2 } from 'lucide-react';

export default function WorkspaceRecords({ kind, items, onPin, onEdit, onRemove }) {
  const notes = kind === 'notes';
  const Icon = notes ? NotebookPen : Brain;
  const title = notes ? '星空的成长档案' : '长期记忆';
  const description = notes ? '这是星空独立保存的长期约定与重要事项。' : '在这里管理后续对话中会优先带入的重要信息。';
  return <section className="workspace-page workspace-records" aria-labelledby="records-title">
    <header className="workspace-hero compact"><div><p className="workspace-kicker">{notes ? 'COMPANION NOTEBOOK' : 'PERSISTENT MEMORY'}</p><h1 id="records-title">{title}</h1><p>{description}</p></div><Icon aria-hidden="true" /></header>
    <section className="workspace-card record-card"><header><span>{items.length} 条本地记录</span><small>编辑、固定和删除会立即保存到项目数据文件。</small></header>{items.length ? <div className="record-list">{items.map((item) => <article key={item.id}><div><span className="record-kind">{item.pinned ? '固定' : notes ? item.category || '记录' : '记忆'}</span><p>{item.text}</p></div><aside><button type="button" onClick={() => onPin(item)} aria-label="固定或取消固定"><Pin size={16} /></button><button type="button" onClick={() => onEdit(item)} aria-label="编辑记录"><Pencil size={16} /></button><button type="button" className="danger" onClick={() => onRemove(item.id)} aria-label="删除记录"><Trash2 size={16} /></button></aside></article>)}</div> : <div className="workspace-empty large">这里还没有内容。{notes ? '你可以告诉星空“请记住……”让她自行记录。' : '在聊天里告诉星空重要的姓名、偏好或长期计划。'}</div>}</section>
  </section>;
}
