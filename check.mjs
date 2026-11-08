import assert from 'node:assert/strict';

const clicks = [];
const pasted = [];
let rule;
let LinkText;
let plugin;

globalThis.window = {
  __ModuleLoader__: {
    load: ({ factory }) => {
      plugin = factory((id) => {
        if (id === 'react') return { createElement: (type, props, ...children) => ({ type, props, children }) };
        throw new Error(`unexpected require ${id}`);
      });
    },
  },
  addEventListener: (type, fn, capture) => pasted.push({ type, fn, capture }),
};
globalThis.HTMLElement = class {};
const inserted = [];
globalThis.document = { execCommand: (_cmd, _ui, value) => Boolean(inserted.push(value)) };

await import('./client.js');

plugin.apply({
  get: () => undefined,
  uiConversation: { userText: { register: (r) => (rule = r) } },
  slots: {
    inject: (_key, fn) => {
      for (const _ of fn()) void _;
    },
    register: (options, component) => {
      assert.equal(options.key, 'link');
      LinkText = component;
    },
  },
});

assert.equal(rule.id, 'link');
assert.equal(rule.order, 20);

const cases = [
  ['see https://example.com/a?b=1. next', 'https://example.com/a?b=1', 'https://example.com/a?b=1'],
  ['[Docs](https://example.com/docs)', 'Docs', 'https://example.com/docs'],
  ['(https://example.com/x) tail', 'https://example.com/x', 'https://example.com/x'],
  ['链接 https://example.com/路径。', 'https://example.com/路径', 'https://example.com/路径'],
];
for (const [text, label, href] of cases) {
  const node = rule.match(text, 0);
  assert.ok(node, `no match for ${text}`);
  assert.equal(node.id, 'link');
  assert.equal(node.data.label, label);
  assert.equal(node.data.href, href);
  assert.equal(text.slice(node.start, node.end).length, node.end - node.start);
}

assert.equal(rule.match('no links here', 0), undefined);

const paste = pasted.find((entry) => entry.type === 'paste');
assert.ok(paste, 'no paste listener installed');
assert.equal(paste.capture, true);

const conv = plugin.linkifyPlain;
const plain = '查看官网了解';
assert.equal(conv(plain, '<p>查看<a href="https://example.com/a?b=1&amp;c=2">官网</a>了解</p>'), '查看[官网](https://example.com/a?b=1&c=2)了解');
// The paste keeps the clipboard text as-is: no tags, no CSS, no second copy.
const noisy = '<style>p.p1 {margin: 0.0px}</style><p><span>查看</span><a href="https://example.com">官网</a></p>';
assert.equal(conv('查看官网了解', noisy), '查看[官网](https://example.com)了解');
// macOS copies can carry the text twice in html while text/plain has it once: stay at one copy.
assert.equal(
  conv('正文官网', '<p>正文<a href="https://example.com">官网</a></p><ul><li>* 正文官网</li></ul>'),
  '正文[官网](https://example.com)',
);
// Numeric entities in the anchor label are decoded on the way in.
assert.equal(conv('官网', '<a href="https://example.com/x">&#23448;&#32593;</a>'), '[官网](https://example.com/x)');
// Nothing to re-attach: no anchors, relative href, or a label absent from the plain text.
assert.equal(conv('no anchors', '<p>no anchors</p>'), undefined);
assert.equal(conv('rel', '<a href="/relative">rel</a>'), undefined);
assert.equal(conv('别的文字', '<a href="https://example.com">官网</a>'), undefined);

// Hidden a11y text inside an anchor, and icon links with only an alt label, still link.
assert.equal(
  conv('Programme\nFees\nContact us', '<a href="https://e.test/1">Programme <span class="sr">(opens in new tab)</span></a>\n' +
    '<a href="https://e.test/2">Fees<span class="vh">（在新窗口打开）</span></a>\n' +
    '<a href="https://e.test/3"><img alt="Contact us" src="i.png"></a>'),
  '[Programme](https://e.test/1)\n[Fees](https://e.test/2)\n[Contact us](https://e.test/3)',
);
// A short label must not be matched into the middle of a longer word.
assert.equal(conv('Programming', '<a href="https://e.test/1">Prog <span>(more)</span></a>'), undefined);
// Every link in a long paste is linked, not just the first few.
const many = Array.from({ length: 12 }, (_, i) => `链接${i}`).join('\n');
const manyHtml = Array.from({ length: 12 }, (_, i) => `<a href="https://e.test/${i}">链接${i}<span class="vh"> (新窗口)</span></a>`).join('\n');
assert.equal(
  conv(many, manyHtml),
  Array.from({ length: 12 }, (_, i) => `[链接${i}](https://e.test/${i})`).join('\n'),
);
// A degenerate bare URL earlier in the text must not swallow the links after it.
const degenerate = 'https:// 之后 [官网](https://example.com/a)';
const after = rule.match(degenerate, 0);
assert.equal(after.data.href, 'https://example.com/a');

