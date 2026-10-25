import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Bot, Brain, Bug, CalendarDays, ChevronDown, CircleStop, FolderOpen, Globe2, ImagePlus, Images, LayoutDashboard, ListTodo, Menu, MessageSquarePlus, NotebookPen, PanelLeftClose, Pencil, Pin, Plus, Search, Send, Settings2, SmilePlus, Sparkles, Trash2, UserRound, Volume2, VolumeX, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DebugPanel from './DebugPanel.jsx';
import CompanionAvatar from './CompanionAvatar.jsx';
import VisionPanel from './VisionPanel.jsx';
import TaskPanel from './TaskPanel.jsx';
import WorkspaceDashboard from './WorkspaceDashboard.jsx';
import WorkspaceRecords from './WorkspaceRecords.jsx';
import CalendarPage from './CalendarPage.jsx';
import CalendarProposalGroup from './CalendarProposalGroup.jsx';
import { extractCalendarProposals, findSelectedAssistantEmoji, sanitizeAssistantContent } from './chat-format.js';

const STORAGE_KEY = 'portable-ollama-chat:v1';

function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function timestamp() {
  return Date.now();
}

function sanitizeConversations(conversations) {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: (conversation.messages || []).map((message) => message.role === 'assistant' ? { ...message, content: sanitizeAssistantContent(message.content, { preserveEmojiMarkers: true }) } : message),
  }));
}

function newConversation(projectId = '') {
  return { id: uid(), title: '新对话', projectId, messages: [], updatedAt: Date.now() };
}

function loadSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(value?.conversations) && value.conversations.length) return value;
  } catch {
    // Ignore invalid browser data and start cleanly.
  }
  const conversation = newConversation();
  return { conversations: [conversation], activeId: conversation.id };
}

