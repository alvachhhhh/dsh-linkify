window.__ModuleLoader__.load({
  id: 'dsh-linkify',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Markdown link: [label](https://…). The label is the visible text.
    const MARKDOWN_LINK = /\[([^\]\n]{1,300})\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/gu;
    // Bare URL: https://… — stops at whitespace, quotes, angle brackets and CJK. A URL glued to
    // the next sentence ("…/how-to-apply/现允许") would otherwise swallow the prose into the href.
    // ponytail: raw CJK inside a URL (unencoded wiki links) is cut too; copy-link encodes it.
    const BARE_URL = /https?:\/\/[^\s<>"'`\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]+/gu;
    const TRAILING_PUNCTUATION = '.,;:!?。，、；：！？';

    // Drop sentence punctuation and an unbalanced closing paren from a bare URL.
    function trimUrl(url) {
      let end = url.length;
      while (end > 0) {
        const ch = url[end - 1];
        if (TRAILING_PUNCTUATION.includes(ch)) {
          end--;
          continue;
        }
        if (ch === ')') {
          const open = (url.match(/\(/gu) ?? []).length;
          const close = (url.match(/\)/gu) ?? []).length;
          if (close > open) {
            end--;
            continue;
          }
        }
        break;
      }
      return url.slice(0, end);
    }

    // User-text rule: the nearest link at or after `from`, as a {id,start,end,data} node.
    const linkRule = {
      id: 'link',
      order: 20,
      match(text, from) {
        MARKDOWN_LINK.lastIndex = from;
        const markdown = MARKDOWN_LINK.exec(text);
        const markdownStart = markdown === null ? Infinity : markdown.index;
        // A bare URL trimmed down to a scheme is not a link; keep scanning instead of
        // reporting "no link here" and dropping every later link in the same text.
        BARE_URL.lastIndex = from;
        for (let bare; (bare = BARE_URL.exec(text)) !== null; ) {
          if (bare.index > markdownStart) break;
          const url = trimUrl(bare[0]);
          if (url.length > 'https://'.length) {
            return { id: 'link', start: bare.index, end: bare.index + url.length, data: { href: url, label: url } };
          }
        }
        if (markdown !== null) {
          return {
            id: 'link',
            start: markdown.index,
            end: markdown.index + markdown[0].length,
            data: { href: markdown[2], label: markdown[1] },
          };
        }
      },
    };

    // Same opening policy as the shipped chat links: right sidebar, else a new tab.
    function openExternal(ctx, url) {
      const right = ctx.get('sidebarRight');
      const tabs = ctx.get('sidebarRightTabs');
      if (right !== undefined && tabs !== undefined && tabs.get('browser') !== undefined) {
        right.openTab('browser', { params: { url } });
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    // The composer is a Lexical plain-text editor: it pastes text/plain only, so every href is
    // dropped — yet the clipboard's text/html still carries them. Keep the pasted text exactly
    // as copied (bullets, line breaks, one copy) and only re-attach its links as markdown.
    const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    const HREF = /\shref\s*=\s*["']([^"']+)["']/i;
    // Icon/image links have no text: their label lives in alt, aria-label or title.
    const LABEL_ATTR = /\s(?:aria-label|alt|title)\s*=\s*["']([^"']*)["']/i;
    const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
    // Named entities plus numeric ones: pages often serialise Chinese as &#23448;&#32593;.
    const decodeEntities = (text) =>
      text.replace(/&(amp|lt|gt|quot|#39|nbsp|#x[0-9a-f]+|#[0-9]+);/gi, (match, key) => {
        if (key[0] !== '#') return ENTITIES[key] ?? match;
        const hex = key[1] === 'x' || key[1] === 'X';
        const code = hex ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      });
    const stripTags = (text) => text.replace(/<[^>]*>/g, '');
    const anchorLabel = (inner) =>
      decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim().replace(/\]/g, ')');

    // Where a visible label ends before hidden a11y text ("Programme (opens in new tab)").
    const LABEL_STOP = /[\s(（\[【〔〈《"“'‘|·・/／\\,，、;；:：–—]/u;
    const ASCII_WORD = /[A-Za-z0-9]/;

    // The anchor label, longest first, then the same label cut before hidden extra text.
    function labelCandidates(label) {
      const out = [label];
      for (let i = label.length - 1; i > 1; i--) {
        if (!LABEL_STOP.test(label[i])) continue;
        const head = label.slice(0, i).trim();
        if (head.length >= 2 && !out.includes(head)) out.push(head);
      }
      return out;
    }

    // A trimmed candidate must not match the head of a longer word ("Pr" in "Programme").
    function cutsWord(text, at, candidate) {
      if (!ASCII_WORD.test(candidate[candidate.length - 1])) return false;
      return ASCII_WORD.test(text[at + candidate.length] || '');
    }

    // First occurrence of `label` that is not already inside a markdown link.
    function findLabel(text, label, from = 0) {
      let at = text.indexOf(label, from);
      while (at !== -1) {
        if (!(text[at - 1] === '[' && text[at + label.length] === ']')) return at;
        at = text.indexOf(label, at + 1);
      }
      return -1;
    }

    // Native apps (TextEdit, Pages, Word, Mail) put RTF on the clipboard instead of HTML, and
    // keep each hyperlink as {\\field{\\*\\fldinst{HYPERLINK "url"}}{\\fldrslt label}}. The plain
    // flavour keeps only the label, so those links must be re-attached from the RTF side.
    const RTF_CODEPAGES = { 936: 'gbk', 950: 'big5', 1252: 'windows-1252', 65001: 'utf-8' };
    const RTF_HREF = /HYPERLINK\s+"([^"\\]+)"/g;

    // RTF text run → plain text: \uN is a decimal UTF-16 unit, \'hh a byte in \ansicpg,
    // control words and groups carry no text.
    function rtfText(source, codepage) {
      const decoder = new TextDecoder(RTF_CODEPAGES[codepage] || 'windows-1252');
      let out = '';
      let bytes = [];
      let skip = 1;
      const flush = () => {
        if (bytes.length > 0) {
          out += decoder.decode(new Uint8Array(bytes));
          bytes = [];
        }
      };
      for (let i = 0; i < source.length; ) {
        const ch = source[i];
        if (ch === '\\') {
          const next = source[i + 1];
          if (next === "'") {
            bytes.push(parseInt(source.slice(i + 2, i + 4), 16));
            i += 4;
            continue;
          }
          if (next === '\\' || next === '{' || next === '}') {
            flush();
            out += next;
            i += 2;
            continue;
          }
          const word = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(source.slice(i));
          if (word === null) {
            i += 2;
            continue;
          }
          flush();
          if (word[1] === 'u') {
            let code = Number(word[2]);
            if (code < 0) code += 65536;
            out += String.fromCharCode(code);
            i += word[0].length;
            // \ucN fallback characters follow each \uN outside of \uc0 runs.
            for (let n = 0; n < skip && i < source.length; n++) i += source[i] === '\\' ? 2 : 1;
            continue;
          }
          if (word[1] === 'uc') skip = Number(word[2] || 1);
          else if (word[1] === 'par' || word[1] === 'line') out += '\n';
          else if (word[1] === 'tab') out += '\t';
          i += word[0].length;
          continue;
        }
        if (ch === '{' || ch === '}') {
          flush();
          i++;
          continue;
        }
        flush();
        out += ch;
        i++;
      }
      flush();
      return out;
    }

    // The text after \fldrslt, up to the closing brace of its destination group.
    function rtfRun(rtf, start) {
      let depth = 0;
      for (let i = start; i < rtf.length; i++) {
        if (rtf[i] === '\\') {
          i++;
          continue;
        }
        if (rtf[i] === '{') depth++;
        else if (rtf[i] === '}') {
          if (depth === 0) return rtf.slice(start, i);
          depth--;
        }
      }
      return rtf.slice(start);
    }

    // Hyperlinks of an RTF clipboard flavour, in document order.
    function rtfLinks(rtf) {
      const codepage = Number((/\\ansicpg(\d+)/.exec(rtf) || [])[1] || 1252);
      const links = [];
      for (const match of rtf.matchAll(RTF_HREF)) {
        const field = rtf.indexOf('\\fldrslt', match.index);
        if (field === -1) continue;
        let start = field + '\\fldrslt'.length;
        while (rtf[start] === ' ') start++;
        const label = rtfText(rtfRun(rtf, start), codepage).replace(/\s+/g, ' ').trim();
        if (label !== '') links.push({ url: match[1].trim(), label });
      }
      return links;
    }

    const fieldToAnchor = ({ url, label }) =>
      `<a href="${url.replace(/"/g, '&quot;')}">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</a>`;

    // A pipe table the bubble can render: header row, a |---| separator, then body rows with
    // the same column count. GFM's rules, no alignment attributes.
    const TABLE_SEPARATOR = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)+\|?[ \t]*$/u;

    function splitCells(line) {
      return line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map((cell) => cell.trim());
    }

    const tableRule = {
      id: 'table',
      order: 10,
      match(text, from) {
        const lines = [];
        for (let at = from; at <= text.length; ) {
          const stop = text.indexOf('\n', at);
          const end = stop === -1 ? text.length : stop;
          lines.push({ start: at, text: text.slice(at, end) });
          if (stop === -1) break;
          at = stop + 1;
        }
        for (let i = 0; i + 1 < lines.length; i++) {
          const header = lines[i];
          const separator = lines[i + 1];
          if (!header.text.includes('|') || !TABLE_SEPARATOR.test(separator.text)) continue;
          const width = splitCells(separator.text).length;
          const head = splitCells(header.text);
          if (width < 2 || head.length !== width) continue;
          const rows = [head];
          let end = separator.start + separator.text.length;
          for (let j = i + 2; j < lines.length; j++) {
            const line = lines[j];
            if (!line.text.includes('|')) break;
            const body = splitCells(line.text);
            if (body.length !== width) break;
            rows.push(body);
            end = line.start + line.text.length;
          }
          return { id: 'table', start: header.start, end, data: { rows } };
        }
      },
    };

    // Office apps and every browser hand a copied table over as cells joined by tabs, so a run of
    // tab-bearing lines becomes the pipe table above, which the bubble then draws as a table.
    function tabTables(text) {
      if (!text.includes('\t')) return text;
      const lines = text.split('\n');
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes('\t')) {
          out.push(lines[i]);
          continue;
        }
        const run = [];
        while (i < lines.length && lines[i].includes('\t')) run.push(lines[i++]);
        i--;
        if (run.length < 2) {
          out.push(...run);
          continue;
        }
        const rows = run.map((line) => line.split('\t').map((cell) => cell.trim().replace(/\|/gu, '\\|')));
        const width = Math.max(...rows.map((row) => row.length));
        const pad = (row) => [...row, ...Array(width - row.length).fill('')];
        const format = (row) => `| ${pad(row).join(' | ')} |`;
        out.push(format(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(format));
      }
      return out.join('\n');
    }

    // Labels copied from a page usually end up as one separator-joined run ("招生｜课程｜费用"),
    // not as prose. Searching for each label's first occurrence in order would then spend the
    // links on the same words inside the sentences ("申请资格", "毕业项目") and leave the run bare,
    // so a run of consecutive anchors is matched as a whole first.
    const RUN_SEP = /\s*[|｜/／、,，·・]\s*/u;

    // A part of the text that starts exactly at `at` with one of the candidates.
    function matchAt(text, candidates, at) {
      for (const candidate of candidates) {
        if (text.startsWith(candidate, at) && !cutsWord(text, at, candidate)) return candidate;
      }
      return undefined;
    }

    // Consecutive anchors whose labels sit in `text` joined only by separators, from `from`.
    // Every occurrence of the first label is tried, because the run is rarely its first one.
    function runFrom(text, entries, start, from) {
      const candidates = labelCandidates(entries[start].label);
      for (const candidate of candidates) {
        for (let at = findLabel(text, candidate, from); at !== -1; at = findLabel(text, candidate, at + 1)) {
          if (cutsWord(text, at, candidate)) continue;
          const parts = [{ index: start, at, candidate }];
          let end = at + candidate.length;
          for (let i = start + 1; i < entries.length; i++) {
            const sep = RUN_SEP.exec(text.slice(end, end + 4));
            if (sep === null || sep.index !== 0) break;
            const next = end + sep[0].length;
            const label = matchAt(text, labelCandidates(entries[i].label), next);
            if (label === undefined) break;
            parts.push({ index: i, at: next, candidate: label });
            end = next + label.length;
          }
          if (parts.length > 1) return parts;
        }
      }
      return undefined;
    }

    // Plain clipboard text + the anchors of its HTML twin → text whose linked labels became
    // [label](url). Returns undefined when there is nothing to re-attach.
    function linkifyPlain(plain, html) {
      if (plain === '') return undefined;
      const linked = /<a\b[^>]*href/iu.test(html);
      const table = /<table\b/iu.test(html);
      if (!linked && !table) return undefined;
      let text = table ? tabTables(plain) : plain;
      let cursor = 0;
      let changed = text !== plain;
      if (!linked) return changed ? text : undefined;
      const entries = [];
      for (const [, attrs, inner] of html.matchAll(ANCHOR)) {
        const href = HREF.exec(attrs);
        if (href === null) continue;
        const url = decodeEntities(href[1].trim());
        if (!/^https?:\/\//i.test(url)) continue;
        // Icon links: the label lives in alt/title/aria-label, on the <a> or on the <img> inside it.
        const attr = LABEL_ATTR.exec(attrs) || LABEL_ATTR.exec(inner);
        const label = anchorLabel(inner) || (attr === null ? '' : anchorLabel(attr[1]));
        if (label === '' || label === url || label.length > 300) continue;
        entries.push({ url, label });
      }
      const skip = new Set();
      for (let i = 0; i < entries.length; i++) {
        if (skip.has(i)) continue;
        // Anchors and their labels come in document order, and "官网"-style labels repeat, so
        // search from the previous insertion; a label that only occurs earlier is a fallback.
        const run = runFrom(text, entries, i, cursor);
        const hit = run === undefined
          ? (() => {
              const candidates = labelCandidates(entries[i].label);
              const pick = (from) =>
                candidates
                  .map((candidate) => ({ candidate, at: findLabel(text, candidate, from) }))
                  .find(({ candidate, at }) => at !== -1 && !cutsWord(text, at, candidate));
              return pick(cursor) ?? pick(0);
            })()
          : undefined;
        const parts = run ?? (hit === undefined ? [] : [{ index: i, at: hit.at, candidate: hit.candidate }]);
        if (parts.length === 0) continue;
        // Right to left, so the earlier offsets stay valid.
        for (const part of [...parts].reverse()) {
          const url = entries[part.index].url;
          text = text.slice(0, part.at) + `[${part.candidate}](${url})` + text.slice(part.at + part.candidate.length);
        }
        const last = parts[parts.length - 1];
        cursor = last.at + `[${last.candidate}](${entries[last.index].url})`.length;
        for (const part of parts) skip.add(part.index);
        changed = true;
      }
      return changed ? text : undefined;
    }

    // Cancel the native paste (it would insert the un-linked copy) and replay one synthetic
    // paste carrying the rewritten text. The editor repaints its DOM asynchronously, so the
    // insertText fallback only fires when nothing landed by the end of the current task.
    function installPasteLinks() {
      const replay = (target, text) => {
        try {
          const data = new DataTransfer();
          data.setData('text/plain', text);
          const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
          Object.defineProperty(event, 'dshLinkify', { value: true });
          target.dispatchEvent(event);
          return true;
        } catch {
          return false;
        }
      };
      const onPaste = (event) => {
        if (event.dshLinkify === true) return;
        const data = event.clipboardData;
        const target = event.target;
        const editable =
          target instanceof HTMLElement &&
          (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');
        if (!editable || data === null) return;
        let source = data.getData('text/html') || '';
        if (!/<a\b[^>]*href/i.test(source)) {
          const rtf = data.getData('text/rtf') || data.getData('application/rtf') || '';
          source = rtf === '' ? '' : rtfLinks(rtf).map(fieldToAnchor).join('');
        }
        const text = linkifyPlain(data.getData('text/plain'), source);
        if (text === undefined) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (target.isContentEditable && replay(target, text)) {
          setTimeout(() => {
            if (target.isConnected && !target.textContent.includes(text)) {
              document.execCommand('insertText', false, text);
            }
          }, 0);
          return;
        }
        document.execCommand('insertText', false, text);
      };
      window.addEventListener('paste', onPaste, true);
    }

    const LINK_STYLE = {
      color: 'inherit',
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
      cursor: 'pointer',
    };

    // Links inside a table cell: the two syntaxes, inline, no block rules.
    function inlineParts(text) {
      const parts = [];
      let last = 0;
      for (;;) {
        MARKDOWN_LINK.lastIndex = last;
        const markdown = MARKDOWN_LINK.exec(text);
        BARE_URL.lastIndex = last;
        const bare = BARE_URL.exec(text);
        const url = bare === null ? undefined : trimUrl(bare[0]);
        const bareAt = url !== undefined && url.length > 'https://'.length ? bare.index : Infinity;
        const markdownAt = markdown === null ? Infinity : markdown.index;
        if (bareAt === Infinity && markdownAt === Infinity) break;
        if (bareAt <= markdownAt) {
          if (bareAt > last) parts.push(text.slice(last, bareAt));
          parts.push({ href: url, label: url });
          last = bareAt + url.length;
        } else {
          if (markdownAt > last) parts.push(text.slice(last, markdownAt));
          parts.push({ href: markdown[2], label: markdown[1] });
          last = markdownAt + markdown[0].length;
        }
      }
      if (last < text.length) parts.push(text.slice(last));
      return parts;
    }

    const CELL_STYLE = {
      border: '1px solid rgba(128, 128, 128, 0.45)',
      padding: '4px 10px',
      textAlign: 'left',
      verticalAlign: 'top',
    };

    function Cell({ text, header, open }) {
      return h(
        header ? 'th' : 'td',
        { style: header ? { ...CELL_STYLE, fontWeight: 600 } : CELL_STYLE },
        ...inlineParts(text).map((part, index) =>
          typeof part === 'string'
            ? part
            : h(
                'a',
                {
                  key: index,
                  href: part.href,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  style: LINK_STYLE,
                  onClick(event) {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    open(part.href);
                  },
                },
                part.label,
              ),
        ),
      );
    }

    function TableText({ node, openExternal: open }) {
      const [header, ...body] = node.data.rows;
      return h(
        'div',
        { style: { maxWidth: '100%', overflowX: 'auto' } },
        h(
          'table',
          { style: { borderCollapse: 'collapse', margin: '6px 0', fontSize: '0.95em' } },
          h('thead', null, h('tr', null, ...header.map((cell, index) => h(Cell, { key: index, text: cell, header: true, open })))),
          body.length === 0
            ? null
            : h(
                'tbody',
                null,
                ...body.map((row, rowIndex) =>
                  h('tr', { key: rowIndex }, ...row.map((cell, index) => h(Cell, { key: index, text: cell, open }))),
                ),
              ),
        ),
      );
    }

    function LinkText({ node, raw, openExternal: open }) {
      const { href, label } = node.data;
      return h(
        'a',
        {
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: raw,
          style: LINK_STYLE,
          onClick(event) {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            open(href);
          },
        },
        label,
      );
    }

    return {
      name: 'dsh-linkify',
      inject: ['slots', 'uiConversation'],
      linkifyPlain,
      rtfLinks,
      tabTables,
      tableRule,
      apply(ctx) {
        ctx.uiConversation.userText.register(tableRule);
        ctx.uiConversation.userText.register(linkRule);
        ctx.slots.inject('conversation.user.text.node', function* () {
          const inject = () => ({ openExternal: (url) => openExternal(ctx, url) });
          yield ctx.slots.register(
            { name: 'conversation.user.text.node', key: 'table', priority: 100, inject },
            TableText,
          );
          yield ctx.slots.register(
            { name: 'conversation.user.text.node', key: 'link', priority: 100, inject },
            LinkText,
          );
        });
        installPasteLinks();
      },
    };
  },
});
