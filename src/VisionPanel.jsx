import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleStop, Image, Play, RefreshCw, Save, Search } from 'lucide-react';

export default function VisionPanel({ config }) {
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [emojis, setEmojis] = useState([]);
  const [stats, setStats] = useState({ count: 0, pendingDescriptions: 0 });
  const [job, setJob] = useState({ status: 'idle', total: 0, processed: 0, updated: 0, failed: 0, errors: [] });
  const [search, setSearch] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [limit, setLimit] = useState(config?.vision?.batchMaxItems || 500);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);

  const refresh = useCallback(async (force = false) => {
    try {
      setError('');
      const [visionResponse, emojiResponse, statusResponse] = await Promise.all([
        fetch(`/api/vision/models${force ? '?refresh=1' : ''}`), fetch('/api/emojis?limit=500'), fetch('/api/admin/emojis/vision/status'),
      ]);
      const visionData = await visionResponse.json();
      const emojiData = await emojiResponse.json();
      const statusData = await statusResponse.json();
      if (!visionResponse.ok) throw new Error(visionData.error);
      setModels(visionData.models || []);
      setModel((current) => (visionData.models || []).some((item) => item.name === current) ? current : visionData.preferred || '');
      setEmojis(emojiData.emojis || []);
      setStats(emojiData.stats || {});
      setJob(statusData);
    } catch (cause) { setError(cause.message || '读取视觉管理状态失败'); }
  }, []);

  useEffect(() => { const timer = setTimeout(refresh, 0); return () => clearTimeout(timer); }, [refresh]);
  useEffect(() => {
    if (!['running', 'stopping'].includes(job.status)) return undefined;
    const timer = setInterval(async () => {
      const response = await fetch('/api/admin/emojis/vision/status');
      const next = await response.json();
      setJob(next);
      if (!['running', 'stopping'].includes(next.status)) refresh();
    }, 1200);
    return () => clearInterval(timer);
  }, [job.status, refresh]);

  async function start() {
    try {
      setError('');
      const response = await fetch('/api/admin/emojis/vision/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, overwrite, limit }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setJob(data);
    } catch (cause) { setError(cause.message || '无法启动批量识别'); }
  }

  async function stop() {
    const response = await fetch('/api/admin/emojis/vision/stop', { method: 'POST' });
    setJob(await response.json());
  }

  async function saveDescription(emoji) {
    setSavingId(emoji.id);
    try {
      const response = await fetch(`/api/emojis/${emoji.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: emoji.description }) });
      if (!response.ok) throw new Error('保存失败');
    } catch (cause) { setError(cause.message); } finally { setSavingId(null); }
  }

  const visible = useMemo(() => emojis.filter((emoji) => !search || `${emoji.id} ${emoji.fileName} ${emoji.description}`.toLowerCase().includes(search.toLowerCase())), [emojis, search]);
  const running = ['running', 'stopping'].includes(job.status);
  const progress = job.total ? Math.round(job.processed / job.total * 100) : 0;

  return <section className="vision-page">
    <div className="vision-heading">
      <div><p className="eyebrow">LOCAL VISION</p><h1>图像与表情管理</h1><p>视觉识别完全由本机 Ollama 处理，图片不会上传到云端。</p></div>
      <button className="secondary-button refresh-button" onClick={() => refresh(true)}><RefreshCw size={15} />重新检测</button>
    </div>
    {error && <div className="diagnostic-error"><Image size={18} /><div><strong>视觉功能提示</strong><span>{error}</span></div></div>}
    <div className="vision-metrics">
      <div><span>视觉模型</span><strong>{models.length}</strong><small>{models.map((item) => item.name).join(' · ') || '未检测到'}</small></div>
      <div><span>表情总数</span><strong>{stats.count || 0}</strong><small>数据库内的本地图片</small></div>
      <div><span>等待识别</span><strong>{stats.pendingDescriptions || 0}</strong><small>仍使用文件名描述</small></div>
      <div><span>任务进度</span><strong>{progress}%</strong><small>{job.processed || 0} / {job.total || 0}，失败 {job.failed || 0}</small></div>
    </div>
    <div className="vision-control-card">
      <label>识别模型<select value={model} onChange={(event) => setModel(event.target.value)} disabled={running}>{models.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
      <label>本次最多识别<input type="number" min="1" max={config?.vision?.batchMaxItems || 500} value={limit} onChange={(event) => setLimit(Number(event.target.value))} disabled={running} /></label>
      <label className="vision-check"><input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} disabled={running} />重新识别已有描述</label>
      {running ? <button className="stop-batch" onClick={stop} disabled={job.status === 'stopping'}><CircleStop size={16} />{job.status === 'stopping' ? '等待当前图片完成…' : '停止任务'}</button> : <button className="start-batch" onClick={start} disabled={!model}><Play size={16} />开始批量识别</button>}
      <div className="vision-progress"><i style={{ width: `${progress}%` }} /></div>
      <small>逐张串行识别，不会一次加载全部图片；关闭服务会停止任务。</small>
    </div>
    <div className="vision-library">
      <div className="vision-library-head"><div><strong>表情数据库</strong><span>{visible.length} 张可见</span></div><label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索序号、文件名或描述" /></label></div>
      <div className="vision-grid">{visible.map((emoji) => <article key={emoji.id}>
        <div className="vision-thumb"><img loading="lazy" src={`/api/emojis/${emoji.id}/image`} alt={emoji.description || '表情'} /><span>#{emoji.id}</span></div>
        <input value={emoji.description} onChange={(event) => setEmojis((items) => items.map((item) => item.id === emoji.id ? { ...item, description: event.target.value } : item))} />
        <button onClick={() => saveDescription(emoji)} disabled={savingId === emoji.id}><Save size={13} />{savingId === emoji.id ? '保存中' : '保存'}</button>
      </article>)}</div>
    </div>
  </section>;
}
