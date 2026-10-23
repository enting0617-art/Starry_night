import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(fileName) {
  try {
    return JSON.parse(await readFile(join(projectRoot, fileName), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`${fileName} 无法读取: ${error.message}`, { cause: error });
  }
}

function merge(base, override) {
  return {
    ...base,
    ...override,
    server: { ...base.server, ...override.server },
    debug: { ...base.debug, ...override.debug },
    chat: { ...base.chat, ...override.chat },
    companion: { ...base.companion, ...override.companion },
    voice: { ...base.voice, ...override.voice },
    vision: { ...base.vision, ...override.vision },
    history: { ...base.history, ...override.history },
    emoji: { ...base.emoji, ...override.emoji },
    webSearch: { ...base.webSearch, ...override.webSearch },
    search: { ...base.search, ...override.search },
    notebook: { ...base.notebook, ...override.notebook },
  };
}

export async function loadConfig() {
  const base = await readJson('config.json');
  const local = await readJson('config.local.json');
  const config = merge(base, local);
  let personaFromFile = '';
  if (config.companion?.personaFile) {
    const personaPath = join(projectRoot, String(config.companion.personaFile));
    try { personaFromFile = await readFile(personaPath, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`人设提示词无法读取: ${error.message}`, { cause: error });
    }
  }

  const resolved = {
    appName: process.env.APP_NAME || config.appName || 'Local AI',
    ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    defaultModel: process.env.OLLAMA_MODEL ?? config.defaultModel ?? '',
    systemPrompt: process.env.SYSTEM_PROMPT ?? config.systemPrompt ?? '',
    temperature: Number(process.env.TEMPERATURE ?? config.temperature ?? 0.7),
    chat: {
      think: config.chat?.think === true,
      maxOutputTokens: Number(process.env.CHAT_MAX_OUTPUT_TOKENS ?? config.chat?.maxOutputTokens ?? 1024),
      maxThinkingCharacters: Number(config.chat?.maxThinkingCharacters ?? 6000),
      generationTimeoutMs: Number(config.chat?.generationTimeoutMs ?? 0),
    },
    companion: {
      name: process.env.COMPANION_NAME || config.companion?.name || '星空',
      persona: process.env.COMPANION_PERSONA || personaFromFile.trim() || config.companion?.persona || '',
      autoSpeak: config.companion?.autoSpeak === true,
      memoryEnabled: config.companion?.memoryEnabled !== false,
      maxMemories: Number(config.companion?.maxMemories || 200),
      retrievalCount: Number(config.companion?.retrievalCount || 6),
      embeddingModel: process.env.EMBEDDING_MODEL ?? config.companion?.embeddingModel ?? '',
    },
    voice: {
      provider: config.voice?.provider || 'browser',
      baseUrl: (process.env.SOVITS_BASE_URL || config.voice?.baseUrl || 'http://127.0.0.1:9880').replace(/\/$/, ''),
      refAudioPath: config.voice?.refAudioPath || '',
      promptText: config.voice?.promptText || '',
      promptLang: config.voice?.promptLang || 'zh',
      textLang: config.voice?.textLang || 'zh',
      maxTextCharacters: Number(config.voice?.maxTextCharacters || 800),
      cacheMaxFiles: Number(config.voice?.cacheMaxFiles || 40),
      cacheMaxBytes: Number(config.voice?.cacheMaxBytes || 134217728),
    },
    vision: {
      preferredModel: process.env.VISION_MODEL ?? config.vision?.preferredModel ?? '',
      maxImageBytes: Number(config.vision?.maxImageBytes || 8388608),
      maxStoredImages: Number(config.vision?.maxStoredImages || 60),
      maxStoredBytes: Number(config.vision?.maxStoredBytes || 268435456),
      batchMaxItems: Number(config.vision?.batchMaxItems || 500),
      descriptionPrompt: config.vision?.descriptionPrompt || '请用简短中文描述这张表情包。只写人物、动作、表情或文字含义，5到30个字，不要加前缀、引号或解释。',
    },
    history: {
      maxConversations: Number(config.history?.maxConversations || 100),
      maxMessagesPerConversation: Number(config.history?.maxMessagesPerConversation || 500),
      maxPayloadBytes: Number(config.history?.maxPayloadBytes || 8388608),
    },
    emoji: {
      assistantEnabled: config.emoji?.assistantEnabled !== false,
      assistantAlwaysSend: config.emoji?.assistantAlwaysSend !== false,
      assistantCandidateCount: Number(config.emoji?.assistantCandidateCount || 24),
    },
    webSearch: {
      enabled: config.webSearch?.enabled !== false,
      provider: config.webSearch?.provider || 'duckduckgo',
      endpoint: config.webSearch?.endpoint || 'https://html.duckduckgo.com/html/',
      maxResults: Number(config.webSearch?.maxResults || 5),
      timeoutMs: Number(config.webSearch?.timeoutMs || 12000),
      timeZone: config.webSearch?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
    search: {
      cacheSearchTtlMs: Number(config.search?.cacheSearchTtlMs || 600000),
      cacheWikiTtlMs: Number(config.search?.cacheWikiTtlMs || 21600000),
      cachePageTtlMs: Number(config.search?.cachePageTtlMs || 1800000),
    },
    notebook: {
      enabled: config.notebook?.enabled !== false,
      maxNotes: Number(config.notebook?.maxNotes || 300),
      retrievalCount: Number(config.notebook?.retrievalCount || 8),
      maxContextNotes: Number(config.notebook?.maxContextNotes || 30),
    },
    debug: {
      requestTimeoutMs: Number(process.env.DEBUG_TIMEOUT_MS || config.debug?.requestTimeoutMs || 120000),
      firstTokenTimeoutMs: Number(process.env.FIRST_TOKEN_TIMEOUT_MS || config.debug?.firstTokenTimeoutMs || 60000),
      maxLogEntries: Number(process.env.DEBUG_MAX_LOGS || config.debug?.maxLogEntries || 100),
    },
    server: {
      host: process.env.HOST || config.server?.host || '127.0.0.1',
      port: Number(process.env.PORT || config.server?.port || 4173),
    },
  };
  const errors = validateConfig(resolved);
  if (errors.length) throw new Error(`配置无效: ${errors.join('；')}`);
  return resolved;
}

export function validateConfig(config) {
  const errors = [];
  if (!String(config.appName || '').trim()) errors.push('appName 不能为空');
  try {
    const url = new URL(config.ollamaBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) errors.push('ollamaBaseUrl 仅支持 http 或 https');
    if (url.username || url.password) errors.push('ollamaBaseUrl 不应包含账号或密码');
  } catch {
    errors.push('ollamaBaseUrl 不是有效 URL');
  }
  if (!Number.isInteger(config.server.port) || config.server.port < 1 || config.server.port > 65535) errors.push('server.port 必须是 1-65535 的整数');
  if (!String(config.server.host || '').trim()) errors.push('server.host 不能为空');
  if (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2) errors.push('temperature 必须在 0-2 之间');
  if (!Number.isInteger(config.chat.maxOutputTokens) || (config.chat.maxOutputTokens !== -1 && (config.chat.maxOutputTokens < 64 || config.chat.maxOutputTokens > 131072))) errors.push('chat.maxOutputTokens 必须是 -1（无限）或 64-131072 的整数');
  if (!Number.isInteger(config.chat.maxThinkingCharacters) || config.chat.maxThinkingCharacters < 0 || config.chat.maxThinkingCharacters > 10000000) errors.push('chat.maxThinkingCharacters 必须是 0（无限）到 10000000 的整数');
  if (!Number.isInteger(config.chat.generationTimeoutMs) || config.chat.generationTimeoutMs < 0 || config.chat.generationTimeoutMs > 86400000) errors.push('chat.generationTimeoutMs 必须是 0（无限）到 86400000 的整数');
  if (!Number.isInteger(config.debug.requestTimeoutMs) || config.debug.requestTimeoutMs < 1000 || config.debug.requestTimeoutMs > 600000) errors.push('debug.requestTimeoutMs 必须是 1000-600000 的整数');
  if (!Number.isInteger(config.debug.firstTokenTimeoutMs) || config.debug.firstTokenTimeoutMs < 1000 || config.debug.firstTokenTimeoutMs > config.debug.requestTimeoutMs) errors.push('debug.firstTokenTimeoutMs 必须是 1000 到 requestTimeoutMs 之间的整数');
  if (!Number.isInteger(config.debug.maxLogEntries) || config.debug.maxLogEntries < 1 || config.debug.maxLogEntries > 1000) errors.push('debug.maxLogEntries 必须是 1-1000 的整数');
  if (!String(config.companion.name || '').trim()) errors.push('companion.name 不能为空');
  if (!['browser', 'sovits'].includes(config.voice.provider)) errors.push('voice.provider 必须是 browser 或 sovits');
  try {
    const voiceUrl = new URL(config.voice.baseUrl);
    if (voiceUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(voiceUrl.hostname)) errors.push('voice.baseUrl 仅支持本机 HTTP 地址');
  } catch { errors.push('voice.baseUrl 不是有效 URL'); }
  if (!Number.isInteger(config.voice.maxTextCharacters) || config.voice.maxTextCharacters < 50 || config.voice.maxTextCharacters > 3000) errors.push('voice.maxTextCharacters 必须是 50-3000 的整数');
  if (!Number.isInteger(config.voice.cacheMaxFiles) || config.voice.cacheMaxFiles < 1 || config.voice.cacheMaxFiles > 500) errors.push('voice.cacheMaxFiles 必须是 1-500 的整数');
  if (!Number.isInteger(config.voice.cacheMaxBytes) || config.voice.cacheMaxBytes < 1048576 || config.voice.cacheMaxBytes > 1073741824) errors.push('voice.cacheMaxBytes 必须是 1MB-1GB 的整数');
  if (!Number.isInteger(config.vision.maxImageBytes) || config.vision.maxImageBytes < 262144 || config.vision.maxImageBytes > 33554432) errors.push('vision.maxImageBytes 必须是 256KB-32MB 的整数');
  if (!Number.isInteger(config.vision.maxStoredImages) || config.vision.maxStoredImages < 5 || config.vision.maxStoredImages > 500) errors.push('vision.maxStoredImages 必须是 5-500 的整数');
  if (!Number.isInteger(config.vision.maxStoredBytes) || config.vision.maxStoredBytes < 10485760 || config.vision.maxStoredBytes > 2147483648) errors.push('vision.maxStoredBytes 必须是 10MB-2GB 的整数');
  if (!Number.isInteger(config.vision.batchMaxItems) || config.vision.batchMaxItems < 1 || config.vision.batchMaxItems > 5000) errors.push('vision.batchMaxItems 必须是 1-5000 的整数');
  if (!Number.isInteger(config.history.maxConversations) || config.history.maxConversations < 1 || config.history.maxConversations > 1000) errors.push('history.maxConversations 必须是 1-1000 的整数');
  if (!Number.isInteger(config.history.maxMessagesPerConversation) || config.history.maxMessagesPerConversation < 10 || config.history.maxMessagesPerConversation > 5000) errors.push('history.maxMessagesPerConversation 必须是 10-5000 的整数');
  if (!Number.isInteger(config.history.maxPayloadBytes) || config.history.maxPayloadBytes < 1048576 || config.history.maxPayloadBytes > 67108864) errors.push('history.maxPayloadBytes 必须是 1MB-64MB 的整数');
  if (!Number.isInteger(config.emoji.assistantCandidateCount) || config.emoji.assistantCandidateCount < 4 || config.emoji.assistantCandidateCount > 80) errors.push('emoji.assistantCandidateCount 必须是 4-80 的整数');
  if (!['duckduckgo', 'searxng'].includes(config.webSearch.provider)) errors.push('webSearch.provider 仅支持 duckduckgo 或 searxng');
  try {
    const searchUrl = new URL(config.webSearch.endpoint);
    if (!['https:', 'http:'].includes(searchUrl.protocol)) errors.push('webSearch.endpoint 必须使用 HTTP 或 HTTPS');
    if (searchUrl.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(searchUrl.hostname)) errors.push('HTTP 搜索地址仅允许本机地址');
  } catch { errors.push('webSearch.endpoint 不是有效 URL'); }
  if (!Number.isInteger(config.webSearch.maxResults) || config.webSearch.maxResults < 1 || config.webSearch.maxResults > 10) errors.push('webSearch.maxResults 必须是 1-10 的整数');
  if (!Number.isInteger(config.webSearch.timeoutMs) || config.webSearch.timeoutMs < 2000 || config.webSearch.timeoutMs > 60000) errors.push('webSearch.timeoutMs 必须是 2000-60000 的整数');
  for (const [name, value] of Object.entries(config.search)) if (!Number.isInteger(value) || value < 10000 || value > 604800000) errors.push(`search.${name} 必须是 10000-604800000 的整数`);
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: config.webSearch.timeZone }).format(new Date()); } catch { errors.push('webSearch.timeZone 不是有效时区'); }
  if (!Number.isInteger(config.notebook.maxNotes) || config.notebook.maxNotes < 10 || config.notebook.maxNotes > 5000) errors.push('notebook.maxNotes 必须是 10-5000 的整数');
  if (!Number.isInteger(config.notebook.retrievalCount) || config.notebook.retrievalCount < 1 || config.notebook.retrievalCount > 50) errors.push('notebook.retrievalCount 必须是 1-50 的整数');
  if (!Number.isInteger(config.notebook.maxContextNotes) || config.notebook.maxContextNotes < 1 || config.notebook.maxContextNotes > 100) errors.push('notebook.maxContextNotes 必须是 1-100 的整数');
  if (!Number.isInteger(config.companion.maxMemories) || config.companion.maxMemories < 10 || config.companion.maxMemories > 5000) errors.push('companion.maxMemories 必须是 10-5000 的整数');
  if (!Number.isInteger(config.companion.retrievalCount) || config.companion.retrievalCount < 1 || config.companion.retrievalCount > 20) errors.push('companion.retrievalCount 必须是 1-20 的整数');
  return errors;
}

export { projectRoot };