export default function App() {
  const initial = useMemo(() => loadSaved(), []);
  const [conversations, setConversations] = useState(initial.conversations);
  const [activeId, setActiveId] = useState(initial.activeId);
  const [config, setConfig] = useState({ appName: 'Local AI', defaultModel: '', systemPrompt: '', temperature: 0.7, companion: { name: '小栖', autoSpeak: false }, vision: { preferredModel: '', maxImageBytes: 8388608 }, webSearch: { enabled: true } });
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [input, setInput] = useState('');
  const [status, setStatus] = useState({ loading: true, message: '正在连接 Ollama…', ok: false });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState('idle');
  const [view, setView] = useState('chat');
  const [mode, setMode] = useState(() => localStorage.getItem('xingkong:app-mode:v1') || 'companion');
  const [workspaceSection, setWorkspaceSection] = useState(() => localStorage.getItem('xingkong:workspace-section:v1') || 'dashboard');
  const [theme, setTheme] = useState(() => localStorage.getItem('xingkong:theme:v1') || 'night');
  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('xingkong:auto-speak') === 'true');
  const [voiceProvider, setVoiceProvider] = useState(() => localStorage.getItem('xingkong:voice-provider:v2') || 'sovits');
  const [voiceError, setVoiceError] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const [voiceLoadingId, setVoiceLoadingId] = useState(null);
  const [memories, setMemories] = useState([]);
  const [notebookNotes, setNotebookNotes] = useState([]);
  const [projects, setProjects] = useState([]);
  const [emojis, setEmojis] = useState([]);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState(null);
  const [visionModels, setVisionModels] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState('');
  const [historyReady, setHistoryReady] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => localStorage.getItem('xingkong:web-search') === 'true');
  const [proactive, setProactive] = useState({ enabled: false, idleMinutes: 180, checkSeconds: 60 });
  const [proactiveStatus, setProactiveStatus] = useState('');
  const abortRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const voiceAbortRef = useRef(null);
  const voicePlaybackIdRef = useRef(0);
  const bottomRef = useRef(null);
  const composerInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const historySaveTimerRef = useRef(null);
  const historySnapshotRef = useRef({ conversations: initial.conversations, activeId: initial.activeId });
  const proactiveCheckingRef = useRef(false);

  useEffect(() => {
    const textarea = composerInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 240);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 240 ? 'auto' : 'hidden';
  }, [input]);

  const active = conversations.find((item) => item.id === activeId) || conversations[0];
  const activeConversationId = active?.id;
  const activeUpdatedAt = active?.updatedAt;

  useEffect(() => {
    let cancelled = false;
    async function hydrateHistory() {
      try {
        const response = await fetch('/api/conversations');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '无法读取本地聊天数据库');
        const source = data.conversations?.length ? data : initial;
        const next = { ...source, conversations: sanitizeConversations(source.conversations) };
        if (!data.conversations?.length) {
          const importResponse = await fetch('/api/conversations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
          if (!importResponse.ok) throw new Error((await importResponse.json()).error || '旧聊天记录导入失败');
        }
        if (cancelled) return;
        setConversations(next.conversations);
        setActiveId(next.activeId || next.conversations[0]?.id);
        historySnapshotRef.current = next;
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        if (!cancelled) setHistoryError(`聊天数据库暂时不可用：${error.message}`);
      } finally {
        if (!cancelled) setHistoryReady(true);
      }
    }
    hydrateHistory();
    return () => { cancelled = true; };
  }, [initial]);

  useEffect(() => {
    historySnapshotRef.current = { conversations, activeId };
    if (!historyReady || historySaveTimerRef.current) return;
    historySaveTimerRef.current = setTimeout(async () => {
      historySaveTimerRef.current = null;
      try {
        const response = await fetch('/api/conversations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(historySnapshotRef.current) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '保存失败');
        setHistoryError('');
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        setHistoryError(`聊天记录尚未写入项目文件夹：${error.message}`);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(historySnapshotRef.current));
      }
    }, 500);
  }, [conversations, activeId, historyReady]);

  useEffect(() => () => clearTimeout(historySaveTimerRef.current), []);

  useEffect(() => { localStorage.setItem('xingkong:voice-provider:v2', voiceProvider); }, [voiceProvider]);
  useEffect(() => { localStorage.setItem('xingkong:auto-speak', String(autoSpeak)); }, [autoSpeak]);
  useEffect(() => { localStorage.setItem('xingkong:web-search', String(webSearchEnabled)); }, [webSearchEnabled]);
  useEffect(() => { localStorage.setItem('xingkong:app-mode:v1', mode); }, [mode]);
  useEffect(() => { localStorage.setItem('xingkong:workspace-section:v1', workspaceSection); }, [workspaceSection]);
  useEffect(() => { localStorage.setItem('xingkong:theme:v1', theme); }, [theme]);

  useEffect(() => {
    if (!historyReady || !emojis.length) return;
    const timer = setTimeout(() => {
      setConversations((items) => {
        let changed = false;
        const next = items.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => {
            if (message.role !== 'assistant' || !/\[\[EMOJI:\d+\]\]/iu.test(message.content || '')) return message;
            const emoji = findSelectedAssistantEmoji(message.content, emojis);
            changed = true;
            return { ...message, content: sanitizeAssistantContent(message.content), emojiId: emoji?.id || message.emojiId || null, emojiDescription: emoji?.description || message.emojiDescription || null };
          }),
        }));
        return changed ? next : items;
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [emojis, historyReady]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages, generating]);

  const refreshModels = useCallback(async () => {
    setStatus({ loading: true, message: '正在连接 Ollama…', ok: false });
    try {
      const [configResponse, modelResponse, memoryResponse, emojiResponse, visionResponse, notebookResponse, proactiveResponse] = await Promise.all([fetch('/api/config'), fetch('/api/models'), fetch('/api/memories'), fetch('/api/emojis?limit=500'), fetch('/api/vision/models'), fetch('/api/notebook'), fetch('/api/companion/preferences')]);
      const appConfig = await configResponse.json();
      const modelData = await modelResponse.json();
      const memoryData = await memoryResponse.json();
      const emojiData = await emojiResponse.json();
      const visionData = await visionResponse.json().catch(() => ({ models: [] }));
      const notebookData = await notebookResponse.json().catch(() => ({ notes: [] }));
      const proactiveData = await proactiveResponse.json().catch(() => null);
      if (!configResponse.ok) throw new Error(appConfig.error);
      if (!modelResponse.ok) throw new Error(modelData.error);
      const available = modelData.models || [];
      setConfig(appConfig);
      setMemories(memoryData.memories || []);
      setNotebookNotes(notebookData.notes || []);
      if (proactiveData) setProactive(proactiveData);
      setEmojis(emojiData.emojis || []);
      setVisionModels(visionResponse.ok ? visionData.models || [] : []);
      setModels(available);
      setModel((current) => current || (available.some((item) => item.name === appConfig.defaultModel) ? appConfig.defaultModel : available[0]?.name || ''));
      setStatus({ loading: false, message: available.length ? `${available.length} 个本地模型` : '尚未安装模型', ok: available.length > 0 });
      document.title = appConfig.appName;
    } catch (error) {
      setStatus({ loading: false, message: error.message || '无法连接 Ollama', ok: false });
    }
  }, []);

  function stopVoice() {
    voicePlaybackIdRef.current += 1;
    voiceAbortRef.current?.abort();
    voiceAbortRef.current = null;
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setVoiceLoadingId(null);
    setSpeakingMessageId(null);
    setSpeaking(false);
  }

  async function playVoice(messageId, text) {
    if (!text.trim()) return;
    if (speakingMessageId === messageId || voiceLoadingId === messageId) { stopVoice(); return; }
    stopVoice();
    const playbackId = voicePlaybackIdRef.current;
    const controller = new AbortController();
    voiceAbortRef.current = controller;
    setVoiceLoadingId(messageId);
    setVoiceError('');
    if (voiceProvider === 'sovits') {
      try {
        const response = await fetch('/api/voice/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 800) }), signal: controller.signal });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.error || `语音服务返回 ${response.status}`);
        }
        const blob = await response.blob();
        if (controller.signal.aborted || playbackId !== voicePlaybackIdRef.current) return;
        const audioUrl = URL.createObjectURL(blob);
        audioUrlRef.current = audioUrl;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.onplay = () => { if (playbackId === voicePlaybackIdRef.current) { setVoiceLoadingId(null); setSpeakingMessageId(messageId); setSpeaking(true); } };
        audio.onended = () => { if (playbackId === voicePlaybackIdRef.current) stopVoice(); };
        audio.onerror = () => { if (playbackId === voicePlaybackIdRef.current) { stopVoice(); setVoiceError('音频播放失败'); } };
        await audio.play();
      } catch (error) {
        if (error.name !== 'AbortError' && playbackId === voicePlaybackIdRef.current) {
          stopVoice();
          setVoiceError(`GPT-SoVITS 未能朗读：${error.message}`);
        }
      }
      return;
    }
    if (!('speechSynthesis' in window)) { stopVoice(); setVoiceError('浏览器不支持语音朗读'); return; }
    const utterance = new SpeechSynthesisUtterance(text.replace(/[`#*_>]/g, ''));
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.onstart = () => { if (playbackId === voicePlaybackIdRef.current) { setVoiceLoadingId(null); setSpeakingMessageId(messageId); setSpeaking(true); } };
    utterance.onend = () => { if (playbackId === voicePlaybackIdRef.current) stopVoice(); };
    utterance.onerror = () => { if (playbackId === voicePlaybackIdRef.current) stopVoice(); };
    window.speechSynthesis.speak(utterance);
  }

  function toggleAutoSpeak() {
    setAutoSpeak((value) => {
      if (value) stopVoice();
      return !value;
    });
  }

  useEffect(() => () => {
    voiceAbortRef.current?.abort();
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  useEffect(() => {
    const timer = setTimeout(refreshModels, 0);
    return () => clearTimeout(timer);
  }, [refreshModels]);

  useEffect(() => {
    fetch('/api/tasks').then((response) => response.json()).then((data) => setProjects(data.tasks || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const open = (event) => {
      const projectId = event.detail?.projectId;
      if (!projectId) return;
      setConversations((items) => {
        const existing = items.find((conversation) => conversation.projectId === projectId);
        if (existing) { setActiveId(existing.id); return items; }
        const conversation = newConversation(projectId);
        setActiveId(conversation.id);
        return [conversation, ...items];
      });
      setMode('companion'); setView('chat');
    };
    const created = (event) => {
      const project = event.detail?.project;
      if (!project) return;
      setProjects((items) => [project, ...items.filter((item) => item.id !== project.id)]);
      open(new CustomEvent('starry:open-project', { detail: { projectId: project.id } }));
    };
    const removed = (event) => {
      const projectId = event.detail?.projectId;
      if (!projectId) return;
      setProjects((items) => items.filter((project) => project.id !== projectId));
      setConversations((items) => items.map((conversation) => conversation.projectId === projectId ? { ...conversation, projectId: '' } : conversation));
    };
    window.addEventListener('starry:open-project', open);
    window.addEventListener('starry:project-created', created);
    window.addEventListener('starry:project-removed', removed);
    return () => { window.removeEventListener('starry:open-project', open); window.removeEventListener('starry:project-created', created); window.removeEventListener('starry:project-removed', removed); };
  }, []);

  function updateConversation(id, updater) {
    setConversations((items) => items.map((item) => item.id === id ? updater(item) : item));
  }

  function createChat(projectId = '') {
    stopVoice();
    const conversation = newConversation(projectId);
    setConversations((items) => [conversation, ...items]);
    setActiveId(conversation.id);
    setInput('');
    setSelectedImage(null);
  }

  function openProject(projectId) {
    const existing = conversations.find((conversation) => conversation.projectId === projectId);
    if (existing) {
      stopVoice(); setActiveId(existing.id); setMode('companion'); setView('chat');
    } else {
      createChat(projectId); setMode('companion'); setView('chat');
    }
  }

  async function selectImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImageError('');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setImageError('仅支持 PNG、JPEG、WebP 或 GIF 图片。'); return; }
    if (file.size > (config.vision?.maxImageBytes || 8388608)) { setImageError(`图片不能超过 ${Math.round((config.vision?.maxImageBytes || 8388608) / 1048576)}MB。`); return; }
    setImageUploading(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('无法读取图片'));
        reader.readAsDataURL(file);
      });
      const response = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '图片上传失败');
      setSelectedEmoji(null);
      setEmojiPickerOpen(false);
      setSelectedImage({ id: data.id, url: data.url, name: file.name, mimeType: file.type });
    } catch (error) { setImageError(error.message); } finally { setImageUploading(false); }
  }

  function removeChat(event, id) {
    event.stopPropagation();
    if (id === activeId) stopVoice();
    setConversations((items) => {
      const remaining = items.filter((item) => item.id !== id);
      if (remaining.length) {
        if (id === activeId) setActiveId(remaining[0].id);
        return remaining;
      }
      const replacement = newConversation();
      setActiveId(replacement.id);
      return [replacement];
    });
  }

  async function removeNotebookEntry(id) {
    const response = await fetch(`/api/notebook/${id}`, { method: 'DELETE' });
    if (response.ok) setNotebookNotes((items) => items.filter((item) => item.id !== id));
  }

  async function removeMemoryEntry(id) {
    const response = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
    if (response.ok) setMemories((items) => items.filter((item) => item.id !== id));
  }

  async function updateNotebookEntry(item) {
    const text = window.prompt('编辑星空的笔记：', item.text);
    if (text === null) return;
    const response = await fetch(`/api/notebook/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setNotebookNotes((items) => items.map((entry) => entry.id === item.id ? data.note : entry));
  }

  async function toggleNotebookPin(item) {
    const response = await fetch(`/api/notebook/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !item.pinned }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setNotebookNotes((items) => items.map((entry) => entry.id === item.id ? data.note : entry));
  }

  async function updateMemoryEntry(item) {
    const text = window.prompt('编辑这条长期记忆：', item.text);
    if (text === null) return;
    const response = await fetch(`/api/memories/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setMemories((items) => items.map((entry) => entry.id === item.id ? data.memory : entry));
    else setHistoryError(data.error || '保存记忆失败');
  }

  async function toggleMemoryPin(item) {
    const response = await fetch(`/api/memories/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !item.pinned }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setMemories((items) => items.map((entry) => entry.id === item.id ? data.memory : entry));
  }

  async function updateProactive(changes) {
    const response = await fetch('/api/companion/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
    const data = await response.json().catch(() => null);
    if (response.ok && data) { setProactive(data); setProactiveStatus(data.enabled ? `已开启：空闲 ${data.idleMinutes} 分钟后，星空最多主动联系一次，直到你再次说话。` : '已关闭主动联系。'); }
    else setProactiveStatus('主动联系设置保存失败。');
  }

  async function confirmCalendarProposal(conversationId, messageId, proposal) {
    updateConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => message.id === messageId ? { ...message, calendarProposalStatus: 'saving', calendarProposalError: '' } : message) }));
    try {
      const response = await fetch('/api/calendar/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proposal) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '创建日程失败');
      updateConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => message.id === messageId ? { ...message, calendarProposalStatus: 'created', calendarEventId: data.event.id } : message), updatedAt: timestamp() }));
    } catch (error) {
      updateConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => message.id === messageId ? { ...message, calendarProposalStatus: 'error', calendarProposalError: error.message } : message) }));
    }
  }

  function dismissCalendarProposal(conversationId, messageId) {
    updateConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => message.id === messageId ? { ...message, calendarProposalStatus: 'dismissed' } : message), updatedAt: timestamp() }));
  }

  function updateCalendarProposalState(conversationId, messageId, index, status, error = '', eventId = '') {
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => {
        if (message.id !== messageId) return message;
        const statuses = [...(message.calendarProposalStatuses || message.calendarProposals.map(() => 'pending'))];
        const errors = [...(message.calendarProposalErrors || message.calendarProposals.map(() => ''))];
        const eventIds = [...(message.calendarEventIds || message.calendarProposals.map(() => ''))];
        statuses[index] = status;
        errors[index] = error;
        if (eventId) eventIds[index] = eventId;
        return { ...message, calendarProposalStatuses: statuses, calendarProposalErrors: errors, calendarEventIds: eventIds };
      }),
      updatedAt: timestamp(),
    }));
  }

  async function confirmCalendarProposalAt(conversationId, messageId, index, proposal) {
    updateCalendarProposalState(conversationId, messageId, index, 'saving');
    try {
      const response = await fetch('/api/calendar/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proposal) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '创建日程失败');
      updateCalendarProposalState(conversationId, messageId, index, 'created', '', data.event.id);
    } catch (error) {
      updateCalendarProposalState(conversationId, messageId, index, 'error', error.message);
    }
  }

  async function confirmAllCalendarProposals(conversationId, messageId, actionable) {
    const indexes = actionable.map((item) => item.index);
    updateConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => {
      if (message.id !== messageId) return message;
      const statuses = [...(message.calendarProposalStatuses || message.calendarProposals.map(() => 'pending'))];
      indexes.forEach((index) => { statuses[index] = 'saving'; });
      return { ...message, calendarProposalStatuses: statuses, calendarBatchSaving: true };
    }) }));
    try {
      const response = await fetch('/api/calendar/events/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: actionable.map((item) => item.proposal) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '批量创建日程失败');
      updateConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => {
        if (message.id !== messageId) return message;
        const statuses = [...message.calendarProposalStatuses];
        const eventIds = [...(message.calendarEventIds || message.calendarProposals.map(() => ''))];
        indexes.forEach((index, offset) => { statuses[index] = 'created'; eventIds[index] = data.events[offset]?.id || ''; });
        return { ...message, calendarProposalStatuses: statuses, calendarEventIds: eventIds, calendarBatchSaving: false };
      }), updatedAt: timestamp() }));
    } catch (error) {
      updateConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => {
        if (message.id !== messageId) return message;
        const statuses = [...message.calendarProposalStatuses];
        const errors = [...(message.calendarProposalErrors || message.calendarProposals.map(() => ''))];
        indexes.forEach((index) => { statuses[index] = 'error'; errors[index] = error.message; });
        return { ...message, calendarProposalStatuses: statuses, calendarProposalErrors: errors, calendarBatchSaving: false };
      }) }));
    }
  }

  function dismissCalendarProposalAt(conversationId, messageId, index) {
    updateCalendarProposalState(conversationId, messageId, index, 'dismissed');
  }

  useEffect(() => {
    if (!historyReady || !activeConversationId || !model || generating || !proactive.enabled) return undefined;
    let cancelled = false;
    const check = async () => {
      if (cancelled || proactiveCheckingRef.current) return;
      proactiveCheckingRef.current = true;
      try {
        const response = await fetch('/api/companion/proactive/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: activeConversationId, model }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || cancelled || !data.due || !Array.isArray(data.messages)) return;
        const now = Date.now();
        const additions = data.messages.map((content, index) => {
          const emoji = findSelectedAssistantEmoji(content, emojis);
          return { id: uid(), role: 'assistant', content: sanitizeAssistantContent(content), emojiId: emoji?.id || null, emojiDescription: emoji?.description || null, model, proactive: true, createdAt: now + index };
        });
        updateConversation(activeConversationId, (conversation) => ({ ...conversation, messages: [...conversation.messages, ...additions], updatedAt: timestamp() }));
        setProactiveStatus('星空刚刚主动留下了一条消息。');
      } catch {
        // A background companion check should never interrupt normal chatting.
      } finally { proactiveCheckingRef.current = false; }
    };
    const initialTimer = setTimeout(check, 1200);
    const timer = setInterval(check, Math.max(30, proactive.checkSeconds || 60) * 1000);
    return () => { cancelled = true; clearTimeout(initialTimer); clearInterval(timer); };
  }, [activeConversationId, activeUpdatedAt, emojis, generating, historyReady, model, proactive.enabled, proactive.checkSeconds]);

  async function submit(event) {
    event?.preventDefault();
    const typedContent = input.trim();
    const content = typedContent || (selectedEmoji ? `[表情：${selectedEmoji.description}]` : selectedImage ? '请看看这张图片。' : '');
    if (!content || !model || generating || !active) return;

    const visualModel = selectedImage ? (visionModels.some((item) => item.name === model) ? model : (visionModels.some((item) => item.name === config.vision?.preferredModel) ? config.vision.preferredModel : visionModels[0]?.name)) : model;
    if (selectedImage && !visualModel) { setImageError('没有检测到支持图像的 Ollama 模型。'); return; }

    const conversationId = active.id;
    const messageCreatedAt = timestamp();
    const userMessage = { id: uid(), role: 'user', content, emojiId: selectedEmoji?.id || null, emojiDescription: selectedEmoji?.description || null, imageId: selectedImage?.id || null, imageName: selectedImage?.name || null, createdAt: messageCreatedAt };
    const assistantMessage = { id: uid(), role: 'assistant', content: '', model: visualModel, createdAt: messageCreatedAt };
    const requestMessages = [...active.messages, userMessage].filter((message) => !message.interrupted && (message.role !== 'assistant' || !/^(（已停止生成）|连接失败：|生成失败：)/.test(message.content))).map(({ role, content: text, emojiDescription, imageId }) => ({ role, content: role === 'user' && emojiDescription ? `${text}\n用户发送的表情含义：${emojiDescription}` : text, imageIds: imageId ? [imageId] : undefined }));
    setInput('');
    setSelectedEmoji(null);
    setSelectedImage(null);
    setImageError('');
    setEmojiPickerOpen(false);
    setGenerating(true);
    setGenerationPhase('waiting');
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title: conversation.messages.length ? conversation.title : content.slice(0, 28),
      messages: [...conversation.messages, userMessage, assistantMessage],
      updatedAt: Date.now(),
    }));

    const controller = new AbortController();
    abortRef.current = controller;
    stopVoice();
    let assistantText = '';
    let thinkingText = '';
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: visualModel, messages: requestMessages, conversationId, projectId: active.projectId || '', systemPrompt: config.systemPrompt, temperature: config.temperature, webSearch: webSearchEnabled }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `请求失败 (${response.status})`);
      }
      const searchedWeb = response.headers.get('X-Web-Search') === '1';
      const searchReason = response.headers.get('X-Web-Search-Reason') || '';
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === assistantMessage.id ? { ...message, searchedWeb, searchReason } : message),
      }));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let searchReferences = [];
      const handleChunk = (chunk) => {
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.pythonSandbox) {
          updateConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => message.id === assistantMessage.id ? { ...message, pythonSandbox: chunk.pythonSandbox } : message) }));
        }
        if (chunk.workspaceResult) {
          updateConversation(conversationId, (conversation) => ({ ...conversation, messages: conversation.messages.map((message) => message.id === assistantMessage.id ? { ...message, workspaceResult: chunk.workspaceResult } : message) }));
        }
        if (Array.isArray(chunk.searchReferences)) {
          searchReferences = chunk.searchReferences;
          updateConversation(conversationId, (conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) => message.id === assistantMessage.id ? { ...message, searchReferences, searchError: chunk.searchError || '' } : message),
          }));
        }
        const token = chunk.message?.content || '';
        const thinkingToken = chunk.message?.thinking || '';
        if (thinkingToken) {
          thinkingText += thinkingToken;
          setGenerationPhase('thinking');
          updateConversation(conversationId, (conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) => message.id === assistantMessage.id ? { ...message, thinking: thinkingText } : message),
          }));
        }
        if (token) {
          assistantText += token;
          const visibleAssistantText = sanitizeAssistantContent(assistantText, { preserveEmojiMarkers: true });
          setGenerationPhase('writing');
          updateConversation(conversationId, (conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) => message.id === assistantMessage.id ? { ...message, content: visibleAssistantText } : message),
          }));
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          handleChunk(JSON.parse(line));
        }
        if (done) break;
      }
      if (buffer.trim()) handleChunk(JSON.parse(buffer));
      if (!assistantText.trim()) throw new Error(thinkingText ? '模型完成了思考，但没有返回最终回答。请重试或更换模型。' : 'Ollama 已结束连接，但没有返回任何内容。');
      const assistantEmoji = findSelectedAssistantEmoji(assistantText, emojis);
      const calendarProposals = extractCalendarProposals(assistantText);
      const cleanAssistantText = sanitizeAssistantContent(assistantText);
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === assistantMessage.id ? { ...message, content: cleanAssistantText, emojiId: assistantEmoji?.id || null, emojiDescription: assistantEmoji?.description || null, calendarProposals, calendarProposalStatuses: calendarProposals.map(() => 'pending') } : message),
      }));
      if (autoSpeak && cleanAssistantText) playVoice(assistantMessage.id, cleanAssistantText);
      setTimeout(() => {
        fetch('/api/memories').then((response) => response.json()).then((data) => setMemories(data.memories || [])).catch(() => {});
        fetch('/api/notebook').then((response) => response.json()).then((data) => setNotebookNotes(data.notes || [])).catch(() => {});
      }, 1500);
    } catch (error) {
      const errorText = error.name === 'AbortError' ? '已停止生成' : `生成失败：${error.message}`;
      const safePartialText = sanitizeAssistantContent(assistantText);
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === assistantMessage.id ? { ...message, content: safePartialText ? `${safePartialText}\n\n（${errorText}，以上为未完成的回复）` : `（${errorText}）`, interrupted: true } : message),
      }));
    } finally {
      setGenerating(false);
      setGenerationPhase('idle');
      abortRef.current = null;
    }
  }

  function openWorkspace(section = 'dashboard', conversationId) {
    if (conversationId) setActiveId(conversationId);
    if (section === 'companion') {
      setView('chat');
      setMode('companion');
      return;
    }
    setWorkspaceSection(section);
    setMode('workspace');
  }

  return (
    <div className="app-shell" data-theme={theme === 'moonlight' ? 'moonlight' : 'night'}>
      <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <div className="brand-row">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <strong>{mode === 'workspace' ? 'Starry Night' : config.appName}</strong>
          <button className="icon-button desktop-only" onClick={() => setSidebarOpen(false)} aria-label="收起侧栏"><PanelLeftClose size={18} /></button>
        </div>
        {mode === 'workspace' ? <>
          <nav className="workspace-nav" aria-label="工作台导航">
            <button className={workspaceSection === 'dashboard' ? 'active' : ''} onClick={() => openWorkspace('dashboard')}><LayoutDashboard size={18} />概览</button>
            <button className={workspaceSection === 'calendar' ? 'active' : ''} onClick={() => openWorkspace('calendar')}><CalendarDays size={18} />日历与提醒</button>
            <button className={workspaceSection === 'tasks' ? 'active' : ''} onClick={() => openWorkspace('tasks')}><ListTodo size={18} />任务工作台</button>
            <button className={workspaceSection === 'memory' ? 'active' : ''} onClick={() => openWorkspace('memory')}><Brain size={18} />长期记忆</button>
            <button className={workspaceSection === 'notes' ? 'active' : ''} onClick={() => openWorkspace('notes')}><NotebookPen size={18} />成长档案</button>
            <button className={workspaceSection === 'vision' ? 'active' : ''} onClick={() => openWorkspace('vision')}><Images size={18} />图像与表情</button>
            <button className={workspaceSection === 'tools' ? 'active' : ''} onClick={() => openWorkspace('tools')}><Bug size={18} />工具与诊断</button>
          </nav>
          <button className="workspace-return" onClick={() => openWorkspace('companion')}><Sparkles size={17} />返回陪伴模式</button>
        </> : <>
          <button className="new-chat" onClick={() => createChat()}><MessageSquarePlus size={18} /> 新对话</button>
          {projects.length > 0 && <><div className="history-label">项目</div><div className="project-list">{projects.map((project) => <section key={project.id} className="sidebar-project"><header><button onClick={() => openProject(project.id)}><FolderOpen size={15} /><strong>{project.title}</strong></button><button className="project-new-chat" onClick={() => createChat(project.id)} aria-label={`在 ${project.title} 中新建对话`}><Plus size={14} /></button></header>{conversations.filter((conversation) => conversation.projectId === project.id).map((conversation) => <button key={conversation.id} className={`project-chat ${conversation.id === activeId ? 'active' : ''}`} onClick={() => { stopVoice(); setActiveId(conversation.id); }}><span>{conversation.title}</span><Trash2 size={13} onClick={(event) => removeChat(event, conversation.id)} /></button>)}</section>)}</div></>}
          <div className="history-label">最近对话</div>
          <div className="history-list">
            {conversations.filter((conversation) => !conversation.projectId).map((conversation) => (
              <button key={conversation.id} className={`history-item ${conversation.id === activeId ? 'active' : ''}`} onClick={() => { stopVoice(); setActiveId(conversation.id); }}>
                <span>{conversation.title}</span>
                <Trash2 className="delete-chat" size={15} onClick={(event) => removeChat(event, conversation.id)} />
              </button>
            ))}
          </div>
        </>}
        <div className="sidebar-status">
          <span className={`status-dot ${status.ok ? 'online' : ''}`} />
          <div><strong>{status.ok ? 'Ollama 已连接' : 'Ollama 未连接'}</strong><small>{status.message}</small></div>
        </div>
        {mode === 'companion' && <div className="sidebar-tools">
          <button className={`admin-link ${view === 'vision' ? 'active' : ''}`} onClick={() => setView(view === 'vision' ? 'chat' : 'vision')}><Images size={17} /><span>{view === 'vision' ? '返回聊天' : '图像与表情'}</span></button>
          <button className={`admin-link ${view === 'tasks' ? 'active' : ''}`} onClick={() => setView(view === 'tasks' ? 'chat' : 'tasks')}><ListTodo size={17} /><span>{view === 'tasks' ? '返回聊天' : '任务工作台'}</span></button>
          <button className={`admin-link ${view === 'debug' ? 'active' : ''}`} onClick={() => setView(view === 'debug' ? 'chat' : 'debug')}><Bug size={17} /><span>{view === 'debug' ? '返回聊天' : '后台调试'}</span></button>
        </div>}
      </aside>

      <main className="main-panel">
        <header className="topbar">
          {!sidebarOpen && <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="打开侧栏"><Menu size={20} /></button>}
          {mode === 'companion' && view === 'chat' && <div className="topbar-companion"><CompanionAvatar compact state={speaking ? 'speaking' : generating ? 'thinking' : 'idle'} name={config.companion?.name} /><span>{config.companion?.name}</span></div>}
          {mode === 'workspace' && <div className="workspace-topbar-title"><LayoutDashboard size={18} /><span>{workspaceSection === 'dashboard' ? '工作台概览' : workspaceSection === 'calendar' ? '日历与提醒' : workspaceSection === 'tasks' ? '任务工作台' : workspaceSection === 'memory' ? '长期记忆' : workspaceSection === 'notes' ? '成长档案' : workspaceSection === 'vision' ? '图像与表情' : '工具与诊断'}</span></div>}
          <div className="model-picker">
            <select value={model} onChange={(event) => setModel(event.target.value)} disabled={!models.length} aria-label="选择模型">
              {!models.length && <option value="">没有可用模型</option>}
              {models.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
            <ChevronDown size={15} />
          </div>
          {mode === 'companion' && view === 'chat' && <button className={`icon-button ${autoSpeak ? 'voice-on' : ''}`} onClick={toggleAutoSpeak} aria-label={autoSpeak ? '关闭自动播报' : '开启自动播报'} title={autoSpeak ? '自动播报已开启' : '自动播报已关闭'}>{autoSpeak ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>}
          {mode === 'companion' && view === 'chat' && <button className={`icon-button ${webSearchEnabled ? 'search-on' : ''}`} onClick={() => setWebSearchEnabled((value) => !value)} disabled={!config.webSearch?.enabled} aria-label={webSearchEnabled ? '关闭智能联网' : '开启智能联网'} title={config.webSearch?.enabled ? (webSearchEnabled ? '智能联网已开启：需要核验的问题会自动搜索并附参考资料' : '智能联网已关闭') : '网络搜索已在配置中关闭'}><Globe2 size={19} /></button>}
          <button className="mode-switch" onClick={() => mode === 'companion' ? openWorkspace('dashboard') : openWorkspace('companion')}><LayoutDashboard size={17} />{mode === 'companion' ? '工作台' : '陪伴'}</button>
          <button className="icon-button" onClick={() => setSettingsOpen((value) => !value)} aria-label="设置"><Settings2 size={19} /></button>
        </header>

        {settingsOpen && (
          <div className="settings-window-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-card" role="dialog" aria-modal="true" aria-label="运行配置设置" onMouseDown={(event) => event.stopPropagation()}>
            <header className="settings-window-title"><div><strong>运行配置设置</strong><span>本地运行、陪伴方式与数据管理</span></div><div className="settings-title-actions"><button type="button" className="theme-toggle" onClick={() => setTheme((value) => value === 'night' ? 'moonlight' : 'night')}>{theme === 'night' ? '月光白' : '星夜蓝'}</button><button type="button" className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="关闭运行配置设置"><X size={18} /></button></div></header>
            <label>系统提示词<textarea value={config.systemPrompt} onChange={(event) => setConfig((value) => ({ ...value, systemPrompt: event.target.value }))} /></label>
            <label>温度：{config.temperature}<input type="range" min="0" max="2" step="0.1" value={config.temperature} onChange={(event) => setConfig((value) => ({ ...value, temperature: Number(event.target.value) }))} /></label>
            <label>朗读声源<select value={voiceProvider} onChange={(event) => { stopVoice(); setVoiceError(''); setVoiceProvider(event.target.value); }}><option value="browser">浏览器语音</option><option value="sovits">本地 GPT-SoVITS</option></select></label>
            <label className="auto-speak-setting"><input type="checkbox" checked={autoSpeak} onChange={toggleAutoSpeak} />自动播报新回复</label>
            <label className="auto-speak-setting"><input type="checkbox" checked={webSearchEnabled} onChange={() => setWebSearchEnabled((value) => !value)} disabled={!config.webSearch?.enabled} />智能联网搜索</label>
            <div className="proactive-setting"><div><BellRing size={17} /><span><strong>主动陪伴</strong><small>仅在这个网页打开时运行；每轮对话最多主动联系一次。</small></span></div><label className="auto-speak-setting"><input type="checkbox" checked={proactive.enabled} onChange={(event) => updateProactive({ enabled: event.target.checked })} />允许星空在你一段时间没说话后主动发消息</label><label>空闲多久后联系<input type="number" min="15" max="1440" value={proactive.idleMinutes} disabled={!proactive.enabled} onChange={(event) => updateProactive({ idleMinutes: Number(event.target.value) })} /> 分钟</label>{proactiveStatus && <small>{proactiveStatus}</small>}</div>
            <span>默认关闭。开启后，星空会自动搜索需要核验的内容；你说“查一下”“继续查”时，她会结合前文直接提取主题，不再反问搜索方向。搜索后会附可展开的参考资料。时间读取本机 {config.webSearch?.timeZone || '当前'} 时区。</span>
            <span>自动播报默认关闭。你可以点击每条回复下面的“听语音”；同一时间只播放一条，发送新消息会停止当前语音。</span>
            {voiceError && <span role="alert">{voiceError}</span>}
            {historyError && <span role="alert">{historyError}</span>}
            <details className="notebook-summary"><summary><Brain size={17} /><span><strong>长期记忆</strong><small>{memories.length} 条 · 可编辑、固定或删除</small></span></summary><div className="notebook-entries">{memories.length ? memories.map((memory) => <div key={memory.id}><span><b>{memory.pinned ? '固定' : '记忆'}</b>{memory.text}</span><aside><button type="button" onClick={() => toggleMemoryPin(memory)} aria-label="固定记忆"><Pin size={13} /></button><button type="button" onClick={() => updateMemoryEntry(memory)} aria-label="编辑记忆"><Pencil size={13} /></button><button type="button" onClick={() => removeMemoryEntry(memory.id)} aria-label="删除记忆"><Trash2 size={13} /></button></aside></div>) : <p>还没有保存的长期记忆。</p>}</div></details>
            <div className="memory-summary"><MessageSquarePlus size={17} /><div><strong>聊天记录</strong><span>{historyError ? '等待写入本地数据库' : '已保存到 data/chat.sqlite，可随文件夹移动'}</span></div></div>
            <details className="notebook-summary"><summary><Brain size={17} /><span><strong>星空的成长档案</strong><small>{notebookNotes.length} 条 · 她自主记录的共同约定与长期事项</small></span></summary><div className="notebook-entries">{notebookNotes.length ? notebookNotes.map((note) => <div key={note.id}><span><b>{note.pinned ? '固定' : note.category}</b>{note.text}</span><aside><button type="button" onClick={() => toggleNotebookPin(note)} aria-label="固定笔记"><Pin size={13} /></button><button type="button" onClick={() => updateNotebookEntry(note)} aria-label="编辑笔记"><Pencil size={13} /></button><button type="button" onClick={() => removeNotebookEntry(note.id)} aria-label="删除笔记"><Trash2 size={13} /></button></aside></div>) : <p>星空还没有写下成长档案。</p>}</div></details>
            <button className="secondary-button" onClick={refreshModels}>重新检测模型</button>
          </section></div>
        )}

        {mode === 'workspace' ? <>{workspaceSection === 'dashboard' ? <WorkspaceDashboard companionName={config.companion?.name} conversations={conversations} memories={memories} notes={notebookNotes} status={status} onNavigate={openWorkspace} /> : workspaceSection === 'calendar' ? <CalendarPage theme={theme} /> : workspaceSection === 'tasks' ? <TaskPanel conversationId={activeConversationId} model={model} config={config} webSearchEnabled={webSearchEnabled} /> : workspaceSection === 'memory' ? <WorkspaceRecords kind="memory" items={memories} onPin={toggleMemoryPin} onEdit={updateMemoryEntry} onRemove={removeMemoryEntry} /> : workspaceSection === 'notes' ? <WorkspaceRecords kind="notes" items={notebookNotes} onPin={toggleNotebookPin} onEdit={updateNotebookEntry} onRemove={removeNotebookEntry} /> : workspaceSection === 'vision' ? <VisionPanel config={config} /> : <DebugPanel models={models} />}</> : view === 'debug' ? <DebugPanel models={models} /> : view === 'vision' ? <VisionPanel config={config} /> : view === 'tasks' ? <TaskPanel conversationId={activeConversationId} model={model} config={config} webSearchEnabled={webSearchEnabled} /> : <><section className="conversation">
          {!active?.messages.length ? (
            <div className="welcome">
              <CompanionAvatar state={speaking ? 'speaking' : generating ? 'thinking' : 'idle'} name={config.companion?.name} />
              <p className="eyebrow">LOCAL · PRIVATE · YOURS</p>
              <h1>今天想和{config.companion?.name}聊些什么？</h1>
              <p>她会在本地陪你长期交谈，并记住对未来有帮助的偏好与计划。</p>
              {!status.ok && <button className="connection-card" onClick={refreshModels}><span>检查 Ollama 连接</span><small>{status.message}</small></button>}
            </div>
          ) : (
            <div className="message-list">
              {active.messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="avatar">{message.role === 'user' ? <UserRound size={17} /> : <Bot size={18} />}</div>
                  <div className="message-content">
                    <div className="message-author">{message.role === 'user' ? '你' : message.model || model}{message.searchedWeb && <span className="searched-badge"><Globe2 size={11} />已联网</span>}{message.workspaceResult && <span className="searched-badge"><FolderOpen size={11} />{message.workspaceResult.error ? '文件操作失败' : `已处理 ${message.workspaceResult.applied || 0} 项文件`}</span>}</div>
                    {message.role === 'assistant' ? <>{message.thinking && <details className="thinking-block"><summary>思考过程</summary><p>{message.thinking}</p></details>}<ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || (message.emojiId ? '' : '正在等待模型返回…')}</ReactMarkdown>{message.calendarProposal && message.calendarProposalStatus !== 'dismissed' && <section className={`calendar-proposal ${message.calendarProposalStatus || 'pending'}`}><header><CalendarDays size={17} /><div><strong>{message.calendarProposal.title}</strong><span>{message.calendarProposalStatus === 'created' ? '已写入星空日历' : '等待你确认'}</span></div></header><p>{new Date(message.calendarProposal.startAt).toLocaleString('zh-CN', { timeZone: message.calendarProposal.timezone })} — {new Date(message.calendarProposal.endAt).toLocaleString('zh-CN', { timeZone: message.calendarProposal.timezone })}</p>{message.calendarProposal.description && <small>{message.calendarProposal.description}</small>}<small>{message.calendarProposal.remindBeforeMinutes === null ? '不提醒' : message.calendarProposal.remindBeforeMinutes === 0 ? '开始时提醒' : `提前 ${message.calendarProposal.remindBeforeMinutes} 分钟提醒`} · {message.calendarProposal.timezone}</small>{message.calendarProposalError && <em>{message.calendarProposalError}</em>}{message.calendarProposalStatus !== 'created' && <footer><button type="button" onClick={() => dismissCalendarProposal(active.id, message.id)} disabled={message.calendarProposalStatus === 'saving'}>暂不创建</button><button type="button" className="confirm" onClick={() => confirmCalendarProposal(active.id, message.id, message.calendarProposal)} disabled={message.calendarProposalStatus === 'saving'}>{message.calendarProposalStatus === 'saving' ? '正在创建…' : message.calendarProposalStatus === 'error' ? '重试创建' : '确认创建'}</button></footer>}</section>}{message.emojiId && <img className="assistant-emoji" src={`/api/emojis/${message.emojiId}/image`} alt={message.emojiDescription || '星空发送的表情'} />}{message.pythonSandbox && <details className="sandbox-result"><summary>Python 隔离运行 {message.pythonSandbox.ran && message.pythonSandbox.exitCode === 0 ? '完成' : '未执行或失败'}</summary><p>{message.pythonSandbox.ran ? '已在 Windows 原生 AppContainer + Job Object 沙盒中执行。' : '未在宿主机执行。'}</p>{message.pythonSandbox.audit?.errors?.length ? <pre>{message.pythonSandbox.audit.errors.join('\n')}</pre> : null}{message.pythonSandbox.error ? <pre>{message.pythonSandbox.error}</pre> : null}{message.pythonSandbox.stdout ? <pre>{message.pythonSandbox.stdout}</pre> : null}{message.pythonSandbox.stderr ? <pre>{message.pythonSandbox.stderr}</pre> : null}</details>}{message.searchedWeb && <details className="search-references"><summary className="search-references-title"><Globe2 size={14} />参考资料（{message.searchReferences?.length || 0}）</summary><div className="search-reference-list">{message.searchReferences?.length ? message.searchReferences.map((reference) => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer"><strong>{reference.title}</strong><span>{reference.snippet}</span></a>) : <span className="search-reference-empty">{message.searchError ? `搜索未成功：${message.searchError}` : '本次搜索没有返回可引用的公开资料。'}</span>}</div></details>}{message.content && !message.interrupted && <div className="message-actions"><button type="button" className={speakingMessageId === message.id ? 'playing' : ''} onClick={() => playVoice(message.id, message.content)}><Volume2 size={14} />{voiceLoadingId === message.id ? '正在生成语音…' : speakingMessageId === message.id ? '停止播放' : '听语音'}</button></div>}</> : <>{message.emojiId && <img className="sent-emoji" src={`/api/emojis/${message.emojiId}/image`} alt={message.emojiDescription || '表情'} />}{message.imageId && <img className="sent-image" src={`/api/images/${message.imageId}`} alt={message.imageName || '聊天图片'} />}{!message.emojiId && <p>{message.content}</p>}</>}
                    {message.role === 'assistant' && message.calendarProposals?.length > 0 && <CalendarProposalGroup message={message} onConfirm={(index, proposal) => confirmCalendarProposalAt(active.id, message.id, index, proposal)} onConfirmAll={(actionable) => confirmAllCalendarProposals(active.id, message.id, actionable)} onDismiss={(index) => dismissCalendarProposalAt(active.id, message.id, index)} />}
                  </div>
                </article>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </section>

        <div className="composer-wrap">
          {emojiPickerOpen && <div className="emoji-picker">
            <div className="emoji-picker-header"><strong>表情包</strong><span>{emojis.length} 张</span><button onClick={() => setEmojiPickerOpen(false)}><X size={16} /></button></div>
            <div className="emoji-search"><Search size={15} /><input value={emojiSearch} onChange={(event) => setEmojiSearch(event.target.value)} placeholder="搜索文件名或描述" /></div>
            <div className="emoji-grid">{emojis.filter((emoji) => !emojiSearch || `${emoji.fileName} ${emoji.description}`.toLowerCase().includes(emojiSearch.toLowerCase())).map((emoji) => <button type="button" key={emoji.id} onClick={() => { setSelectedImage(null); setSelectedEmoji(emoji); setEmojiPickerOpen(false); }} title={`#${emoji.id} ${emoji.description}`}><img loading="lazy" src={`/api/emojis/${emoji.id}/image`} alt={emoji.description} /><span>#{emoji.id}</span></button>)}</div>
          </div>}
          {selectedEmoji && <div className="selected-emoji"><img src={`/api/emojis/${selectedEmoji.id}/image`} alt={selectedEmoji.description} /><span>#{selectedEmoji.id} · {selectedEmoji.description}</span><button type="button" className="emoji-send" onClick={submit} disabled={!model || generating}>{model ? '发送表情' : '请先启动 Ollama'}</button><button type="button" className="emoji-remove" onClick={() => setSelectedEmoji(null)} aria-label="取消表情"><X size={14} /></button></div>}
          {selectedImage && <div className="selected-image"><img src={selectedImage.url} alt="待发送图片" /><div><strong>{selectedImage.name}</strong><span>将使用 {visionModels.some((item) => item.name === model) ? model : config.vision?.preferredModel || visionModels[0]?.name} 看图</span></div><button type="button" onClick={() => setSelectedImage(null)} aria-label="移除图片"><X size={15} /></button></div>}
          {imageError && <small role="alert" className="voice-error">{imageError}</small>}
          {voiceError && <small role="alert" className="voice-error">{voiceError}</small>}
          <form className="composer" onSubmit={submit}>
            <button type="button" className={`composer-tool ${emojiPickerOpen ? 'active' : ''}`} onClick={() => setEmojiPickerOpen((value) => !value)} aria-label="选择表情"><SmilePlus size={20} /></button>
            <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={selectImage} />
            <button type="button" className={`composer-tool ${selectedImage ? 'active' : ''}`} onClick={() => imageInputRef.current?.click()} disabled={imageUploading || generating} aria-label="上传图片" title="让本地模型看图"><ImagePlus size={20} /></button>
            <textarea ref={composerInputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
            }} placeholder={model ? `向 ${model} 发送消息…` : '请先启动 Ollama 并安装模型'} disabled={!model || generating} rows="1" />
            {generating ? (
              <button type="button" className="send-button stop generation-stop" onClick={() => abortRef.current?.abort()} aria-label={generationPhase === 'thinking' ? '停止思考' : generationPhase === 'writing' ? '停止写作' : '停止生成'}><CircleStop size={18} /><span>{generationPhase === 'thinking' ? '停止思考' : generationPhase === 'writing' ? '停止写作' : '停止生成'}</span></button>
            ) : (
              <button type="submit" className="send-button" disabled={(!input.trim() && !selectedEmoji && !selectedImage) || !model || imageUploading} aria-label="发送"><Send size={19} /></button>
            )}
          </form>
          <small>Enter 发送 · Shift + Enter 换行 · 对话保存在项目文件夹{webSearchEnabled ? ' · 智能联网已开启' : ''}</small>
        </div></>}
      </main>
    </div>
  );
}
