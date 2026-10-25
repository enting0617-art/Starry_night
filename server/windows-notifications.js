import { spawn } from 'node:child_process';

function psLiteral(value, limit = 500) {
  return String(value || '').replace(/[\r\n]+/gu, ' ').trim().slice(0, limit)
    .replace(/'/gu, "''");
}

export function showWindowsNotification({ title, message }) {
  if (process.platform !== 'win32') return Promise.resolve({ shown: false, reason: 'unsupported-platform' });
  const safeTitle = psLiteral(title, 120) || '星空日历';
  const safeMessage = psLiteral(message, 500) || '日程时间到了。';
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $notification = New-Object System.Windows.Forms.NotifyIcon
    $notification.Icon = [System.Drawing.SystemIcons]::Information
    $notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notification.BalloonTipTitle = '${safeTitle}'
    $notification.BalloonTipText = '${safeMessage}'
    $notification.Visible = $true
    $notification.ShowBalloonTip(7000)
    Start-Sleep -Seconds 8
    $notification.Dispose()
  `;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errorText = '';
    const timer = setTimeout(() => child.kill(), 12000);
    child.stderr.on('data', (chunk) => { errorText += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ shown: false, reason: error.message }); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { shown: true } : { shown: false, reason: errorText.trim().slice(0, 300) || `exit-${code}` });
    });
  });
}
