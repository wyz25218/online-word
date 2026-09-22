# 05 · React 前端落地方案（apps/web）

## 1. 目录结构

```
apps/web/
├─ index.html
├─ vite.config.ts
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx                       # 路由壳 + 全局 QueryClient
│  ├─ routes/
│  │  ├─ doc-list.page.tsx          # 文档列表/最近打开
│  │  ├─ editor.page.tsx            # 协同编辑页（/doc/:id）
│  │  └─ login.page.tsx
│  ├─ features/
│  │  ├─ auth/                      # token 获取/刷新
│  │  ├─ docs/                      # 文档 CRUD（react-query hooks）
│  │  ├─ editor/
│  │  │  ├─ EditorShell.tsx         # 页面骨架：头/工具栏/正文/侧栏
│  │  │  ├─ RichTextEditor.tsx      # useEditor 唯一持有者
│  │  │  ├─ Toolbar/                # 按格式分组的工具条（分阶段扩充）
│  │  │  ├─ extensions/             # 自定义扩展：CommentMark、上传插件等
│  │  │  ├─ hooks/
│  │  │  │  ├─ useCollabDoc.ts      # Y.Doc + IndexedDB + Provider 生命周期
│  │  │  │  ├─ useTiptapEditor.ts   # 创建/销毁 editor，扩展装配
│  │  │  │  ├─ useAwarenessUsers.ts # 在线用户（按 userId 去重聚合）
│  │  │  │  ├─ useConnectionStatus.ts
│  │  │  │  └─ useReadOnlyByRole.ts
│  │  │  └─ plugins/
│  │  │     ├─ imageUpload.ts       # 拖拽/粘贴图片拦截 → 签名直传
│  │  │     └─ docxPaste.ts         # 粘贴 Word 内容清洗（M2）
│  │  ├─ comments/                  # 评论侧栏/锚点高亮/线程
│  │  ├─ revisions/                 # 版本历史面板与预览
│  │  ├─ share/                     # 分享/权限面板
│  │  └─ presence/                  # 头像组、远程光标由扩展自带
│  ├─ shared/                       # 前端通用：api client、取色、常量
│  └─ styles/
└─ package.json
```

---

## 2. 页面与组件树

```
<EditorPage>                         # 路由参数 docId；react-query 拉元数据/权限
 └─ <EditorShell>
     ├─ <Header>
     │   ├─ 文档标题（失焦保存，PATCH /docs/:id）
     │   ├─ <ConnectionBadge/>      # connected/syncing/offline/无权限
     │   ├─ <PresenceAvatars/>      # awareness 聚合
     │   └─ 操作：分享 / 历史 / 更多（导入导出）
     ├─ <Toolbar/>                  # editor.chain().focus()... 命令集合
     ├─ <RichTextEditor/>           # EditorContent；useEditor 单例
     └─ <RightPanel>（按需挂载）
         ├─ <CommentsPanel/>
         ├─ <RevisionsPanel/>
         └─ <SharePanel/>
```

编辑页加载顺序：
1. 路由进入，先拿元数据与我的角色（无权限直接渲染无权限态，**不建立 WS**）。
2. 元数据就绪后挂载 `RichTextEditor`（编辑器实例与 docId 1:1）。
3. 切换 docId 必须整体卸载重建编辑器（key={docId}），禁止复用 Y.Doc。

---

## 3. 状态管理边界

| 状态 | 归属 | 说明 |
|---|---|---|
| 文档内容 | Y.Doc / ProseMirror | 不进 React state，不进 zustand |
| 工具栏按钮 active/禁用 | `useEditorState(editor, ...)` 从 editor 派生 | 不订阅整份文档 state，避免重渲染风暴 |
| 连接状态、在线用户、当前角色 | zustand（`useCollabStore`） | 由 provider/awareness 事件写入 |
| 文档列表、评论线程的服务端视图、权限列表 | react-query（REST） | 评论本地实时视图来自 Y.Doc，服务端数据用于通知/未读 |
| 临时 UI（面板开关、弹层） | 组件局部 state | |

---

## 4. 核心 hooks 设计

### 4.1 useCollabDoc —— Y.Doc / Provider / IndexedDB 生命周期

```ts
export interface CollabHandles {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  status: StoreApi<CollabState>      // zustand 切片
}

export function useCollabDoc(docId: string, me: AwarenessUser): CollabHandles | null {
  // ★ useRef 持有，严格模式双挂载时保证同一次渲染周期内单例
  const ref = useRef<CollabHandles | null>(null)
  if (!ref.current) {
    const ydoc = new Y.Doc({ gc: true })
    new IndexeddbPersistence(docId, ydoc)        // 先本地后网络
    const provider = new HocuspocusProvider({
      url: `${import.meta.env.VITE_COLLAB_URL}/collaboration`,
      name: docId,
      document: ydoc,
      token: awaitToken,                          // 支持异步刷新的函数
      onAuthenticated() { /* 写 store */ },
      onAuthenticationFailed() { store.setState({ denied: true }) },
      onStatus({ status }) { store.setState({ online: status === 'connected' }) },
      onSynced() { store.setState({ synced: true }) },
    })
    bindAwareness(provider, me)                   // 注入 user、定时 lastUpdate
    ref.current = { ydoc, provider, status: store }
  }
  useEffect(() => () => {
    ref.current?.provider.destroy()               // ★ 卸载必须销毁
    ref.current?.ydoc.destroy()
    ref.current = null
  }, [])
  return ref.current
}
```

### 4.2 useTiptapEditor —— 扩展装配

