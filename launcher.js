import { spawn } from 'node:child_process';
import { loadConfig } from './server/config.js';
import { RUNTIME_VERSION } from './server/version.js';

const config = await loadConfig();
const browserHost = ['0.0.0.0', '::'].includes(config.server.host) ? '127.0.0.1' : config.server.host;
let selectedPort = config.server.port;
let url = `http://${browserHost}:${selectedPort}`;

function openBrowser() {
  const platformCommands = {
    win32: ['cmd', ['/c', 'start', '', url]],
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]],
  };
  const command = platformCommands[process.platform];
  if (command) spawn(command[0], command[1], { detached: true, stdio: 'ignore' }).unref();
}

async function probeService(port) {
  try {
    const response = await fetch(`http://${browserHost}:${port}/api/config`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return { reachable: true, current: false };
    const data = await response.json();
    return { reachable: true, current: data.runtimeVersion === RUNTIME_VERSION };
  } catch {
    return { reachable: false, current: false };
  }
}

let availablePort = null;
for (let offset = 0; offset < 10; offset += 1) {
  const port = config.server.port + offset;
  const status = await probeService(port);
  if (status.current) {
    selectedPort = port;
    url = `http://${browserHost}:${selectedPort}`;
    console.log(`Local AI 已经在运行：${url}`);
    openBrowser();
    process.exit(0);
  }
  if (!status.reachable && availablePort === null) availablePort = port;
}

if (availablePort === null) {
  console.error('启动失败：连续10个端口都已被占用。请关闭旧的 Local AI 窗口后重试。');
  process.exit(1);
}

selectedPort = availablePort;
url = `http://${browserHost}:${selectedPort}`;
if (selectedPort !== config.server.port) console.log(`检测到旧服务，改用端口 ${selectedPort} 启动新版。`);
const server = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(selectedPort) },
});
setTimeout(openBrowser, 800);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}

server.on('exit', (code) => process.exit(code ?? 0));
server.on('error', (error) => {
  console.error(`无法启动本地服务：${error.message}`);
  process.exitCode = 1;
});
