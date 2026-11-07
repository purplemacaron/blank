'use strict';

/**
 * Child processes on Korean Windows often write the OEM code page (949) while
 * newer tools emit UTF-8. Decode strictly in order so neither becomes mojibake.
 */
function decodeConsole(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || '', 'utf8');
  if (!buffer.length) return '';
  for (const encoding of ['utf-8', 'euc-kr']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {}
  }
  return buffer.toString('utf8');
}

module.exports = { decodeConsole };
