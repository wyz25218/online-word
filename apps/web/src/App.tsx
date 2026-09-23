import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { getSession } from './api/client'
import LoginPage from './features/auth/LoginPage'
import DocsListPage from './features/docs/DocsListPage'
import DocEditorPage from './features/docs/DocEditorPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // API 层已有 401 续签重放逻辑，这里避免 query 层重复重试放大错误
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})

/** 未登录跳登录页；登录态存 localStorage（M1 桩阶段，后续迁移 httpOnly cookie） */
function RequireAuth({ children }: { children: ReactNode }) {
  if (getSession() === null) {
    return <Navigate to="/login" replace />
  }
  return children
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DocsListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/docs/:id"
            element={
              <RequireAuth>
                <DocEditorPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
