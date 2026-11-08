'use strict';

const CODES = {
  accent: '38;2;47;107;255',
  bold: '1',
  dim: '2',
  italic: '3',
  underline: '4',
  green: '38;2;27;135;95',
  red: '38;2;199;61;61',
  yellow: '38;2;176;115;15',
  heading: '1;38;2;47;107;255',
  code: '38;2;214;135;26',
  reverse: '7',
};

function createTheme({ color = true } = {}) {
  const wrap = (token, value) => (color && CODES[token] ? `\u001b[${CODES[token]}m${value}\u001b[0m` : value);
  return {
    color,
    paint(spans) {
      return (spans || []).map((span) => (span.style ? wrap(span.style, span.text) : span.text)).join('');
    },
    wrap,
  };
}

module.exports = { createTheme };
