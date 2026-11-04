'use strict';

/* System speech synthesis. Uses voices already installed on the machine:
   Windows SAPI, macOS `say`, or espeak/espeak-ng on Linux. Text is passed
   through a UTF-8 file so long scripts never hit command-line limits. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runProcess } = require('./util');

let voiceCache = null;
let voiceCacheAt = 0;

function cleanVoice(value) {
  return String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120);
}

async function listVoices() {
  if (voiceCache && Date.now() - voiceCacheAt < 120000) return voiceCache;
  let names = [];
  try {
    if (process.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Speech',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        '$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }',
        '$s.Dispose()',
      ].join('; ');
      const result = await runProcess('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 12000, maxStdout: 65536 });
      names = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } else if (process.platform === 'darwin') {
      const result = await runProcess('say', ['-v', '?'], { timeout: 8000, maxStdout: 131072 });
      names = String(result.stdout || '').split(/\r?\n/)
        .map((line) => (line.match(/^(.+?)\s{2,}[a-z]{2}_[A-Z]{2}/) || [])[1] || '')
        .map((line) => line.trim())
        .filter(Boolean);
    } else {
      const bin = await firstAvailable(['espeak-ng', 'espeak']);
      if (bin) {
        const result = await runProcess(bin, ['--voices'], { timeout: 8000, maxStdout: 131072 });
        names = String(result.stdout || '').split(/\r?\n/).slice(1)
          .map((line) => line.trim().split(/\s+/)[3] || '')
          .filter(Boolean);
      }
    }
  } catch {
    names = [];
  }
  voiceCache = [...new Set(names)].slice(0, 80);
  voiceCacheAt = Date.now();
  return voiceCache;
}

async function firstAvailable(bins) {
  for (const bin of bins) {
    try {
      await runProcess(bin, ['--version'], { timeout: 4000, maxStdout: 8192 });
      return bin;
    } catch {}
  }
  return '';
}

async function synthesizeWindows({ text, textFile, outFile, voice, rate, signal }) {
  const scriptFile = path.join(os.tmpdir(), `blank-tts-${process.pid}.ps1`);
  const script = [
    'param([string]$TextFile,[string]$OutFile,[string]$Voice,[int]$Rate)',
    'Add-Type -AssemblyName System.Speech',
    '$text = [IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8)',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$s.Rate = $Rate',
    'if ($Voice) { try { $s.SelectVoice($Voice) } catch {} }',
    '$s.SetOutputToWaveFile($OutFile)',
    '$s.Speak($text)',
    '$s.Dispose()',
  ].join('\r\n');
  fs.writeFileSync(scriptFile, `\ufeff${script}`, 'utf8');
  try {
    await runProcess('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile,
      '-TextFile', textFile, '-OutFile', outFile, '-Voice', cleanVoice(voice), '-Rate', String(rate),
    ], { signal, timeout: 180000 });
  } finally {
    try { fs.unlinkSync(scriptFile); } catch {}
  }
}

async function synthesizeMac({ textFile, outFile, voice, rate, signal }) {
  const args = ['-f', textFile, '-o', outFile, '--file-format=WAVE', '--data-format=LEI16@22050'];
  if (voice) args.unshift('-v', cleanVoice(voice));
  args.push('-r', String(Math.max(90, Math.min(300, 175 + Math.round(rate * 12)))));
  await runProcess('say', args, { signal, timeout: 180000 });
}

async function synthesizeLinux({ textFile, outFile, voice, rate, signal }) {
  const bin = await firstAvailable(['espeak-ng', 'espeak']);
  if (!bin) throw new Error('Speech on Linux needs espeak-ng (sudo apt install espeak-ng)');
  const args = ['-f', textFile, '-w', outFile, '-s', String(Math.max(80, Math.min(450, 175 + Math.round(rate * 15))))];
  if (voice) args.push('-v', cleanVoice(voice));
  await runProcess(bin, args, { signal, timeout: 180000 });
}

async function synthesize({ text, voice, rate, outWav, textFile, signal }) {
  const content = String(text || '').trim();
  if (!content) throw new Error('Add a script to speak');
  if (content.length > 8000) throw new Error('Speech scripts are limited to 8,000 characters');
  const cleanRate = Math.max(-10, Math.min(10, Math.round(Number(rate) || 0)));
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  fs.writeFileSync(textFile, content, 'utf8');
  try {
    if (process.platform === 'win32') {
      await synthesizeWindows({ text: content, textFile, outFile: outWav, voice, rate: cleanRate, signal });
    } else if (process.platform === 'darwin') {
      await synthesizeMac({ textFile, outFile: outWav, voice, rate: cleanRate, signal });
    } else {
      await synthesizeLinux({ textFile, outFile: outWav, voice, rate: cleanRate, signal });
    }
  } finally {
    try { fs.unlinkSync(textFile); } catch {}
  }
  if (!fs.existsSync(outWav) || fs.statSync(outWav).size < 128) {
    throw new Error('The system produced no speech. Check that a voice is installed.');
  }
  return outWav;
}

function available() {
  return ['win32', 'darwin', 'linux'].includes(process.platform);
}

module.exports = { available, listVoices, synthesize };
