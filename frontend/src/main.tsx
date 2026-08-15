import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { App } from './App'
import { AdminPanel } from './ui/admin/AdminPanel'
import { Privacy } from './ui/Privacy'
import { HowToPlay } from './ui/HowToPlay'
import { startPersistence } from './application/persistence'
import './styles.css'

// 保存の復元と購読を、React が立ち上がる前に一度だけ始める。
// ストアは永続化を知らず、こちらがストアを購読する（依存の向きを内向きに保つ）。
startPersistence()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/how-to" element={<HowToPlay />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
