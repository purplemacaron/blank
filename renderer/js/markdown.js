/* Small, dependency-free Markdown renderer tuned for chat. */
(function () {
  'use strict';

  const escape = (value) => U.esc(value);

  const KEYWORDS = {
    js: 'const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of delete void yield static get set this super null undefined true false',
    ts: 'const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of delete void yield static get set this super null undefined true false interface type enum implements readonly public private protected declare namespace as satisfies keyof infer never unknown any string number boolean',
    json: 'true false null',
    py: 'def class return if elif else for while in not and or import from as with try except finally raise lambda yield global nonlocal pass break continue None True False async await self match case',
    sh: 'if then else elif fi for while do done case esac function in export local echo cd node npm git sudo',
    bash: 'if then else elif fi for while do done case esac function in export local echo cd node npm git sudo',
    css: 'important media keyframes import supports from to',
    html: '',
    sql: 'select from where insert into values update set delete create table drop alter add index join left right inner outer on group by order limit offset as and or not null is in exists having distinct union all case when then else end returning with',
    go: 'package import func var const type struct interface map chan go defer return if else for range switch case break continue nil true false make new select fallthrough',
    rs: 'fn let mut const struct enum impl trait pub use mod match if else for while loop return break continue where self Self as in async await move dyn ref type unsafe true false Some None Ok Err crate super',
    java: 'public private protected class interface extends implements new return if else for while switch case break continue static final void import package try catch finally throw throws this super null true false record sealed permits var',
    yaml: 'true false null',
    toml: 'true false',
    kt: 'package import class interface object fun val var if else when for while do return break continue try catch finally throw is as in out private public protected internal override open data sealed enum companion this super null true false lateinit suspend by',
    swift: 'import class struct enum protocol extension func let var if else guard for while repeat switch case break continue return throw throws try catch do defer init deinit self super nil true false public private internal fileprivate open static final override async await actor some any',
    c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while',
    cpp: 'alignas auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend if inline int long namespace new noexcept nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while override final',
    cs: 'using namespace class struct interface enum public private protected internal static void int string bool var new return if else for foreach while switch case break continue try catch finally throw this base null true false async await record get set',
    php: 'function class interface trait extends implements public private protected static return if else elseif foreach for while switch case break continue try catch finally throw new echo print namespace use as null true false fn match readonly',
    rb: 'def class module end if elsif else unless while until for in do begin rescue ensure raise return yield self nil true false and or not require attr_reader attr_accessor lambda proc',
    r: 'function if else for while repeat in next break return TRUE FALSE NULL NA library require c',
    scala: 'package import class object trait extends with def val var if else match case for while do return new this super null true false implicit override private protected sealed final lazy given using enum',
    dart: 'import class extends implements mixin enum abstract final const var late static void int double bool String if else for while switch case break continue return try catch finally throw new this super null true false async await dynamic',
    ex: 'defmodule defp def do end if else unless case cond for with fn when import alias use require true false nil and or not in receive send',
    hs: 'module import where let in data type newtype class instance deriving do case of if then else',
    clj: 'def defn let fn if do loop recur ns require true false nil',
    lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while',
    erl: 'module export import if case of end fun when receive after try catch throw',
    pl: 'use require package sub my our local if elsif else unless while for foreach last next redo return true false',
    groovy: 'def class interface package import if else for while switch case break continue return new try catch finally throw this super null true false',
    ps1: 'param function if else elseif foreach for while switch return break continue try catch finally throw new class begin process end in filter',
    dockerfile: 'FROM RUN CMD ENTRYPOINT COPY ADD WORKDIR ENV ARG EXPOSE VOLUME USER LABEL HEALTHCHECK SHELL ONBUILD AS',
    graphql: 'query mutation subscription fragment on type input enum interface union schema scalar extend implements',
    proto: 'syntax package import message enum service rpc returns repeated optional required oneof map reserved',
    make: 'ifeq ifneq ifdef ifndef else endif include define endef export unexport override',
  };

  const ALIASES = {
    javascript: 'js', mjs: 'js', cjs: 'js', jsx: 'js', node: 'js',
    typescript: 'ts', tsx: 'ts',
    python: 'py', python3: 'py',
    shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
    rust: 'rs', ruby: 'rb', kotlin: 'kt', kts: 'kt',
    csharp: 'cs', 'c#': 'cs', 'c++': 'cpp', golang: 'go',
    elixir: 'ex', exs: 'ex', haskell: 'hs', clojure: 'clj',
    erlang: 'erl', perl: 'pl', groovy: 'groovy', powershell: 'ps1', pwsh: 'ps1',
    docker: 'dockerfile', protobuf: 'proto', gql: 'graphql',
    yml: 'yaml', scss: 'css', sass: 'css', less: 'css', stylus: 'css',
    toml: 'toml', makefile: 'make', mk: 'make',
    html: 'html', xml: 'html', svg: 'html', vue: 'html', svelte: 'html', astro: 'html',
  };

  const SUPPORTED = new Set(Object.keys(KEYWORDS));

  function normalizeLanguage(lang) {
    const value = String(lang || '').toLowerCase();
    return ALIASES[value] || value;
  }

  function highlight(raw, lang) {
    const language = normalizeLanguage(lang);
    if (!raw) return '';
    if (language === 'diff') {
      return raw.split('\n').map((line) => {
        const cls = line.startsWith('+') ? 'tok-add' : line.startsWith('-') ? 'tok-del' : line.startsWith('@@') ? 'tok-meta' : '';
        return cls ? `<span class="${cls}">${escape(line)}</span>` : escape(line);
      }).join('\n');
    }
    const words = KEYWORDS[language];
    if (!SUPPORTED.has(language) || !words) {
      return escape(raw);
    }
    const hashComment = ['py', 'sh', 'bash', 'rb', 'yml', 'yaml', 'toml', 'r', 'ps1', 'make', 'dockerfile', 'pl'].includes(language);
    const dashComment = ['sql', 'lua'].includes(language);
    const semiComment = ['erl', 'hs'].includes(language);
    const commentGroup = [
      '\\/\\/[^\\n]*',
      '\\/\\*[\\s\\S]*?\\*\\/',
      hashComment ? '#[^\\n]*' : null,
      dashComment ? '--[^\\n]*' : null,
      semiComment ? '--[^\\n]*' : null,
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
