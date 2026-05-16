import { useState } from 'react'
import { Scale, LayoutDashboard, Settings, Package, History, Warehouse as WarehouseIcon } from 'lucide-react'
import WeighStation from './pages/WeighStation'
import Dashboard from './pages/Dashboard'
import MachineSettings from './pages/MachineSettings'
import RollDetail from './pages/RollDetail'
import Transfer from './pages/Transfer'
import HistoryPage from './pages/History'
import Warehouse from './pages/Warehouse'

type Page = 'weigh' | 'transfer' | 'dashboard' | 'history' | 'warehouse' | 'settings'


export default function App() {
  // ถ้า URL มี ?roll= ให้แสดงหน้า Roll Detail แทน
  if (new URLSearchParams(window.location.search).get('roll')) {
    return <RollDetail />
  }

  const [page, setPage] = useState<Page>('weigh')

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0f1e]">
      <nav className="flex items-center gap-1 px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2 mr-6">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center text-white font-black text-xs">BWP</div>
          <span className="text-white font-bold text-sm">ระบบชั่งน้ำหนักม้วน</span>
        </div>
        {([
          { key: 'weigh',     label: 'ชั่งน้ำหนัก',  icon: Scale },
          { key: 'transfer',  label: 'โอนเข้าคลัง',  icon: Package },
          { key: 'warehouse', label: 'คลังสินค้า',   icon: WarehouseIcon },
          { key: 'dashboard', label: 'Dashboard',     icon: LayoutDashboard },
          { key: 'history',   label: 'ประวัติผลิต',   icon: History },
          { key: 'settings',  label: 'ตั้งค่าเครื่อง', icon: Settings },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setPage(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              page === key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto">
        {page === 'weigh'     && <WeighStation />}
        {page === 'transfer'  && <Transfer />}
        {page === 'warehouse' && <Warehouse />}
        {page === 'dashboard' && <Dashboard />}
        {page === 'history'   && <HistoryPage />}
        {page === 'settings'  && <MachineSettings />}
      </main>
    </div>
  )
}
