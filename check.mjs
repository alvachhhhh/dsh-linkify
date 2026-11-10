import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const clicks = [];
const pasted = [];
let rule;
let LinkText;
let plugin;
const rendered = {};

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
      rendered[options.key] = component;
    },
  },
});

LinkText = rendered.link;
assert.equal(rule.id, 'link');
assert.ok(rendered.table, 'table renderer registered');

// A separator-joined run carries the links; the same words inside the sentences must stay plain.
{
  const plain = [
    '- 漏大四毕业项目：至少 25 分钟音乐须公开呈现并录音。',
    '- 官网对高中应届生申请资格有冲突：资格页允许应届，FAQ 却写申请时须高中毕业。项目｜资格｜FAQ',
    '- 专业主页仍保留旧版要求。项目｜当前申请要求',
  ].join('\n');
  const html = [
    '<a href="https://e.test/comp"><span><span>项目</span></span></a>',
    '<a href="https://e.test/qual"><span><span>资格</span></span></a>',
    '<a href="https://e.test/faq"><span><span>FAQ</span></span></a>',
    '<a href="https://e.test/audio"><span><span>项目</span></span></a>',
    '<a href="https://e.test/req"><span><span>当前申请要求</span></span></a>',
  ].join('');
  const out = plugin.linkifyPlain(plain, html);
  assert.ok(out?.includes('毕业项目：'), 'prose 项目 stays plain');
  assert.ok(out?.includes('申请资格有冲突：资格页'), 'prose 资格 stays plain');
  assert.ok(out?.includes('FAQ 却写'), 'prose FAQ stays plain');
  assert.ok(out?.includes('[项目](https://e.test/comp)｜[资格](https://e.test/qual)｜[FAQ](https://e.test/faq)'), 'run linked in order');
  assert.ok(out?.includes('[项目](https://e.test/audio)｜[当前申请要求](https://e.test/req)'), 'second run linked');
}

// Pipe tables: recognised in the text, drawn as a table, and produced from a tab-separated paste.
{
  const TableText = rendered.table;
  const text = '说明如下\n| 专业 | 学制 |\n| --- | --- |\n| 作曲 | 4 年 |\n| 音乐与社会 | 4 年 |\n\n后续说明';
  const table = plugin.tableRule.match(text, 0);
  assert.equal(table.id, 'table');
  assert.equal(table.start, 5);
  assert.deepEqual(table.data.rows, [['专业', '学制'], ['作曲', '4 年'], ['音乐与社会', '4 年']]);
  assert.equal(plugin.tableRule.match('没有表格 | 这里只有一条竖线', 0), undefined);
  assert.equal(plugin.tableRule.match('| a | b |\n| --- |\n| 1 | 2 |', 0), undefined, 'ragged header rejected');

  const opened = [];
  const tree = TableText({ node: table, openExternal: (url) => opened.push(url) });
  const [tableEl] = tree.children;
  assert.equal(tableEl.type, 'table');
  const head = tableEl.children[0];
  assert.equal(head.type, 'thead');
  const body = tableEl.children[1];
  assert.equal(body.children.length, 2);

  // A tab-separated clipboard block becomes a pipe table, so the bubble can draw it.
  const plain = '结论：\n专业\t学制\n作曲\t4 年\n音乐与社会\t4 年\n以上';
  const converted = plugin.linkifyPlain(plain, '<table><tr><td>专业</td><td>学制</td></tr></table>');
  assert.ok(converted.includes('| 专业 | 学制 |\n| --- | --- |\n| 作曲 | 4 年 |\n| 音乐与社会 | 4 年 |'), converted);
  assert.ok(converted.startsWith('结论：\n') && converted.endsWith('\n以上'));

  // Words glued to the header line stay prose; the grid starts at the first pipe.
  const glued = plugin.tableRule.match('缺的表: | a | b |\n| --- | --- |\n| 1 | 2 |', 0);
  assert.equal(glued && glued.start, 5);
  assert.deepEqual(glued.data.rows, [['a', 'b'], ['1', '2']]);

  // The bubble draws tab-separated rows itself, so a paste that never got converted still shows a table.
  const tabbed = '说明：\n专业\t学制\n作曲\t4 年\n以上';
  const tabRule = plugin.tableRule.match(tabbed, 0);
  assert.equal(tabRule && tabRule.id, 'table');
  assert.deepEqual(tabRule.data.rows, [['专业', '学制'], ['作曲', '4 年']]);
  assert.equal(tabRule.start, 4);
  // Indented, ragged tab runs are pasted code, not a table.
  assert.equal(plugin.tableRule.match('  a\tb\n  c\td', 0), undefined);
  assert.equal(plugin.tableRule.match('a\tb\nc\td\te', 0), undefined);
  // A clipboard with tabs but no <table> still converts (Excel for Mac can drop the HTML flavour).
  assert.ok(plugin.linkifyPlain('专业\t学制\n作曲\t4 年', '').includes('| 专业 | 学制 |'));
  assert.equal(plugin.linkifyPlain('  a\tb\n  c\td', ''), undefined, 'indented tabs left alone');

  // Cells keep their links clickable.
  const cell = TableText({
    node: { data: { rows: [['名称'], ['[官网](https://e.test/a)']] } },
    openExternal: (url) => opened.push(url),
  });
  const grid = cell.children[0];
  const td = grid.children[1].children[0].children[0];
  const anchorEl = td.type(td.props).children[0];
  assert.equal(anchorEl.type, 'a');
  anchorEl.props.onClick({ button: 0, preventDefault: () => {} });
  assert.deepEqual(opened, ['https://e.test/a']);
}