```ts
export function useTiptapEditor(handles: CollabHandles | null, canWrite: boolean) {
  return useEditor({
    editable: canWrite,
    extensions: [
      StarterKit.configure({ history: false }),  // ★ 协同必须关闭自带历史
      Placeholder.configure({ placeholder: '开始输入…' }),
      Collaboration.configure({ document: handles.ydoc, field: 'prosemirror' }),
      CollaborationCursor.configure({
        provider: handles.provider,
        user: { name: handles.user.name, color: handles.user.color, avatar: handles.user.avatar },
      }),
      // M2 起在此追加 Image/Table/CommentMark…，一次只加一类扩展
    ],
    editorProps: {
      handlePaste, handleDrop,                    // 图片/Word 粘贴统一拦截
    },
  }, deps) // 依赖：[handles, canWrite]；内部用 immediatelyRender 选项规避 SSR 无关问题
}
```

注意（React 18 StrictMode）：
- 开发环境严格模式会双调用 effect，必须保证 `provider.destroy()` 与 `ydoc.destroy()` 在 cleanup 中被调用，否则出现"幽灵连接"（自己看到两个自己、update 重复广播）。
- Tiptap React 适配层的 `useEditor` 内部已处理编辑器销毁；但**应用自管的 Y.Doc/Provider 需要自己对称销毁**，这是本项目最容易漏掉的点。
- 不要在组件渲染期创建 Y.Doc 之外的副作用；所有绑定都在 ref 初始化与 effect 中完成。

### 4.3 useAwarenessUsers

```ts
function useAwarenessUsers(provider: HocuspocusProvider) {
  const [users, setUsers] = useState<AwareUser[]>([])
  useEffect(() => {
    const aw = provider.awareness
    const collect = () => {
      const map = new Map<string, AwareUser>()
      aw.getStates().forEach((s) => {
        if (!s.user) return
        const prev = map.get(s.user.userId)
        // 同 userId 多标签页聚合：保留最近更新的一条光标
        if (!prev || s.lastUpdate > prev.lastUpdate) map.set(s.user.userId, s)
      })
      setUsers([...map.values()])
    }
    aw.on('change', collect); collect()
    return () => { aw.off('change', collect) }
  }, [provider])
  return users
}
```

### 4.4 只读联动
```ts
useEffect(() => {
  editor?.setEditable(role === 'owner' || role === 'editor')
}, [editor, role])
```
被踢下线时 store 中 `denied=true`：弹提示 → 停止重试（`provider.disconnect()`）→ 跳转申请权限页。

---

## 5. 工具栏（命令映射，分阶段）

- M1 只做：粗体/斜体/删除线、H1-H3、有序/无序列表、引用、撤销/重做（绑定 y undoManager）。
- 命令统一写法：`onClick={() => editor.chain().focus().toggleBold().run()}`；active 态用 `editor.isActive('bold')`。
- 工具栏不持有文档内容，仅持有 editor 引用；避免把 editor 放进 zustand（引用易变、难控订阅）。

---

## 6. 图片/附件上传（M2）

统一入口，粘贴/拖入/点工具栏三处收敛到同一逻辑：
```
拦截文件（File）
 → POST /upload/sign 拿到 { objectKey, uploadUrl, publicUrl }
 → PUT uploadUrl 直传 MinIO/S3
 → POST /docs/:id/attachments 登记元数据
 → editor.chain().focus().insertImage({ src: publicUrl, attachmentId }).run()
失败：在文档原位插入"上传失败"占位节点（不要静默丢图），支持重试。
```
- 文档节点数据：`{ src: url, attachmentId, width, height, alt }`，**不含任何二进制**。
- 粘贴板中同时存在 HTML/Word 与图片时：图片优先走上传，HTML 走 docx 清洗插件。

---

## 7. 中文输入法（IME）专项

- y-prosemirror / ProseMirror 版本中曾存在 composition 期间被远端更新打断导致拼音拆散的问题；M0 必须用例覆盖（见 08 测试清单）。
- 锁定兼容版本组合后写入 catalog；不允许单独升级其中一个包。
- 远程光标移动不得在 `compositionstart~compositionend` 期间强制 `editor.view.focus()` 或滚动到选区。

---

## 8. 样式与交互

- Tailwind 预设 A4 阅读宽度（max-w-[820px]）居中文档卡片，类"文档"体验；代码块/表格/图片在卡片内自适应。
- 远程光标颜色取色板 12 色，按 `hash(userId) % 12` 稳定分配；光标上方小名牌展示 name。
- 连接状态条三态文案：已同步 / 同步中（网络重连）/ 连接已断开（权限失效，红色）。
- 评论锚点 hover 高亮 + 点击定位右侧线程；resolved 标记灰色下划线。

---

## 9. 前端已知坑清单（开发时逐条对照）

1. StarterKit `history:false` 忘记关 → 撤销掉别人的字。
2. Provider/Y.Doc 未在 unmount 销毁 → StrictMode 双连接。
3. 在 sync 前手动 setContent → 空内容覆盖远端。
4. 切换文档复用同一 Y.Doc → 两篇文档内容串台；用 `key={docId}` 强重建。
5. 工具栏订阅 `editor.state` 整对象 → 每次按键全量重渲染；用 Tiptap 的 `useEditorState` 选择器按需订阅。
6. 图片转 base64 塞节点 → 文档体积爆炸、广播卡顿；必须直传存 URL。
7. 评论位置存数字 offset → 并发编辑后锚点漂移；必须用 mark 跟随内容。
8. Tiptap 相关包版本不一致（一个 3.x 一个 2.x）→ 运行时 schema 报错；全部走 catalog 同版本。
9. 自定义命令参数用 `Record<string, unknown>` → strict 下类型报错；定义专用 Options 接口并给默认值。
10. 数组/对象索引直接使用 → `noUncheckedIndexedAccess` 报错；局部变量 + 空值守卫。
