# 贡献指南

感谢你帮助改进 dsh-prompt-enhance！这是一个 [DeepSeek Harness](https://github.com/deepseek-ai) Web 插件：单个 npm 包，包含 Node（宿主）半区与浏览器半区。

[English](./CONTRIBUTING.en.md) | 简体中文

## 环境准备

```bash
git clone https://github.com/ZiYuan258/dsh-prompt-enhance.git
cd dsh-prompt-enhance
npm install
npm test          # 单元 + 真实 HTTP + 组件测试
npm run typecheck
npm run build     # tsc + esbuild → lib/index.js（宿主 ESM）+ lib/client.js（浏览器 ModuleLoader bundle）
```

## 本地调试闭环

```bash
dsh plugin --profile web add link:C:\path\to\dsh-prompt-enhance   # 只需一次
npm run watch                                                     # 持续重建两个半区
# 改动宿主半区代码后需重启 dsh web;改动浏览器半区需要先重建、再刷新页面
```

调试完成后，切回 npm 安装以日常使用：
`dsh plugin --profile web add dsh-prompt-enhance`。

## 硬性规则

- **`lib/` 是提交进仓库的**，这样从 GitHub 安装无需构建步骤。推送前务必跑 `npm run build`——一旦 `lib/` 与 `src/` 不一致，CI 会失败。
- 保持两条「收敛不变量」完整：客户端的输入校验与宿主路由必须经由 `src/shared/` 达成一致；HTTP 路由与 `/enhance` 命令必须都走 `src/orchestrate.ts`。
- 宿主路由**按设计仅限回环访问**（见 README 的安全模型一节）。未经讨论，不要加入绕过鉴权或对外监听的改动。
- 新增用户可见文案必须**同时**写入 `src/client/locales.ts` 的两个字典（**zh 是键集合的权威来源**）。
- 测试：`npx vitest run`——修 bug 时请尽量附一个回归测试。组件测试用 jsdom + React Testing Library 配合假的 input store；宿主路由测试用真实的 `node:http` 服务器配合打桩的 `ctx.llm`。

## 提交

1. 从 `main` 切分支，带着测试一起改。
2. `npm run typecheck && npm test && npm run build` —— 全部通过。
3. 提 PR 说明改了什么、为什么改。
4. 维护者负责发布：打 tag → 在 GitHub 上发 Release。

> **关于 npm**：这个 fork **不向 npm 发布**。`dsh-prompt-enhance` 这个包名归属原作者
> （[`rongxingda`](https://github.com/rongxingda/dsh-prompt-enhance)，npm 上最新为 0.2.1），
> 而 npm 的包所有权与 GitHub fork 是相互独立的。请通过 GitHub 发 Release，
> 不要把本仓库的版本号当作 npm 上已有的版本。