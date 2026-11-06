'use strict';

// SignPath returns a signed copy of the NSIS installer after manual approval.
// electron-builder already generated latest.yml and the blockmap for the
// unsigned file, so both have to be rebuilt from the signed bytes before the
// release job uploads them. Otherwise the auto-updater would reject the file.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');

async function main() {
  const input = process.argv[2];
  if (!input) {
    throw new Error('Usage: node scripts/finalize-windows-signing.js <signed-installer> [dist-dir]');
  }

  const signedPath = path.resolve(input);
  if (!fs.existsSync(signedPath)) {
    throw new Error(`Signed installer not found: ${signedPath}`);
  }

  const distDir = path.resolve(process.argv[3] || 'dist');
  const latestPath = path.join(distDir, 'latest.yml');
  if (!fs.existsSync(latestPath)) {
    throw new Error(`latest.yml not found: ${latestPath}`);
  }

  const latest = yaml.load(fs.readFileSync(latestPath, 'utf8'));
  const entry = latest && Array.isArray(latest.files)
    ? latest.files.find((file) => String(file.url || '').toLowerCase().endsWith('.exe'))
    : null;
  if (!entry || !entry.url) {
    throw new Error('latest.yml does not contain a Windows installer');
  }

  const fileName = path.basename(entry.url);
  const targetPath = path.join(distDir, fileName);
  if (signedPath !== targetPath) {
    fs.copyFileSync(signedPath, targetPath);
  }

  const bytes = fs.readFileSync(targetPath);
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');

  entry.url = fileName;
  entry.sha512 = sha512;
  entry.size = bytes.length;
  latest.path = fileName;
  latest.sha512 = sha512;
  latest.releaseDate = new Date().toISOString();
  fs.writeFileSync(latestPath, yaml.dump(latest, { lineWidth: -1, noRefs: true }), 'utf8');

  const blockMapPath = `${targetPath}.blockmap`;
  await buildBlockMap(targetPath, 'gzip', blockMapPath);

  process.stdout.write(`Finalized signed installer: ${fileName}\n`);
  process.stdout.write(`size: ${bytes.length}\n`);
  process.stdout.write(`sha512: ${sha512}\n`);
  process.stdout.write(`blockmap: ${blockMapPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
