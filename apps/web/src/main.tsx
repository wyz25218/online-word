import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// M0 不启用 StrictMode，避免 Y.Doc/Provider 双挂载带来的额外复杂度；
// M1 引入 zustand 后再开启 StrictMode 并验证对称销毁。
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
