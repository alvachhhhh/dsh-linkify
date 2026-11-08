window.__ModuleLoader__.load({
  id: 'dsh-linkify',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Markdown link: [label](https://…). The label is the visible text.
    const MARKDOWN_LINK = /\[([^\]\n]{1,300})\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/gu;
    // Bare URL: https://… — stops at whitespace, quotes and angle brackets.
    const BARE_URL = /https?:\/\/[^\s<>"'`]+/gu;
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

    // Plain clipboard text + the anchors of its HTML twin → text whose linked labels became
    // [label](url). Returns undefined when there is nothing to re-attach.
    function linkifyPlain(plain, html) {
      if (plain === '' || !/<a\b[^>]*href/iu.test(html)) return undefined;
      let text = plain;
      let changed = false;
      for (const [, attrs, inner] of html.matchAll(ANCHOR)) {
        const href = HREF.exec(attrs);
        if (href === null) continue;
        const url = decodeEntities(href[1].trim());
        if (!/^https?:\/\//i.test(url)) continue;
        // Icon links: the label lives in alt/title/aria-label, on the <a> or on the <img> inside it.
        const attr = LABEL_ATTR.exec(attrs) || LABEL_ATTR.exec(inner);
        const label = anchorLabel(inner) || (attr === null ? '' : anchorLabel(attr[1]));
        if (label === '' || label === url || label.length > 300) continue;
        const hit = labelCandidates(label)
          .map((candidate) => ({ candidate, at: findLabel(text, candidate) }))
          .find(({ candidate, at }) => at !== -1 && !cutsWord(text, at, candidate));
        if (hit === undefined) continue;
        text = `${text.slice(0, hit.at)}[${hit.candidate}](${url})${text.slice(hit.at + hit.candidate.length)}`;
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
        const text = linkifyPlain(data.getData('text/plain'), data.getData('text/html'));
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
      apply(ctx) {
        ctx.uiConversation.userText.register(linkRule);
        ctx.slots.inject('conversation.user.text.node', function* () {
          yield ctx.slots.register(
            {
              name: 'conversation.user.text.node',
              key: 'link',
              priority: 100,
              inject: () => ({ openExternal: (url) => openExternal(ctx, url) }),
            },
            LinkText,
          );
        });
        installPasteLinks();
      },
    };
  },
});
