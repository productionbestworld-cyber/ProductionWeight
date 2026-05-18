import { useState, useRef, useEffect } from 'react'
import { Scale, LayoutDashboard, Settings, Package, History, Warehouse as WarehouseIcon, ChevronDown } from 'lucide-react'
import WeighStation from './pages/WeighStation'
import Dashboard from './pages/Dashboard'
import MachineSettings from './pages/MachineSettings'
import RollDetail from './pages/RollDetail'
import Transfer from './pages/Transfer'
import HistoryPage from './pages/History'
import Warehouse from './pages/Warehouse'

type Page = 'weigh-blow' | 'weigh-print' | 'transfer' | 'dashboard' | 'history' | 'warehouse' | 'settings'

export default function App() {
  if (new URLSearchParams(window.location.search).get('roll')) {
    return <RollDetail />
  }

  const [page, setPage] = useState<Page>('weigh-blow')
  const [showWeighMenu, setShowWeighMenu] = useState(false)
  const weighRef = useRef<HTMLDivElement>(null)

  // ปิด dropdown เมื่อคลิกข้างนอก
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (weighRef.current && !weighRef.current.contains(e.target as Node)) {
        setShowWeighMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isWeigh = page === 'weigh-blow' || page === 'weigh-print'

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0f1e]">
      <nav className="flex items-center gap-1 px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2 mr-6">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center text-white font-black text-xs">BWP</div>
          <span className="text-white font-bold text-sm">ระบบชั่งน้ำหนักม้วน</span>
        </div>

        {/* ชั่งน้ำหนัก dropdown */}
        <div className="relative" ref={weighRef}>
          <button
            onClick={() => setShowWeighMenu(o => !o)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isWeigh ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}>
            <Scale size={15}/>
            {isWeigh ? (page === 'weigh-blow' ? 'ชั่ง — ฝั่งเป่า' : 'ชั่ง — ฝั่งพิม') : 'ชั่งน้ำหนัก'}
            <ChevronDown size={12} className={`transition-transform ${showWeighMenu ? 'rotate-180' : ''}`}/>
          </button>

          {showWeighMenu && (
            <div className="absolute top-full left-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden w-44">
              <button
                onClick={() => { setPage('weigh-blow'); setShowWeighMenu(false) }}
                className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm transition-colors hover:bg-slate-800 ${page==='weigh-blow' ? 'text-brand-300 font-bold' : 'text-slate-300'}`}>
                <span className="text-lg">🌬</span>
                <div className="text-left">
                  <p className="font-semibold leading-tight">ฝั่งเป่า</p>
                  <p className="text-[10px] text-slate-500">Blow Section</p>
                </div>
                {page==='weigh-blow' && <span className="ml-auto text-brand-400 text-xs">●</span>}
              </button>
              <div className="border-t border-slate-800"/>
              <button
                onClick={() => { setPage('weigh-print'); setShowWeighMenu(false) }}
                className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm transition-colors hover:bg-slate-800 ${page==='weigh-print' ? 'text-brand-300 font-bold' : 'text-slate-300'}`}>
                <span className="text-lg">🖨</span>
                <div className="text-left">
                  <p className="font-semibold leading-tight">ฝั่งพิม</p>
                  <p className="text-[10px] text-slate-500">Print Section</p>
                </div>
                {page==='weigh-print' && <span className="ml-auto text-brand-400 text-xs">●</span>}
              </button>
            </div>
          )}
        </div>

        {/* เมนูอื่น */}
        {([
          { key: 'transfer',  label: 'โอนเข้าคลัง',   icon: Package },
          { key: 'warehouse', label: 'คลังสินค้า',    icon: WarehouseIcon },
          { key: 'dashboard', label: 'Dashboard',      icon: LayoutDashboard },
          { key: 'history',   label: 'ประวัติผลิต',    icon: History },
          { key: 'settings',  label: 'ตั้งค่าเครื่อง', icon: Settings },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setPage(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              page === key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}>
            <Icon size={15}/> {label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-auto">
        {page === 'weigh-blow'  && <WeighStation dept="blow" />}
        {page === 'weigh-print' && <WeighStation dept="print" />}
        {page === 'transfer'    && <Transfer />}
        {page === 'warehouse'   && <Warehouse />}
        {page === 'dashboard'   && <Dashboard />}
        {page === 'history'     && <HistoryPage />}
        {page === 'settings'    && <MachineSettings />}
      </main>
    </div>
  )
}
