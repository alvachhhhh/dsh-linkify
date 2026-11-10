# dsh-linkify

**English** · [简体中文](README.zh-CN.md)

Clickable links in your own chat messages for the DeepSeek Harness (DSH) client: text you send as `[label](https://…)` or a bare `https://…` URL renders as a clickable link inside your own message bubble. Clicks open the built-in browser tab (or `window.open` when that tab is unavailable).

It also fixes a real problem: when you copy link-bearing text from a browser or a chat app into DSH, the rich text's `href` is dropped and only the label survives. With this plugin, pasting converts it to `[label](url)`, so the link survives.

## What it does

- `[label](https://…)` and bare `https://…` in a user message → underlined, clickable link
- Pasting rich text with hyperlinks → converted to `[label](url)` on the way into the composer (inserted exactly once)
- Pasting a table (copied from a page, Excel or Numbers) → its tab-separated rows become a pipe table, and the message bubble renders a real table with clickable cell links
- The composer itself still shows markdown source — DSH's composer is a plain-text editor and cannot render links in place
- Links in assistant replies are native DSH markdown and unrelated to this plugin

## Compatibility

Requires DSH `0.2.2` or newer (`engines.dsh: ^0.2.2-0`). The plugin uses the `conversation.user.text.node` slot, the `uiConversation.userText` rule API and the `sidebarRight` browser tab, all available since `0.2.2`.

## Install

The plugin is a standard DSH bundle (`dsh.bundle` + `dsh.client` in `package.json`). The DSH marketplace cannot install a local `link:` package (pnpm re-resolves the `@deepseek-ai/dsh-*` dependency ranges against the registry), so link it by hand:

```bash
git clone https://github.com/alvachhhhh/dsh-linkify.git ~/Projects/dsh-linkify

P=~/.dsh/profiles/desktop          # use the profile you actually run
mkdir -p "$P/node_modules"
ln -sfn ~/Projects/dsh-linkify "$P/node_modules/dsh-linkify"

# 1) declare the dependency
#    package.json -> dependencies: "dsh-linkify": "link:/Users/you/Projects/dsh-linkify"
# 2) add it to the bundle list
#    package.json -> dsh.profile.bundles: add "dsh-linkify"
```

Restart DSH Desktop after editing. To uninstall, remove both entries and restart.

## Development

```bash
node --check client.js
node check.mjs     # asserts, no test framework
```

`check.mjs` covers rule matching, paste conversion, the paste listener, and the renderer's click behaviour.

## License

MIT
