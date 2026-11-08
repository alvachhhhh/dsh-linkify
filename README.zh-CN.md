# dsh-linkify

[English](README.md) · **简体中文**

给 DeepSeek Harness（DSH）客户端加超链接：你在输入框里发的 `[文字](https://…)` 或裸 `https://…` 链接，在自己发出的消息气泡里显示成可点击的文字链接，点击走 DSH 的内置浏览器标签页（没有则 `window.open`）。

另外它修了一个实际问题：从浏览器/微信复制带链接的文字粘进 DSH 时，富文本里的 `href` 会被丢弃，只剩文字。安装后粘贴会自动转成 `[文字](url)`，链接才保得住。

## 行为

- 用户消息里的 `[文字](https://…)`、裸 `https://…` → 下划线的可点击链接
- 从浏览器复制带超链接的文字 → 粘贴时自动转成 `[文字](url)` 再进输入框（只插入一份）
- 输入框本身仍显示 markdown 源码——DSH 的输入框是纯文本编辑器，无法在其中渲染链接
- 助手回答里的链接是 DSH 原生 markdown，与本插件无关

## 安装

插件是标准的 DSH bundle（`package.json` 里的 `dsh.bundle` + `dsh.client`）。DSH 插件市场装 `link:` 本地包会失败（pnpm 会去 registry 重新解析 `@deepseek-ai/dsh-*` 依赖范围），所以手工 link：

```bash
git clone https://github.com/alvachhhhh/dsh-linkify.git ~/Projects/dsh-linkify

P=~/.dsh/profiles/desktop          # 换成你实际使用的 profile
mkdir -p "$P/node_modules"
ln -sfn ~/Projects/dsh-linkify "$P/node_modules/dsh-linkify"

# 1) 依赖里登记
#    package.json -> dependencies: "dsh-linkify": "link:/Users/you/Projects/dsh-linkify"
# 2) bundle 清单里登记
#    package.json -> dsh.profile.bundles 数组加上 "dsh-linkify"
```

改完重启 DSH Desktop。卸载就是把上面两处删掉再重启。

## 开发

```bash
node --check client.js
node check.mjs     # 自带断言，不依赖测试框架
```

`check.mjs` 会核对规则匹配、粘贴转换、粘贴监听器和渲染器点击行为。

## License

MIT
