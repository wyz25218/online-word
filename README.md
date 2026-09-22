# online-word

多人实时协同文档编辑器（类 Word）。基于 **Yjs (CRDT) + Tiptap v3 + Hocuspocus**。

当前阶段：**M0 技术验证 Spike** —— 双浏览器实时协同零丢字。

## 环境要求

- Node.js **>= 20**（开发机实测 v22.18.0，`.nvmrc` 锁定 `22`）
- pnpm **>= 9**（实测 9.15.9，通过 corepack 安装）
- 浏览器：Chrome / Edge 最新版

## 安装

```bash
pnpm install --no-frozen-lockfile
```

> 若 pnpm 报 `ERR_PNPM_OUTDATED_LOCKFILE`，加 `--no-frozen-lockfile`（CI 默认 frozen）。
> Windows 下若 TMP 在无写权限盘符，需 `$env:TMP="$env:LOCALAPPDATA\Temp"; $env:TEMP="$env:LOCALAPPDATA\Temp"`。

## 启动（三个服务）

M0 只需两个进程：协同网关 + 前端。

```bash
# 终端 1：协同网关（Hocuspocus，ws://localhost:8080）
pnpm dev:collab

# 终端 2：前端（Vite，http://localhost:5173）
pnpm dev:web
```

## 验证协同

1. 浏览器打开 `http://localhost:5173/?doc=m0-demo-doc`
2. 再开一个标签页打开同一 URL
3. 在任一标签页输入文字，另一标签页实时同步
4. 状态栏显示「在线 2 人」及双方用户名

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev:web` | 启动前端开发服务器 |
| `pnpm dev:collab` | 启动协同网关 |
| `pnpm -r typecheck` | 全仓类型检查 |
| `pnpm --filter @online-word/shared build` | 构建共享类型包 |

## 文档

详见 [`docs/`](./docs/README.md)：架构、技术栈、数据模型、协同核心、实施计划。

## M0 已知限制

- 协同网关为**内存态**，进程重启或所有客户端断开后文档丢失（M1 接入数据库持久化）。
- 无精确远程光标（`@tiptap/extension-collaboration-cursor@3.0.0` 与 `@tiptap/extension-collaboration@3.31.3` 的 plugin key 不兼容），M0 用 awareness 展示在线用户列表，M1 自实现光标插件。
- 前端 provider 直连 `ws://localhost:8080`（Vite WS 代理对 Hocuspocus 二进制协议双向转发不稳），生产由 nginx 反向代理。
