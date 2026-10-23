import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clipboard, Clock3, CornerDownLeft, FileJson, Play, RefreshCw, Server, TerminalSquare, Trash2, XCircle } from 'lucide-react';

const endpoints = [
  { path: '/api/tags', method: 'GET', label: '列出模型', body: '' },
  { path: '/api/ps', method: 'GET', label: '运行中的模型', body: '' },
  { path: '/api/version', method: 'GET', label: 'Ollama 版本', body: '' },
  { path: '/api/show', method: 'POST', label: '模型详情', body: '{\n  "model": ""\n}' },
  { path: '/api/chat', method: 'POST', label: '聊天测试', body: '{\n  "model": "",\n  "messages": [{ "role": "user", "content": "请回复：连接正常" }],\n  "stream": false\n}' },
  { path: '/api/generate', method: 'POST', label: '生成测试', body: '{\n  "model": "",\n  "prompt": "请回复：连接正常",\n  "stream": false\n}' },
  { path: '/api/embed', method: 'POST', label: '向量测试', body: '{\n  "model": "",\n  "input": "hello"\n}' },
];

function StatusIcon({ ok }) {
  return ok ? <CheckCircle2 className="ok-icon" size={19} /> : <XCircle className="bad-icon" size={19} />;
}

export default function DebugPanel({ models }) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [logs, setLogs] = useState([]);
  const [checking, setChecking] = useState(false);
  const [selectedPath, setSelectedPath] = useState('/api/tags');
  const selected = useMemo(() => endpoints.find((item) => item.path === selectedPath), [selectedPath]);
  const [body, setBody] = useState('');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [terminalInput, setTerminalInput] = useState('status');
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState([
    { id: 'welcome', command: '', output: '本地诊断终端已就绪。输入 help 查看安全命令。', exitCode: 0 },
  ]);
  const [report, setReport] = useState(null);
  const [reportStatus, setReportStatus] = useState('');

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const [diagnosticResponse, logsResponse] = await Promise.all([
        fetch('/api/admin/diagnostics'),
        fetch('/api/admin/logs'),
      ]);
      setDiagnostics(await diagnosticResponse.json());
      setLogs((await logsResponse.json()).entries || []);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    const timer = setTimeout(() => {
      let template = selected.body;
      if (models[0]?.name) template = template.replace('"model": ""', `"model": "${models[0].name}"`);
      setBody(template);
      setResult(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [selected, models]);

  async function runRequest() {
    setRunning(true);
    setResult(null);
    try {
      let parsedBody = {};
      if (selected.method === 'POST') parsedBody = JSON.parse(body || '{}');
      const response = await fetch('/api/admin/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: selected.method, path: selected.path, body: parsedBody }),
      });
      const data = await response.json();
      setResult({ status: response.status, ...data });
      await refresh();
    } catch (error) {
      setResult({ ok: false, error: error.message });
    } finally {
      setRunning(false);
    }
  }

  async function runTerminal(event, preset) {
    event?.preventDefault();
    const command = String(preset ?? terminalInput).trim();
    if (!command || terminalBusy) return;
    if (command.toLowerCase() === 'clear') {
      setTerminalHistory([]);
      setTerminalInput('');
      return;
    }
    setTerminalBusy(true);
    setTerminalInput('');
    try {
      const response = await fetch('/api/admin/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await response.json();
      const output = [data.stdout, data.stderr].filter(Boolean).join('\n');
      setTerminalHistory((items) => [...items, { id: `${Date.now()}-${Math.random()}`, command, output, exitCode: data.exitCode, durationMs: data.durationMs }]);
      await refresh();
    } catch (error) {
      setTerminalHistory((items) => [...items, { id: `${Date.now()}-${Math.random()}`, command, output: error.message, exitCode: 1 }]);
    } finally {
      setTerminalBusy(false);
    }
  }

  async function generateReport() {
    setReportStatus('正在生成…');
    try {
      const response = await fetch('/api/admin/report');
      const data = await response.json();
      setReport(data);
      setReportStatus(data.status === 'healthy' ? '检查通过' : '发现需要处理的项目');
    } catch (error) {
      setReport({ status: 'error', error: error.message });
      setReportStatus('生成失败');
    }
  }

  async function copyReport() {
    if (!report) return;
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setReportStatus('已复制诊断 JSON');
  }

  return (
    <section className="debug-page">
      <div className="debug-heading">
        <div><p className="eyebrow">LOCAL CONTROL ROOM</p><h1>后台调试中心</h1><p>检查运行状态、调用 Ollama 接口，并查看最近请求。</p></div>
        <div className="heading-actions"><button className="secondary-button refresh-button" onClick={generateReport}><FileJson size={16} />生成报告</button><button className="secondary-button refresh-button" onClick={refresh} disabled={checking}><RefreshCw size={16} className={checking ? 'spin' : ''} />重新检查</button></div>
      </div>

      {report && <div className="report-panel"><div><StatusIcon ok={report.status === 'healthy'} /><strong>诊断报告：{reportStatus}</strong><small>{report.generatedAt || '刚刚生成'} · {report.checks?.length || 0} 项检查</small></div><button onClick={copyReport}><Clipboard size={15} />复制 JSON</button><pre>{JSON.stringify(report, null, 2)}</pre></div>}

      <div className="metric-grid">
        <div className="metric-card"><div className="metric-label"><Server size={17} />本地服务</div><strong>正常</strong><small>Node {diagnostics?.app?.node || '—'} · {diagnostics?.app?.platform || '—'}</small></div>
        <div className="metric-card"><div className="metric-label"><Activity size={17} />Ollama</div><div className="metric-value"><StatusIcon ok={diagnostics?.ok} /><strong>{diagnostics?.ok ? '已连接' : '未连接'}</strong></div><small>{diagnostics?.ollama?.baseUrl || '正在检查…'}</small></div>
        <div className="metric-card"><div className="metric-label"><Clock3 size={17} />响应时间</div><strong>{diagnostics?.latencyMs != null ? `${diagnostics.latencyMs} ms` : '—'}</strong><small>Ollama {diagnostics?.ollama?.version || '—'}</small></div>
        <div className="metric-card"><div className="metric-label"><TerminalSquare size={17} />模型</div><strong>{diagnostics?.ollama?.installedModels ?? models.length}</strong><small>{diagnostics?.ollama?.runningModels?.length ? `运行中：${diagnostics.ollama.runningModels.join(', ')}` : '当前没有加载中的模型'}</small></div>
      </div>

      {diagnostics?.error && <div className="diagnostic-error"><XCircle size={18} /><div><strong>连接诊断</strong><span>{diagnostics.error}</span></div></div>}

      <div className="terminal-card">
        <div className="terminal-topbar">
          <div className="terminal-title"><span className="terminal-lights"><i /><i /><i /></span><TerminalSquare size={16} /><strong>诊断终端</strong><small>安全白名单 · 纯文本输出</small></div>
          <button className="terminal-clear" onClick={() => setTerminalHistory([])} title="清空终端"><Trash2 size={14} />清空</button>
        </div>
        <div className="terminal-presets">
          {['status', 'ollama --version', 'ollama list', 'ollama ps', 'project files'].map((command) => <button key={command} onClick={() => runTerminal(null, command)} disabled={terminalBusy}>{command}</button>)}
        </div>
        <div className="terminal-output" aria-live="polite">
          {terminalHistory.map((entry) => <div className="terminal-entry" key={entry.id}>
            {entry.command && <div className="terminal-command"><span>local-ai $</span> {entry.command}<small>{entry.durationMs != null ? `${entry.durationMs} ms · exit ${entry.exitCode}` : ''}</small></div>}
            <pre className={entry.exitCode ? 'terminal-error-output' : ''}>{entry.output}</pre>
          </div>)}
          {terminalBusy && <div className="terminal-running">命令运行中<span>▋</span></div>}
        </div>
        <form className="terminal-input-row" onSubmit={runTerminal}>
          <span>local-ai $</span>
          <input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} placeholder="输入 help 查看可用命令" autoComplete="off" spellCheck="false" />
          <button type="submit" disabled={terminalBusy || !terminalInput.trim()}><CornerDownLeft size={16} /></button>
        </form>
      </div>

      <div className="debug-columns">
        <div className="debug-card api-runner">
          <div className="card-title"><div><span>接口调用器</span><small>仅开放安全的 Ollama 接口</small></div><span className="local-badge">LOCAL ONLY</span></div>
          <label>接口<select value={selectedPath} onChange={(event) => setSelectedPath(event.target.value)}>{endpoints.map((endpoint) => <option key={endpoint.path} value={endpoint.path}>{endpoint.method} · {endpoint.label} · {endpoint.path}</option>)}</select></label>
          {selected.method === 'POST' && <label>请求 JSON<textarea className="code-input" value={body} onChange={(event) => setBody(event.target.value)} spellCheck="false" /></label>}
          <button className="run-button" onClick={runRequest} disabled={running}><Play size={16} />{running ? '调用中…' : '运行调用'}</button>
          <div className="response-box">
            <div><span>响应</span>{result && <small className={result.ok ? 'success-text' : 'error-text'}>{result.ok ? `${result.upstreamStatus} · ${result.durationMs} ms` : `失败${result.status ? ` · ${result.status}` : ''}`}</small>}</div>
            <pre>{result ? JSON.stringify(result.data ?? { error: result.error }, null, 2) : '运行接口后，结果会显示在这里。'}</pre>
          </div>
        </div>

        <div className="debug-card log-card">
          <div className="card-title"><div><span>最近请求</span><small>自动记录状态与耗时</small></div><span className="log-count">{logs.length}</span></div>
          <div className="log-list">
            {!logs.length && <div className="empty-logs">暂无请求记录</div>}
            {logs.map((entry) => <div className="log-row" key={entry.id}><span className={`method method-${entry.method.toLowerCase()}`}>{entry.method}</span><span className="log-path">{entry.path}</span><span className={entry.status < 400 ? 'success-text' : 'error-text'}>{entry.status}</span><span className="log-duration">{entry.durationMs} ms</span></div>)}
          </div>
        </div>
      </div>
    </section>
  );
}
