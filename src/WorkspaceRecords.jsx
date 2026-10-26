import { Brain, LoaderCircle, NotebookPen, Pencil, Pin, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';

export default function WorkspaceRecords({ kind, items, onPin, onEdit, onRemove, model, onSummarized }) {
  const notes = kind === 'notes';
  const [summarizing, setSummarizing] = useState(false);
  const [progress, setProgress] = useState([]);
  const Icon = notes ? NotebookPen : Brain;
  const title = notes ? '星空的成长档案' : '长期记忆';
  const description = notes ? '这是星空独立保存的长期约定与重要事项。' : '在这里管理后续对话中会优先带入的重要信息。';

  async function summarize() {
    if (summarizing) return;
    setSummarizing(true);
    setProgress([]);
    try {
      const response = await fetch(notes ? '/api/notebook/summarize' : '/api/memories/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        const detail = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
        throw new Error(detail.error || `无法开始总结（服务返回 ${response.status}）`);
      }
      if (!response.body || !contentType.includes('application/x-ndjson')) {
        throw new Error('总结服务尚未载入，请关闭应用后重新启动。');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const consume = (line) => {
        const update = JSON.parse(line);
        setProgress((steps) => [...steps.filter((step) => step.stage !== update.stage), update]);
        if (update.stage === 'complete' && Array.isArray(update.notes)) {
          onSummarized?.(update.notes);
          window.dispatchEvent(new CustomEvent('starry:notebook-updated', { detail: { notes: update.notes } }));
        }
        if (update.stage === 'complete' && Array.isArray(update.memories)) {
          window.dispatchEvent(new CustomEvent('starry:memories-updated', { detail: { memories: update.memories } }));
        }
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
    } catch (error) {
      setProgress((steps) => [...steps, { stage: 'error', message: error.message }]);
    } finally { setSummarizing(false); }
  }

  return <section className="workspace-page workspace-records" aria-labelledby="records-title">
    <header className="workspace-hero compact"><div><p className="workspace-kicker">{notes ? 'COMPANION NOTEBOOK' : 'PERSISTENT MEMORY'}</p><h1 id="records-title">{title}</h1><p>{description}</p></div><button type="button" className="notebook-summarize" onClick={summarize} disabled={summarizing}>{summarizing ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{summarizing ? '正在总结' : '让星空总结'}</button></header>
    {progress.length > 0 && <section className={`notebook-progress ${progress.at(-1)?.stage}`} aria-live="polite"><header><Icon size={16} /><strong>总结进程</strong></header><ol>{progress.map((step) => <li key={step.stage} className={step.stage}><span />{step.message}</li>)}</ol></section>}
    <section className="workspace-card record-card"><header><span>{items.length} 条本地记录</span><small>编辑、固定和删除会立即保存到项目数据文件。</small></header>{items.length ? <div className="record-list">{items.map((item) => <article key={item.id}><div><span className="record-kind">{item.pinned ? '固定' : notes ? item.category || '记录' : '记忆'}</span><p>{item.text}</p></div><aside><button type="button" onClick={() => onPin(item)} aria-label="固定或取消固定"><Pin size={16} /></button><button type="button" onClick={() => onEdit(item)} aria-label="编辑记录"><Pencil size={16} /></button><button type="button" className="danger" onClick={() => onRemove(item.id)} aria-label="删除记录"><Trash2 size={16} /></button></aside></article>)}</div> : <div className="workspace-empty large">这里还没有内容。{notes ? '你可以告诉星空“请记住……”让她自行记录。' : '在聊天里告诉星空重要的姓名、偏好或长期计划。'}</div>}</section>
  </section>;
}
