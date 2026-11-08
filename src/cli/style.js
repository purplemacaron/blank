'use strict';

function createStyle(enabled) {
  const wrap = (code) => (text) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : String(text));
  return {
    blue: wrap('38;2;47;107;255'),
    bold: wrap('1'),
    dim: wrap('2'),
    green: wrap('38;2;27;135;95'),
    red: wrap('38;2;199;61;61'),
    yellow: wrap('38;2;176;115;15'),
    underline: wrap('4'),
  };
}

module.exports = { createStyle };
