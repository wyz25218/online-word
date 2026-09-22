# Online Word —— 多人协同文档项目方案

基于 **Yjs + Tiptap** 的类 Word 多人实时协同文档产品技术方案归档。

- 前端框架：**React 18 + TypeScript**
- 包管理：**pnpm（workspace monorepo）**
- 协同内核：**Yjs（CRDT）+ Hocuspocus**
- 编辑器：**Tiptap v3（ProseMirror 内核）**

---

## 文档索引

| 文档 | 内容 | 阅读对象 |
|---|---|---|
| [01-architecture.md](./01-architecture.md) | 架构铁律、系统拓扑、模块职责、读写/离线数据流 | 全员 |
| [02-tech-stack.md](./02-tech-stack.md) | 技术选型、版本锁定策略、pnpm monorepo 结构 | 全员 |
| [03-data-model.md](./03-data-model.md) | PostgreSQL DDL、快照+增量存储、压缩与搜索 | 后端 |
| [04-collab-core.md](./04-collab-core.md) | Yjs/Hocuspocus 核心链路、鉴权、分布式锁、Presence、版本恢复 | 协作/后端 |
| [05-frontend-react.md](./05-frontend-react.md) | React 目录结构、组件树、hooks、状态管理、已知坑 | 前端 |
| [06-backend-api.md](./06-backend-api.md) | NestJS 模块划分、API 清单、JWT、导入导出 | 后端 |
| [07-features-roadmap.md](./07-features-roadmap.md) | M0~M4 功能实施顺序、依赖、验收标准、排期 | 全员/PM |
| [08-quality-ops.md](./08-quality-ops.md) | 并发回归用例、CI 门禁、监控、部署、风险登记册 | 全员/运维 |
| [09-implementation-plan.md](./09-implementation-plan.md) | **执行底账**：M0-M4 任务级 TODO 清单（文件/命令/验收勾选）、估时、门禁、进度日志 | 全员 |

---

## 项目目标与非目标

### 目标
1. 浏览器内类 Word 富文本编辑，支持标题/列表/表格/图片/代码块/评论等常用能力。
2. 多人实时协同：多人同写零丢字、远程光标与在线状态、弱网/断线重连、离线编辑后自动追上。
3. 版本历史与回滚、.docx 导入导出、细粒度权限与链接分享。
4. 支持横向扩展的生产级部署（网关多实例、大文档、50+ 人同房间）。

### 非目标（明确不做，避免范围蔓延）
- 不追求 100% Word 排版引擎还原（分页渲染、域代码、VBA）；高保真需求通过导入导出服务解决。
- M0/M1 不做移动端原生 App（响应式 Web 兜底）。
- 不做 P2P/WebRTC 传输（CRDT 架构上保留可能性，但不列入排期）。
- 不自研 OT/transform 算法，不自研 diff-patch 同步。

---

## 关键决策记录（ADR 摘要）

| # | 决策 | 备选 | 结论理由 |
|---|---|---|---|
| ADR-01 | 协同算法选 **CRDT（Yjs）** | OT（ShareDB）、成品套件（ONLYOFFICE） | 正确性由库保证、离线/弱网体验最好、生态成熟、研发成本适中。详见会话选型分析 |
| ADR-02 | 协作文档主干为 **Y.XmlFragment**（Tiptap 官方绑定） | 自定义 Y.Map/Y.Array 文档树 | 自定义结构与 y-prosemirror 不兼容，光标/选区/节点同步全部失效；块表只能做业务索引，不能替代协作文档结构 |
| ADR-03 | **单一写入口**：协作网关只写二进制表，业务表只由业务后端写 | 协作服务直写业务库 | 双服务直写同一业务表必然产生数据竞争与覆盖写 |
| ADR-04 | 持久化采用 **快照 + 增量 update（Event Sourcing）** | 定时全量覆盖 | 全量 upsert 在并发下丢数据；增量追加 + 阈值压缩是 Yjs 生产标准模式 |
| ADR-05 | 前端 **React 18**，编辑器 **Tiptap v3 精确版本锁定** | Vue3、Tiptap v2 | 用户指定 React；v3 为当前稳定线；所有 `@tiptap/*` 与 yjs 相关包禁止 `^/~`，由 pnpm catalog 统一锁版本 |
| ADR-06 | 工程形态 **pnpm workspace monorepo**（web / server / collab / shared） | 单仓库单应用 | 协作网关与业务后端独立进程、独立扩缩容；shared 包共享类型 |
| ADR-07 | M0 阶段**不引入** simple-git-hooks/husky 等 prepare 钩子 | 安装即装 hooks | Windows + pnpm 环境下 prepare hook 配置缺失会阻断所有成员安装依赖；待 CI 稳定后再以独立任务接入 |
| ADR-08 | 图片/附件存对象存储，**Y.Doc 内只存引用 URL** | 二进制入文档 | 附件进 CRDT 会导致文档状态膨胀、广播带宽爆炸 |
| ADR-09 | .docx 高保真转换走 **LibreOffice headless / Pandoc 服务端转换** | 自研 OOXML 映射 | 排版引擎是无底洞；服务端转换投入产出比最高 |

---

## 当前阶段

**尚未开工，待启动 M0（技术验证 Spike，预计 1 周）。**
M0 准入：本机 Node.js 20 LTS+、pnpm 9+、Docker（用于 Postgres/Redis/MinIO，M1 使用）。
