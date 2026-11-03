/* Small, dependency-free Markdown renderer tuned for chat. */
(function () {
  'use strict';

  const escape = (value) => U.esc(value);

  const KEYWORDS = {
    js: 'const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of delete void yield static get set this super null undefined true false',
    ts: 'const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of delete void yield static get set this super null undefined true false interface type enum implements readonly public private protected declare namespace as satisfies keyof infer never unknown any string number boolean',
    json: 'true false null',
    py: 'def class return if elif else for while in not and or import from as with try except finally raise lambda yield global nonlocal pass break continue None True False async await self',
    sh: 'if then else elif fi for while do done case esac function in export local echo cd node npm git sudo',
    bash: 'if then else elif fi for while do done case esac function in export local echo cd node npm git sudo',
    css: 'important media keyframes import supports from to',
    html: '',
    sql: 'select from where insert into values update set delete create table drop alter add index join left right inner outer on group by order limit offset as and or not null is in exists having distinct union all case when then else end',
    go: 'package import func var const type struct interface map chan go defer return if else for range switch case break continue nil true false make new',
    rs: 'fn let mut const struct enum impl trait pub use mod match if else for while loop return break continue where self Self as in async await move dyn ref type unsafe true false Some None Ok Err',
    java: 'public private protected class interface extends implements new return if else for while switch case break continue static final void import package try catch finally throw throws this super null true false',
    yaml: 'true false null',
    toml: 'true false',
  };

  function highlight(raw, lang) {
    const language = String(lang || '').toLowerCase();
    if (!raw) return '';
    if (language === 'diff') {
      return raw.split('\n').map((line) => {
        const cls = line.startsWith('+') ? 'tok-add' : line.startsWith('-') ? 'tok-del' : line.startsWith('@@') ? 'tok-meta' : '';
        return cls ? `<span class="${cls}">${escape(line)}</span>` : escape(line);
      }).join('\n');
    }
    const words = KEYWORDS[language] || KEYWORDS.js;
    if (!['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'py', 'python', 'sh', 'bash', 'zsh', 'css', 'scss', 'sql', 'go', 'rs', 'rust', 'java', 'kt', 'swift', 'c', 'cpp', 'cs', 'php', 'rb', 'ruby', 'yml', 'yaml', 'toml', 'lua'].includes(language)) {
      return escape(raw);
    }
    const hashComment = ['py', 'python', 'sh', 'bash', 'zsh', 'rb', 'ruby', 'yml', 'yaml', 'toml', 'r'].includes(language);
    const dashComment = ['sql', 'lua'].includes(language);
    const commentGroup = [
      '\\/\\/[^\\n]*',
      '\\/\\*[\\s\\S]*?\\*\\/',
      hashComment ? '#[^\\n]*' : null,
      dashComment ? '--[^\\n]*' : null,
    ].filter(Boolean).join('|');
    const keywordPattern = words.split(/\s+/).filter(Boolean).join('|');
    const regex = new RegExp(
      `(${commentGroup})|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)|\\b(0x[\\da-fA-F]+|\\d+(?:\\.\\d+)?)\\b|\\b(${keywordPattern})\\b`,
      'g',
    );
    let out = '';
    let last = 0;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      out += escape(raw.slice(last, match.index));
      if (match[1]) out += `<span class="tok-com">${escape(match[1])}</span>`;
      else if (match[2]) out += `<span class="tok-str">${escape(match[2])}</span>`;
      else if (match[3]) out += `<span class="tok-num">${escape(match[3])}</span>`;
      else out += `<span class="tok-kw">${escape(match[4])}</span>`;
      last = match.index + match[0].length;
    }
    out += escape(raw.slice(last));
    return out;
  }

  function inline(text) {
    const codes = [];
    let working = String(text || '').replace(/`([^`\n]+)`/g, (_match, code) => {
      const token = `\u0000${codes.length}\u0000`;
      codes.push(`<code class="md-inline-code">${escape(code)}</code>`);
      return token;
    });
    working = escape(working);
    working = working
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_m, alt, url) => `<a href="${url}" class="md-link" target="_blank" rel="noreferrer">${alt || url}</a>`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, (_m, label, url) => `<a href="${url}" class="md-link" target="_blank" rel="noreferrer">${label}</a>`)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/\n/g, '<br>');
    working = working.replace(/\u0000(\d+)\u0000/g, (_m, index) => codes[Number(index)] || '');
    return working;
  }

  function renderTable(rows) {
    if (rows.length < 2) return '';
    const header = rows[0].map((cell) => `<th>${inline(cell)}</th>`).join('');
    const body = rows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('');
    return `<div class="md-table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function splitRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  }

  function renderList(items) {
    function build(start, indent) {
      const ordered = items[start].ordered;
      const tag = ordered ? 'ol' : 'ul';
      let html = `<${tag}${ordered ? ' class="md-ol"' : ''}>`;
      let index = start;
      while (index < items.length) {
        const item = items[index];
        if (item.indent < indent) break;
        if (item.indent > indent) {
          const nested = build(index, item.indent);
          html = html.replace(/<\/li>$/, `${nested.html}</li>`);
          index = nested.index;
          continue;
        }
        if (item.ordered !== ordered) break;
        let content = item.text;
        let box = '';
        const task = content.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          box = `<span class="md-check ${task[1].toLowerCase() === 'x' ? 'checked' : ''}">${task[1].toLowerCase() === 'x' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>' : ''}</span>`;
          content = task[2];
        }
        html += `<li${box ? ' class="task"' : ''}>${box}<span>${inline(content)}</span></li>`;
        index += 1;
        if (index < items.length && items[index].indent > indent) {
          const nested = build(index, items[index].indent);
          html = html.replace(/<\/li>$/, `${nested.html}</li>`);
          index = nested.index;
        }
      }
      html += `</${tag}>`;
      return { html, index };
    }
    return build(0, items[0].indent).html;
  }

  function isTableStart(lines, i) {
    return /\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1]);
  }

  function renderMarkdown(input) {
    const lines = String(input || '').replace(/\r\n?/g, '\n').split('\n');
    let html = '';
    let paragraph = [];
    let index = 0;

    const flush = () => {
      if (!paragraph.length) return;
      html += `<p>${inline(paragraph.join('\n'))}</p>`;
      paragraph = [];
    };

    while (index < lines.length) {
      const line = lines[index];

      if (/^\s*$/.test(line)) { flush(); index += 1; continue; }

      const fence = line.match(/^\s*(```|~~~)\s*([\w+.#-]*)\s*$/);
      if (fence) {
        flush();
        const marker = fence[1];
        const lang = fence[2] || '';
        const body = [];
        index += 1;
        while (index < lines.length && !new RegExp(`^\\s*${marker}\\s*$`).test(lines[index])) {
          body.push(lines[index]);
          index += 1;
        }
        index += 1;
        const code = body.join('\n');
        const label = lang || 'text';
        html += `<div class="code-block" data-lang="${escape(label)}">`
          + `<div class="code-head"><span class="code-lang">${escape(label)}</span>`
          + `<button class="code-copy js-copy-code" type="button" title="Copy code">${window.icon('copy', 13)}<span>Copy</span></button></div>`
          + `<pre><code class="lang-${escape(label)}">${highlight(code, lang)}</code></pre></div>`;
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flush();
        const level = heading[1].length;
        html += `<h${level + 2} class="md-h${level}">${inline(heading[2])}</h${level + 2}>`;
        index += 1;
        continue;
      }

      if (/^\s*([-*_])\s*\1\s*\1\s*$/.test(line) || /^\s*---+\s*$/.test(line)) {
        flush();
        html += '<hr class="md-hr"/>';
        index += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        flush();
        const quote = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          quote.push(lines[index].replace(/^\s*>\s?/, ''));
          index += 1;
        }
        html += `<blockquote class="md-quote">${renderMarkdown(quote.join('\n'))}</blockquote>`;
        continue;
      }

      if (isTableStart(lines, index)) {
        flush();
        const rows = [splitRow(line)];
        index += 2;
        while (index < lines.length && /\|/.test(lines[index]) && !/^\s*$/.test(lines[index])) {
          rows.push(splitRow(lines[index]));
          index += 1;
        }
        html += renderTable(rows);
        continue;
      }

      const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (listMatch) {
        flush();
        const items = [];
        while (index < lines.length) {
          const match = lines[index].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (!match) {
            if (/^\s*$/.test(lines[index])) break;
            if (items.length && /^\s{2,}/.test(lines[index])) {
              items[items.length - 1].text += ` ${lines[index].trim()}`;
              index += 1;
              continue;
            }
            break;
          }
          items.push({
            indent: match[1].replace(/\t/g, '  ').length,
            ordered: /\d/.test(match[2]),
            text: match[3],
          });
          index += 1;
        }
        html += renderList(items);
        continue;
      }

      paragraph.push(line);
      index += 1;
    }
    flush();
    return html || '<p class="md-empty"></p>';
  }

  function plain(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  window.MD = { render: renderMarkdown, inline, highlight, escape, plain };
})();