// A pasted link is handed to the editor exactly once: the native paste is cancelled and a
// single synthetic paste carrying the markdown is replayed (no duplicated line).
globalThis.DataTransfer = class {
  setData(type, value) {
    (this.data ??= {})[type] = value;
  }
  getData(type) {
    return this.data?.[type] ?? '';
  }
};
globalThis.ClipboardEvent = class {
  constructor(type, init) {
    this.type = type;
    this.clipboardData = init.clipboardData;
  }
};
const markdown = '查看[官网](https://example.com)了解';
const replayed = [];
const target = new HTMLElement();
target.isContentEditable = true;
target.isConnected = true;
target.textContent = 'before';
target.dispatchEvent = (event) => {
  replayed.push(event);
  target.textContent = markdown;
};
const data = new DataTransfer();
data.setData('text/plain', plain);
data.setData('text/html', '<p>查看<a href="https://example.com">官网</a>了解</p>');
let prevented = 0;
let stopped = 0;
paste.fn({ clipboardData: data, target, preventDefault: () => prevented++, stopImmediatePropagation: () => stopped++ });
assert.equal(prevented, 1, 'native paste must be cancelled');
assert.equal(stopped, 1, 'the native paste must not reach the editor');
assert.equal(replayed.length, 1, 'exactly one insertion');
assert.equal(replayed[0].clipboardData.getData('text/plain'), markdown);
paste.fn(replayed[0]);
assert.equal(replayed.length, 1, 'the synthetic paste is not handled again');

// Nothing landed (editor ignored the synthetic paste) -> one insertText fallback, once.
const deaf = new HTMLElement();
deaf.isContentEditable = true;
deaf.isConnected = true;
deaf.textContent = 'unchanged';
deaf.dispatchEvent = () => {};
paste.fn({ clipboardData: data, target: deaf, preventDefault: () => {}, stopImmediatePropagation: () => {} });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(inserted, [markdown], 'fallback inserts once, and never next to a working replay');
assert.equal(replayed.length, 1);

// A URL that itself contains balanced parens keeps all of it, href included.
const parenText = '[Wiki](https://e.test/Foo_(bar)) done';
const paren = rule.match(parenText, 0);
assert.equal(paren.data.href, 'https://e.test/Foo_(bar)');
assert.equal(paren.data.label, 'Wiki');
assert.equal(parenText.slice(paren.start, paren.end), '[Wiki](https://e.test/Foo_(bar))');

// The pasted text must itself match the link rule.
const pastedNode = rule.match(conv(plain, '<p>查看<a href="https://example.com">官网</a>了解</p>'), 0);
assert.equal(pastedNode.data.label, '官网');
assert.equal(pastedNode.data.href, 'https://example.com');

const text = 'a https://one.test b https://two.test';
const first = rule.match(text, 0);
assert.equal(first.data.href, 'https://one.test');
assert.equal(rule.match(text, first.end).data.href, 'https://two.test');

const node = { data: { href: 'https://x.test', label: 'X' } };
const render = () => LinkText({ node, raw: '[X](https://x.test)', openExternal: (u) => clicks.push(u) });
const anchor = render();
assert.equal(anchor.type, 'a');
assert.equal(anchor.props.href, 'https://x.test');
assert.equal(anchor.props.target, '_blank');
anchor.props.onClick({ button: 0, preventDefault: () => {}, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
assert.deepEqual(clicks, ['https://x.test']);
assert.equal(anchor.props.style.textDecoration, 'underline');

console.log('dsh-linkify check: ok');
