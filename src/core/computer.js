'use strict';

/**
 * Computer use: screen capture and input control.
 *
 * Windows is fully supported through PowerShell + user32. macOS uses built-in
 * screencapture/osascript and, for pointer control, optionally cliclick. Linux
 * uses xdotool/wmctrl/ImageMagick when installed. Every action is executed only
 * after the harness approval flow; nothing here decides its own permissions.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { appPaths, ensureHome } = require('./paths');
const { decodeConsole } = require('./encoding');

const MAX_TEXT = 4000;
const KEEP_SCREENSHOTS = 20;
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

let activityListener = null;
let actorName = '';

/** Observe computer activity (used by the desktop cursor overlay). */
function onActivity(listener) {
  activityListener = typeof listener === 'function' ? listener : null;
}

/** Name shown on the cursor marker (the active model or worker). */
function setActor(name) {
  actorName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 48);
}

function signalActivity(payload = {}) {
  if (!activityListener) return;
  const actor = String(payload.actor || '').trim() || actorName;
  try { activityListener({ ...payload, actor }); } catch {}
}

function computerDir() {
  ensureHome();
  const dir = path.join(appPaths().root, 'computer');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function run(command, args, { timeout = 20000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout,
      cwd,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'buffer',
      env: { ...process.env, ...(isMac ? { LANG: 'en_US.UTF-8' } : {}) },
    }, (error, stdoutBuffer, stderrBuffer) => {
      const stdout = decodeConsole(stdoutBuffer).trim();
      const stderr = decodeConsole(stderrBuffer).trim();
      if (error) {
        const message = stderr || stdout || error.message || '';
        reject(new Error(String(message).trim() || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/* ------------------------------------------------------------------ Windows */

const INPUT_PS = String.raw`param([Parameter(Mandatory=$true)][string]$SpecPath)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class BlankNative {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  public static int TypeText(string text) {
    if (text == null) return 0;
    int size = Marshal.SizeOf(typeof(INPUT));
    int sent = 0;
    foreach (char ch in text) {
      if (ch == '\r') continue;
      INPUT down = new INPUT();
      INPUT up = new INPUT();
      down.type = 1;
      up.type = 1;
      if (ch == '\n') {
        down.u.ki.wVk = 13;
        up.u.ki.wVk = 13;
        up.u.ki.dwFlags = 2;
      } else {
        down.u.ki.wScan = (ushort)ch;
        down.u.ki.dwFlags = 4;
        up.u.ki.wScan = (ushort)ch;
        up.u.ki.dwFlags = 6;
      }
      sent += (int)SendInput(2, new INPUT[] { down, up }, size);
    }
    return sent;
  }
}
"@
try { [BlankNative]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch { [BlankNative]::SetProcessDPIAware() | Out-Null }
$spec = Get-Content -Raw -LiteralPath $SpecPath -Encoding UTF8 | ConvertFrom-Json
$action = [string]$spec.action
function To-B64Json($value) {
  if ($null -eq $value) { $value = @() }
  $json = ConvertTo-Json -InputObject $value -Compress -Depth 5
  if (-not $json) { $json = '[]' }
  return 'jsonb64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$json))
}
function Find-Windows([string[]]$terms) {
  $needles = @($terms | Where-Object { $_ } | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  if (-not $needles.Count) { return @() }
  return @(Get-Process | Where-Object {
    if (-not $_.MainWindowTitle) { return $false }
    foreach ($needle in $needles) {
      if ($_.MainWindowTitle.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
      if ($_.ProcessName.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
    return $false
  })
}
function Resolve-Target($matches) {
  $list = @($matches)
  if (-not $list.Count) { return $null }
  $real = @($list | Where-Object { $_.ProcessName -ne 'ApplicationFrameHost' })
  if ($real.Count) { return $real[0] }
  return $list[0]
}
function Visible-Titles {
  $titles = @(Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First 12 -ExpandProperty MainWindowTitle)
  if (-not $titles.Count) { return 'none' }
  return ($titles -join ' | ')
}
function Move-To([int]$x, [int]$y) {
  [BlankNative]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 45
  $p = New-Object BlankNative+POINT
  if ([BlankNative]::GetCursorPos([ref]$p)) {
    if ([Math]::Abs($p.X - $x) -gt 2 -or [Math]::Abs($p.Y - $y) -gt 2) { [BlankNative]::SetCursorPos($x, $y) | Out-Null }
  }
  Start-Sleep -Milliseconds 25
}
function Mouse-Down([string]$button) { $flag = if ($button -eq 'right') { 0x0008 } elseif ($button -eq 'middle') { 0x0020 } else { 0x0002 }; [BlankNative]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero) }
function Mouse-Up([string]$button) { $flag = if ($button -eq 'right') { 0x0010 } elseif ($button -eq 'middle') { 0x0040 } else { 0x0004 }; [BlankNative]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero) }
switch ($action) {
  'move' { Move-To ([int]$spec.x) ([int]$spec.y) }
  'click' {
    Move-To ([int]$spec.x) ([int]$spec.y)
    $clicks = [Math]::Max(1, [Math]::Min(3, [int]$spec.clicks))
    for ($i = 0; $i -lt $clicks; $i++) { Mouse-Down ([string]$spec.button); Mouse-Up ([string]$spec.button); Start-Sleep -Milliseconds 90 }
  }
  'drag' {
    Move-To ([int]$spec.x) ([int]$spec.y)
    Mouse-Down 'left'
    $steps = 12
    for ($i = 1; $i -le $steps; $i++) {
      $nx = [int]([int]$spec.x + (([int]$spec.to_x - [int]$spec.x) * $i / $steps))
      $ny = [int]([int]$spec.y + (([int]$spec.to_y - [int]$spec.y) * $i / $steps))
      [BlankNative]::SetCursorPos($nx, $ny) | Out-Null
      Start-Sleep -Milliseconds 25
    }
    Mouse-Up 'left'
  }
  'scroll' {
    if ($null -ne $spec.x -and $null -ne $spec.y) { Move-To ([int]$spec.x) ([int]$spec.y) }
    $delta = [int]$spec.delta
    while ($delta -ne 0) {
      $step = [Math]::Max(-120, [Math]::Min(120, $delta))
      [BlankNative]::mouse_event(0x0800, 0, 0, $step, [UIntPtr]::Zero)
      $delta -= $step
      Start-Sleep -Milliseconds 25
    }
  }
  'type' { $sent = [BlankNative]::TypeText([string]$spec.text); Start-Sleep -Milliseconds 60; "Typed $($spec.text.Length) characters." }
  'key' { [System.Windows.Forms.SendKeys]::SendWait([string]$spec.combo); Start-Sleep -Milliseconds 60 }
  'keyvk' {
    $codes = @($spec.vk | ForEach-Object { [int]$_ })
    foreach ($code in $codes) { [BlankNative]::keybd_event([byte]$code, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30 }
    for ($i = $codes.Count - 1; $i -ge 0; $i--) { [BlankNative]::keybd_event([byte]$codes[$i], 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30 }
  }
  'windows' {
    $items = @(Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |
      Select-Object -First 60 Id, ProcessName, MainWindowTitle)
    To-B64Json $items
  }
  'launch' {
    $target = [string]$spec.target
    if (-not $target.Trim()) { 'No app to launch.'; exit 1 }
    $before = @(Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowHandle })
    try { Start-Process -FilePath $target } catch { "Could not launch $($target): $($_.Exception.Message)"; exit 1 }
    $deadline = (Get-Date).AddMilliseconds([int]$spec.ms)
    $wins = @()
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 250
      $wins = @(Get-Process | Where-Object { $_.MainWindowTitle -and ($before -notcontains $_.MainWindowHandle) } |
        Select-Object -First 8 Id, ProcessName, MainWindowTitle)
      if ($wins.Count -gt 0) { break }
    }
    if ($wins.Count -gt 0) { To-B64Json $wins } else { "Launched $target." }
  }
  'focus' {
    $needle = [string]$spec.title
    $target = Resolve-Target (Find-Windows $spec.needles)
    if (-not $target) { "No visible window matched: $needle. Visible windows: $(Visible-Titles)"; exit 1 }
    [BlankNative]::SetForegroundWindow($target.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 120
    "Focused $($target.ProcessName): $($target.MainWindowTitle)"
  }
  'close' {
    $needle = [string]$spec.title
    $target = Resolve-Target (Find-Windows $spec.needles)
    if (-not $target) { "No visible window matched: $needle. Visible windows: $(Visible-Titles)"; exit 1 }
    $label = "$($target.ProcessName): $($target.MainWindowTitle)"
    $handle = $target.MainWindowHandle
    $sent = $false
    try { $sent = $target.CloseMainWindow() } catch {}
    if (-not $sent) { [BlankNative]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
    $deadline = (Get-Date).AddMilliseconds(5000)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 150
      if (-not [BlankNative]::IsWindow($handle) -or -not [BlankNative]::IsWindowVisible($handle)) { "Closed $label"; exit 0 }
    }
    "Asked $label to close, but its window is still open. It may be kept in the tray or waiting for a confirmation."
  }
  'wait' { Start-Sleep -Milliseconds ([Math]::Min(10000, [Math]::Max(0, [int]$spec.ms))); "Waited $($spec.ms) ms" }
  default { throw "Unknown action: $action" }
}`;

const SCREENSHOT_PS = String.raw`param([Parameter(Mandatory=$true)][string]$SpecPath)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
$spec = Get-Content -Raw -LiteralPath $SpecPath -Encoding UTF8 | ConvertFrom-Json
$OutPath = [string]$spec.out
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
"$($bounds.Width)x$($bounds.Height)"`;

function scriptPath(name, content) {
  const dir = path.join(computerDir(), 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash('sha1').update(content).digest('hex').slice(0, 12);
  const file = path.join(dir, `${name}-${hash}.ps1`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, content, 'utf8');
  return file;
}

async function windowsPowerShell(script, payload) {
  const ps = scriptPath(script.name, script.content);
  const dir = computerDir();
  const specFile = path.join(dir, `.spec-${crypto.randomBytes(6).toString('hex')}.json`);
  try {
    fs.writeFileSync(specFile, JSON.stringify(payload), 'utf8');
    const exe = await powershellExe();
    return await run(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps, specFile], { timeout: 25000 });
  } finally {
    try { fs.unlinkSync(specFile); } catch {}
  }
}

let powershellPromise = null;
function powershellExe() {
  if (!powershellPromise) {
    powershellPromise = run('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { timeout: 8000 })
      .then(() => 'powershell.exe')
      .catch(async () => {
        await run('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { timeout: 8000 });
        return 'pwsh';
      });
  }
  return powershellPromise;
}

/* -------------------------------------------------------------------- macOS */

async function ensureMacTool(name) {
  try {
    await run('/usr/bin/which', [name], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

function xmlEscape(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function runAppleScript(lines, args = []) {
  const argv = [];
  for (const line of lines) { argv.push('-e', line); }
  return run('osascript', [...argv, '--', ...args], { timeout: 20000 });
}

function macCombo(key, modifiers = []) {
  const map = {
    enter: { code: 36 }, tab: { code: 48 }, escape: { code: 53 }, space: { code: 49 },
    backspace: { code: 51 }, delete: { code: 117 }, up: { code: 126 }, down: { code: 125 },
    left: { code: 123 }, right: { code: 124 }, home: { code: 115 }, end: { code: 119 },
    pageup: { code: 116 }, pagedown: { code: 121 }, f1: { code: 122 }, f2: { code: 120 },
    f3: { code: 99 }, f4: { code: 118 }, f5: { code: 96 }, f6: { code: 97 },
    f7: { code: 98 }, f8: { code: 100 }, f9: { code: 101 }, f10: { code: 109 },
    f11: { code: 103 }, f12: { code: 111 },
  };
  const lower = String(key || '').toLowerCase();
  const mods = modifiers.map((mod) => `${mod} down`).join(', ');
  if (map[lower]) {
    return mods ? `key code ${map[lower].code} using {${mods}}` : `key code ${map[lower].code}`;
  }
  if (lower.length === 1) {
    const char = String(key).toLowerCase();
    return mods ? `keystroke "${char}" using {${mods}}` : `keystroke "${char}"`;
  }
  throw new Error(`Unsupported key: ${key}`);
}

async function macInput(action, args) {
  if (['move', 'click', 'drag', 'scroll'].includes(action)) {
    const cliclick = await ensureMacTool('cliclick');
    if (!cliclick) throw new Error('Pointer control on macOS needs cliclick (brew install cliclick). Keyboard control works without it.');
    if (action === 'move') await run('cliclick', [`m:${args.x},${args.y}`]);
    if (action === 'click') await run('cliclick', [`c:${args.clicks === 2 ? '2' : '1'}:${args.x},${args.y}`]);
    if (action === 'drag') await run('cliclick', [`dd:${args.x},${args.y}`, `dm:${Math.round((args.x + args.to_x) / 2)},${Math.round((args.y + args.to_y) / 2)}`, `du:${args.to_x},${args.to_y}`]);
    if (action === 'scroll') await run('cliclick', [`w:${args.delta > 0 ? '+' : '-'}${Math.ceil(Math.abs(args.delta) / 120)}`]);
    return `Pointer ${action} complete.`;
  }
  if (action === 'type') {
    await runAppleScript(['on run argv', 'tell application "System Events" to keystroke (item 1 of argv)', 'end run'], [args.text]);
    return 'Typed text.';
  }
  if (action === 'key') {
    const modifiers = (args.modifiers || []).map((mod) => ({ ctrl: 'control', alt: 'option', shift: 'shift', cmd: 'command' }[mod])).filter(Boolean);
    await runAppleScript(['tell application "System Events" to ' + macCombo(args.key, modifiers)]);
    return `Pressed ${[...modifiers, args.key].join('+')}.`;
  }
  if (action === 'windows') {
    const result = await runAppleScript(['tell application "System Events" to get name of every application process whose visible is true']);
    return result.stdout.split(', ').filter(Boolean).map((name) => ({ title: name, app: name }));
  }
  if (action === 'focus') {
    const result = await runAppleScript([
      'on run argv',
      'tell application "System Events"',
      'set targetName to item 1 of argv',
      'set matches to every application process whose name contains targetName',
      'if (count of matches) is 0 then error "No visible app matched: " & targetName',
      'set frontmost of (item 1 of matches) to true',
      'end tell',
      'end run',
    ], [args.title]);
    return result.stdout || `Focused ${args.title}.`;
  }
  if (action === 'wait') {
    await new Promise((resolve) => setTimeout(resolve, Math.min(10000, Math.max(0, Number(args.ms) || 0))));
    return `Waited ${args.ms} ms.`;
  }
  throw new Error(`Unknown action: ${action}`);
}

/* -------------------------------------------------------------------- Linux */

async function linuxInput(action, args) {
  const hasXdotool = await ensureMacTool('xdotool');
  if (['move', 'click', 'drag', 'scroll', 'type', 'key'].includes(action) && !hasXdotool) {
    throw new Error('Computer input on Linux needs xdotool (install it with your package manager).');
  }
  if (action === 'move') await run('xdotool', ['mousemove', String(args.x), String(args.y)]);
  if (action === 'click') await run('xdotool', ['mousemove', String(args.x), String(args.y), 'click', args.button === 'right' ? '3' : args.button === 'middle' ? '2' : '1', '--repeat', String(args.clicks || 1)]);
  if (action === 'drag') await run('xdotool', ['mousemove', String(args.x), String(args.y), 'mousedown', '1', 'mousemove', String(args.to_x), String(args.to_y), 'mouseup', '1']);
  if (action === 'scroll') await run('xdotool', ['click', args.delta > 0 ? '4' : '5', '--repeat', String(Math.max(1, Math.ceil(Math.abs(args.delta) / 120)))]);
  if (action === 'type') await run('xdotool', ['type', '--delay', '25', String(args.text)]);
  if (action === 'key') {
    const mods = (args.modifiers || []).map((mod) => ({ ctrl: 'ctrl', alt: 'alt', shift: 'shift', cmd: 'super' }[mod])).filter(Boolean);
    await run('xdotool', ['key', [...mods, String(args.key).toLowerCase()].join('+')]);
  }
  if (action === 'windows') {
    const hasWmctrl = await ensureMacTool('wmctrl');
    if (!hasWmctrl) throw new Error('Listing windows on Linux needs wmctrl.');
    const result = await run('wmctrl', ['-l']);
    return result.stdout.split('\n').filter(Boolean).map((line) => {
      const parts = line.trim().split(/\s+/);
      return { id: parts[0], app: parts[1], title: parts.slice(3).join(' ') };
    });
  }
  if (action === 'focus') {
    const hasWmctrl = await ensureMacTool('wmctrl');
    if (!hasWmctrl) throw new Error('Focusing windows on Linux needs wmctrl.');
    const list = await linuxInput('windows', {});
    const match = list.find((win) => String(win.title).toLowerCase().includes(String(args.title).toLowerCase()));
    if (!match) throw new Error(`No window matched: ${args.title}`);
    await run('wmctrl', ['-ia', match.id]);
    return `Focused ${match.title}.`;
  }
  if (action === 'wait') {
    await new Promise((resolve) => setTimeout(resolve, Math.min(10000, Math.max(0, Number(args.ms) || 0))));
    return `Waited ${args.ms} ms.`;
  }
  return `Pointer ${action} complete.`;
}

/* -------------------------------------------------------------------- public */

function clampInt(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Coordinates must be numbers.');
  if (number < min || number > max) throw new Error(`Value out of range (${min}..${max}).`);
  return Math.round(number);
}

function validateKey(key) {
  const value = String(key || '').trim();
  if (!/^[a-zA-Z0-9+._\- ]{1,32}$/.test(value)) throw new Error('Invalid key name.');
  return value;
}

function cleanModifiers(list) {
  if (!Array.isArray(list)) return [];
  return list.map((value) => String(value).toLowerCase()).filter((value) => ['ctrl', 'alt', 'shift', 'cmd', 'meta', 'win'].includes(value));
}

/* Windows resolves bare names through PATH, where developer shims (Git usr/bin)
   shadow system apps. Launch known apps by absolute path or shell URI instead. */
function resolveLaunchTarget(target) {
  const value = String(target || '').trim();
  if (!isWin || !value) return value;
  const root = process.env.SystemRoot || 'C:\\Windows';
  const system32 = path.join(root, 'System32');
  const aliases = {
    notepad: path.join(system32, 'notepad.exe'),
    메모장: path.join(system32, 'notepad.exe'),
    calc: path.join(system32, 'calc.exe'),
    calculator: path.join(system32, 'calc.exe'),
    계산기: path.join(system32, 'calc.exe'),
    mspaint: path.join(system32, 'mspaint.exe'),
    paint: path.join(system32, 'mspaint.exe'),
    그림판: path.join(system32, 'mspaint.exe'),
    cmd: path.join(system32, 'cmd.exe'),
    explorer: path.join(root, 'explorer.exe'),
    탐색기: path.join(root, 'explorer.exe'),
    taskmgr: path.join(system32, 'Taskmgr.exe'),
    '작업 관리자': path.join(system32, 'Taskmgr.exe'),
    control: path.join(system32, 'control.exe'),
    제어판: path.join(system32, 'control.exe'),
    snippingtool: path.join(system32, 'SnippingTool.exe'),
    '캡처 도구': path.join(system32, 'SnippingTool.exe'),
    settings: 'ms-settings:',
    설정: 'ms-settings:',
    camera: 'microsoft.windows.camera:',
    카메라: 'microsoft.windows.camera:',
  };
  const alias = aliases[value.toLowerCase()];
  if (alias) return alias;
  if (!/[\\/:]/.test(value)) {
    const exe = path.join(system32, `${value}.exe`);
    if (fs.existsSync(exe)) return exe;
  }
  return value;
}

/** Match windows by title or process name, including Korean/English app pairs. */
const WINDOW_ALIASES = [
  ['kakaotalk', '카카오톡'],
  ['notepad', '메모장'],
  ['calc', '계산기'],
  ['calculator', '계산기'],
  ['mspaint', '그림판'],
  ['paint', '그림판'],
  ['explorer', '탐색기', '파일 탐색기'],
  ['taskmgr', '작업 관리자'],
  ['task manager', '작업 관리자'],
  ['control', '제어판'],
  ['snippingtool', '캡처 도구'],
  ['snipping tool', '캡처 도구'],
  ['settings', '설정'],
  ['camera', '카메라'],
  ['chrome', '크롬'],
  ['msedge', '엣지'],
  ['discord', '디스코드'],
  ['spotify', '스포티파이'],
  ['code', 'visual studio code'],
];

function windowSearchTerms(query) {
  const raw = String(query || '').trim().replace(/\.exe$/i, '');
  if (!raw) return [];
  const terms = [];
  const add = (value) => {
    const term = String(value || '').trim();
    if (term && !terms.some((existing) => existing.toLowerCase() === term.toLowerCase())) terms.push(term);
  };
  add(raw);
  const lower = raw.toLowerCase();
  for (const group of WINDOW_ALIASES) {
    if (!group.includes(lower) && !group.includes(raw)) continue;
    for (const term of group) add(term);
  }
  return terms.slice(0, 8);
}

function sendKeysCombo(key, modifiers) {
  const map = {
    enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', escape: '{ESC}', esc: '{ESC}',
    space: ' ', backspace: '{BACKSPACE}', delete: '{DELETE}', insert: '{INSERT}',
    up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
    home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
  };
  const lower = String(key || '').toLowerCase();
  let base = map[lower];
  if (!base) {
    if (/^f([1-9]|1[0-2])$/.test(lower)) base = `{${lower.toUpperCase()}}`;
    else if (/^[a-z0-9]$/.test(lower)) base = lower;
    else if (/^[+^%~()[\]{}]$/.test(key)) base = `{${key}}`;
    else throw new Error(`Unsupported key: ${key}`);
  }
  let prefix = '';
  for (const mod of modifiers) {
    if (mod === 'ctrl') prefix += '^';
    else if (mod === 'alt') prefix += '%';
    else if (mod === 'shift') prefix += '+';
  }
  return `${prefix}${base}`;
}

const VK_CODES = {
  win: 0x5B, meta: 0x5B, cmd: 0x5B, ctrl: 0x11, alt: 0x12, shift: 0x10,
  enter: 0x0D, return: 0x0D, tab: 0x09, escape: 0x1B, esc: 0x1B, space: 0x20,
  backspace: 0x08, delete: 0x2E, insert: 0x2D,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
};

/** Windows-key combos need virtual-key events; SendKeys has no Win modifier. */
function vkCombo(key, modifiers) {
  const mods = modifiers.map((mod) => (mod === 'cmd' || mod === 'meta' ? 'win' : mod));
  const lower = String(key || '').toLowerCase();
  if (!mods.includes('win') && lower !== 'win') return null;
  if (lower === 'win' && !mods.includes('win')) mods.push('win');
  const codes = [];
  for (const mod of ['ctrl', 'alt', 'shift', 'win']) {
    if (mods.includes(mod)) codes.push(VK_CODES[mod]);
  }
  if (lower !== 'win') {
    let code = VK_CODES[lower];
    if (!code && /^[a-z]$/.test(lower)) code = lower.toUpperCase().charCodeAt(0);
    if (!code && /^[0-9]$/.test(lower)) code = lower.charCodeAt(0);
    if (!code && /^f([1-9]|1[0-2])$/.test(lower)) code = 0x6F + Number(lower.slice(1));
    if (!code) throw new Error(`Unsupported key: ${key}`);
    codes.push(code);
  }
  return codes.length ? codes : null;
}

function parseWindowJson(stdout) {
  let text = String(stdout || '').trim();
  if (!text) return [];
  if (text.startsWith('jsonb64:')) {
    try { text = Buffer.from(text.slice(8), 'base64').toString('utf8'); } catch { return []; }
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function normalizeArgs(action, args = {}) {
  const base = { action };
  if (['move', 'click', 'drag', 'scroll'].includes(action)) {
    if (['move', 'click', 'drag'].includes(action)) {
      base.x = clampInt(args.x, -100000, 100000);
      base.y = clampInt(args.y, -100000, 100000);
    }
    if (action === 'click') {
      base.button = ['left', 'right', 'middle'].includes(args.button) ? args.button : 'left';
      base.clicks = clampInt(args.clicks || 1, 1, 3);
    }
    if (action === 'drag') {
      base.to_x = clampInt(args.to_x, -100000, 100000);
      base.to_y = clampInt(args.to_y, -100000, 100000);
    }
    if (action === 'scroll') {
      base.delta = clampInt(args.delta ?? -480, -3000, 3000);
      if (base.delta === 0) base.delta = -480;
      if (args.x !== undefined && args.y !== undefined) {
        base.x = clampInt(args.x, -100000, 100000);
        base.y = clampInt(args.y, -100000, 100000);
      }
    }
  }
  if (action === 'type') {
    base.text = String(args.text || '');
    if (!base.text) throw new Error('Text is empty.');
    if (base.text.length > MAX_TEXT) throw new Error(`Text is too long (max ${MAX_TEXT} characters).`);
  }
  if (action === 'key') {
    base.key = validateKey(args.key);
    base.modifiers = cleanModifiers(args.modifiers);
  }
  if (action === 'focus' || action === 'close') {
    base.title = String(args.title || '').trim();
    if (!base.title) throw new Error('Window title or app name is required.');
    if (base.title.length > 120) throw new Error('Window title is too long.');
    base.needles = windowSearchTerms(base.title);
  }
  if (action === 'launch') {
    base.target = String(args.target || '').trim();
    if (!base.target) throw new Error('App name or path is required.');
    if (base.target.length > 260) throw new Error('App name is too long.');
    const wait = Number(args.ms);
    base.ms = Number.isFinite(wait) ? Math.min(Math.max(Math.round(wait), 0), 10000) : 4000;
  }
  if (action === 'wait') base.ms = clampInt(args.ms || 500, 0, 10000);
  return base;
}

async function screenshot({ actor = '' } = {}) {
  const dir = computerDir();
  const file = path.join(dir, `screen-${stamp()}.png`);
  let dimensions = '';
  if (isWin) {
    const result = await windowsPowerShell({ name: 'screenshot', content: SCREENSHOT_PS }, { out: file });
    dimensions = result.stdout.trim();
  } else if (isMac) {
    await run('screencapture', ['-x', file], { timeout: 15000 });
    const size = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { timeout: 8000 }).catch(() => null);
    if (size) {
      const w = size.stdout.match(/pixelWidth:\s*(\d+)/)?.[1];
      const h = size.stdout.match(/pixelHeight:\s*(\d+)/)?.[1];
      if (w && h) dimensions = `${w}x${h}`;
    }
  } else {
    let captured = false;
    for (const [cmd, args] of [
      ['gnome-screenshot', ['-f', file]],
      ['scrot', [file]],
      ['import', ['-window', 'root', file]],
    ]) {
      if (!(await ensureMacTool(cmd))) continue;
      try { await run(cmd, args, { timeout: 15000 }); captured = true; break; } catch {}
    }
    if (!captured) throw new Error('No screenshot tool found. Install gnome-screenshot, scrot or ImageMagick.');
    const size = await run('identify', ['-format', '%wx%h', file], { timeout: 8000 }).catch(() => null);
    if (size) dimensions = size.stdout.trim();
  }
  if (!fs.existsSync(file)) throw new Error('The screenshot could not be saved.');
  const stat = fs.statSync(file);
  const screenshots = fs.readdirSync(dir).filter((name) => /^screen-.*\.(png|jpg)$/i.test(name));
  const baseOf = (name) => name.replace(/-model\.jpe?g$/i, '').replace(/\.(png|jpe?g)$/i, '');
  const keep = new Set([...new Set(screenshots.map(baseOf))].sort().slice(-KEEP_SCREENSHOTS));
  for (const old of screenshots) {
    if (!keep.has(baseOf(old))) {
      try { fs.unlinkSync(path.join(dir, old)); } catch {}
    }
  }
  const [width, height] = dimensions.split('x').map((value) => Number(value) || 0);
  signalActivity({ kind: 'screenshot', actor });
  return { path: file, width, height, bytes: stat.size, display: dimensions };
}

async function perform(rawAction, rawArgs = {}) {
  const action = String(rawAction || '').toLowerCase();
  if (!['move', 'click', 'drag', 'scroll', 'type', 'key', 'wait', 'focus', 'close', 'windows', 'launch'].includes(action)) {
    throw new Error(`Unknown computer action: ${action}`);
  }
  const actor = String(rawArgs.actor || '');
  const args = normalizeArgs(action, rawArgs);
  const plain = ['windows', 'type', 'key', 'wait', 'launch', 'close'].includes(action);
  signalActivity({
    kind: action,
    actor,
    x: plain ? undefined : args.x,
    y: plain ? undefined : args.y,
    toX: action === 'drag' ? args.to_x : undefined,
    toY: action === 'drag' ? args.to_y : undefined,
    detail: action === 'focus' || action === 'close' ? args.title : action === 'launch' ? args.target : action === 'key' ? [ ...(args.modifiers || []), args.key ].join('+') : undefined,
  });
  if (action === 'launch') args.target = resolveLaunchTarget(args.target);
  if (!isWin && action === 'close') throw new Error('Closing windows is currently supported on Windows only.');
  if (isWin) {
    if (action === 'key') {
      const vk = vkCombo(args.key, args.modifiers);
      if (vk) {
        args.vk = vk;
        args.action = 'keyvk';
      } else {
        args.combo = sendKeysCombo(args.key, args.modifiers);
      }
    }
    const result = await windowsPowerShell({ name: 'input', content: INPUT_PS }, args);
    const windows = parseWindowJson(result.stdout);
    if (action === 'windows') return { action, windows };
    if (action === 'launch' && windows.length) return { action, windows, detail: result.stdout.trim().startsWith('jsonb64:') ? '' : result.stdout.trim() };
    return { action, detail: result.stdout.trim() || `${action} complete.` };
  }
  if (isMac) {
    if (action === 'launch') {
      await run('open', [args.target], { timeout: 15000 });
      return { action, detail: `Launched ${args.target}.` };
    }
    const result = await macInput(action, args);
    if (action === 'windows') return { action, windows: result };
    return { action, detail: String(result || `${action} complete.`) };
  }
  if (action === 'launch') {
    await run('xdg-open', [args.target], { timeout: 15000 });
    return { action, detail: `Launched ${args.target}.` };
  }
  const result = await linuxInput(action, args);
  if (action === 'windows') return { action, windows: result };
  return { action, detail: String(result || `${action} complete.`) };
}

async function listWindows() {
  const result = await perform('windows');
  return result.windows || [];
}

module.exports = { screenshot, perform, listWindows, normalizeArgs, sendKeysCombo, vkCombo, resolveLaunchTarget, windowSearchTerms, computerDir, onActivity, setActor };
