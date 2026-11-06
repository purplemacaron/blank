'use strict';

/* Update location checks without Electron, so they can be unit-tested.

   electron-updater installs NSIS updates into the folder chosen by the
   installer. A copy that runs from electron-builder's `win-unpacked` folder
   or a portable extraction in Temp has no installed base: the downloaded
   installer may not be able to replace its locked files, and the next launch
   still runs the old copy. Those builds report themselves as non-updatable
   instead of offering an install that cannot finish. */

function normalize(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isTemporaryBuildPath(execPath, tempRoot) {
  const exe = normalize(execPath);
  if (!exe) return false;
  if (/(^|\/)win-unpacked(\/|$)/.test(exe)) return true;
  const root = normalize(tempRoot);
  if (!root) return false;
  return exe === root || exe.startsWith(`${root}/`);
}

module.exports = { isTemporaryBuildPath };
