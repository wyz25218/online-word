import { createStore } from 'zustand'

/**
 * 协同连接状态（docs/05 §3：连接状态归 zustand，不进 React state）。
 * 四态由 provider 事件驱动 useCollabDoc 写入：
 * - syncing   连接/同步中（WS 已连但初始同步未完成，或 WS 建连中）
 * - connected 已连接且已同步
 * - offline   WS 断开（自动重连中）
 * - denied    认证被拒（停止重试，等待用户手动重连）
 */
export type CollabStatus = 'syncing' | 'connected' | 'offline' | 'denied'

export interface CollabStoreState {
  status: CollabStatus
  synced: boolean
}

export type CollabStore = ReturnType<typeof createCollabStore>

/**
 * 每篇文档的连接各建一个 store 实例（随 provider 生命周期创建/丢弃），
 * 避免全局单例在文档切换时的状态残留与重置逻辑。
 */
export function createCollabStore() {
  return createStore<CollabStoreState>()(() => ({
    status: 'syncing',
    synced: false,
  }))
}