// The manifest must declare the DSH runtime it is registered against, or the manager installs it blind.
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
assert.equal(manifest.engines?.dsh, '^0.2.2-0', 'package.json declares engines.dsh');
assert.equal(rule.order, 20);

const cases = [
  ['see https://example.com/a?b=1. next', 'https://example.com/a?b=1', 'https://example.com/a?b=1'],
  ['[Docs](https://example.com/docs)', 'Docs', 'https://example.com/docs'],
  ['(https://example.com/x) tail', 'https://example.com/x', 'https://example.com/x'],
  // Raw CJK ends a bare URL: prose glue is far more common than unencoded CJK paths.
  ['链接 https://example.com/路径。', 'https://example.com/', 'https://example.com/'],
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

// Chinese prose glued straight onto a URL stays prose: it must not enter the href.
// Repeated label ("官网") with hidden a11y text: each anchor must take the next occurrence,
// in document order, so no occurrence is left bare.
const repeatedPlain = '明细见官网。结论：官网\n材料见官网，申请见官网';
const repeatedHtml =
  '<a href="https://e.test/1">官网<span class="sr">（在新窗口打开）</span></a>' +
  '<a href="https://e.test/2">官网</a>' +
  '<a href="https://e.test/3">官网<span class="sr">(opens in new tab)</span></a>' +
  '<a href="https://e.test/4">官网</a>';
assert.equal(
  conv(repeatedPlain, repeatedHtml),
  '明细见[官网](https://e.test/1)。结论：[官网](https://e.test/2)\n材料见[官网](https://e.test/3)，申请见[官网](https://e.test/4)',
);

const glued = '见 https://e.test/a现允许 GPA 3.0，另有 https://e.test/b明确不接受。';
const gluedFirst = rule.match(glued, 0);
assert.equal(gluedFirst.data.href, 'https://e.test/a');
assert.equal(glued.slice(gluedFirst.start, gluedFirst.end), 'https://e.test/a');
assert.equal(rule.match(glued, gluedFirst.end).data.href, 'https://e.test/b');

// TextEdit/Pages/Word only put links in the RTF flavour: the field label must be re-attached.
const rtfFixture = String.raw`{\rtf1\ansi\ansicpg936 {\field{\*\fldinst{HYPERLINK "https://e.test/a"}}{\fldrslt \ul \uc0\u30003 \u35831 \u26448 \u26009 }}\uc0\u65372 {\field{\*\fldinst{HYPERLINK "https://e.test/b"}}{\fldrslt \ul \uc0\u36153 \u29992 }}}`;
const rtfFound = plugin.rtfLinks(rtfFixture);
assert.deepEqual(rtfFound, [
  { url: 'https://e.test/a', label: '申请材料' },
  { url: 'https://e.test/b', label: '费用' },
]);
const rtfAnchors = rtfFound.map(({ url, label }) => `<a href="${url}">${label}</a>`).join('｜');
assert.equal(
  conv('申请材料｜费用', `<p>${rtfAnchors}</p>`),
  '[申请材料](https://e.test/a)｜[费用](https://e.test/b)',
);

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
