import { useState, useRef, useEffect, useCallback } from 'react'
import { Scale, LayoutDashboard, Settings, Package, History, Warehouse as WarehouseIcon, ChevronDown, Wifi, WifiOff, AlertTriangle } from 'lucide-react'
import { supabase } from './lib/supabase'
import WeighStation from './pages/WeighStation'
import Dashboard from './pages/Dashboard'
import MachineSettings from './pages/MachineSettings'
import RollDetail from './pages/RollDetail'
import Transfer from './pages/Transfer'
import HistoryPage from './pages/History'
import Warehouse from './pages/Warehouse'

type Page = 'weigh' | 'transfer' | 'dashboard' | 'history' | 'warehouse' | 'settings'
type Dept = 'blow' | 'print'

const DEPT_KEY = 'bwp_dept'

export default function App() {
  if (new URLSearchParams(window.location.search).get('roll')) return <RollDetail />

  // dept persist ใน localStorage
  const [dept, setDept] = useState<Dept>(() =>
    (localStorage.getItem(DEPT_KEY) as Dept) ?? 'blow'
  )
  const [page, setPage]               = useState<Page>('weigh')
  const [showDeptMenu, setShowDeptMenu] = useState(false)
  const deptRef = useRef<HTMLDivElement>(null)

  // ── Connection status ─────────────────────────────────────────────────
  type ConnStatus = 'online' | 'offline' | 'checking' | 'slow'
  const [connStatus, setConnStatus] = useState<ConnStatus>('checking')
  const [latency, setLatency]       = useState<number | null>(null)

  const checkConn = useCallback(async () => {
    if (!navigator.onLine) { setConnStatus('offline'); setLatency(null); return }
    setConnStatus('checking')
    const t0 = Date.now()
    try {
      await supabase.from('machine_profiles').select('machine_no').limit(1)
      const ms = Date.now() - t0
      setLatency(ms)
      setConnStatus(ms > 2000 ? 'slow' : 'online')
    } catch {
      setConnStatus('offline')
      setLatency(null)
    }
  }, [])

  useEffect(() => {
    checkConn()
    const interval = setInterval(checkConn, 30_000)
    window.addEventListener('online',  checkConn)
    window.addEventListener('offline', checkConn)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online',  checkConn)
      window.removeEventListener('offline', checkConn)
    }
  }, [checkConn])

  function switchDept(d: Dept) {
    setDept(d)
    localStorage.setItem(DEPT_KEY, d)
    setShowDeptMenu(false)
    setPage('weigh') // reset to weigh when switching dept
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (deptRef.current && !deptRef.current.contains(e.target as Node))
        setShowDeptMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const deptConfig = {
    blow:  { emoji: '🌬', label: 'ฝั่งเป่า',  color: 'bg-blue-600',   badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
    print: { emoji: '🖨', label: 'ฝั่งพิม',  color: 'bg-purple-600', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  }
  const dc = deptConfig[dept]

  const NAV = [
    { key: 'weigh',     label: 'ชั่งน้ำหนัก',   icon: Scale },
    { key: 'transfer',  label: 'โอนเข้าคลัง',   icon: Package },
    { key: 'warehouse', label: 'คลังสินค้า',    icon: WarehouseIcon },
    { key: 'dashboard', label: 'Dashboard',      icon: LayoutDashboard },
    { key: 'history',   label: 'ประวัติผลิต',    icon: History },
    { key: 'settings',  label: 'ตั้งค่าเครื่อง', icon: Settings },
  ] as const

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0f1e]">
      <nav className="flex items-center gap-1 px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0">

        {/* Logo */}
        <div className="flex items-center gap-2 mr-3">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center text-white font-black text-xs">BWP</div>
          <span className="text-white font-bold text-sm hidden sm:block">ระบบชั่งน้ำหนักม้วน</span>
        </div>

        {/* Dept switcher — prominent */}
        <div className="relative mr-3" ref={deptRef}>
          <button onClick={() => setShowDeptMenu(o => !o)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-bold transition-colors ${dc.badge}`}>
            <span>{dc.emoji}</span>
            <span>{dc.label}</span>
            <ChevronDown size={12} className={`transition-transform ${showDeptMenu ? 'rotate-180' : ''}`}/>
          </button>

          {showDeptMenu && (
            <div className="absolute top-full left-0 mt-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden w-52">
              <div className="px-3 py-2 border-b border-slate-800">
                <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold">เลือกฝั่งการผลิต</p>
              </div>
              {(['blow','print'] as const).map(d => {
                const c = deptConfig[d]
                return (
                  <button key={d} onClick={() => switchDept(d)}
                    className={`w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-800 ${dept===d ? 'bg-slate-800/60' : ''}`}>
                    <span className="text-xl">{c.emoji}</span>
                    <div className="text-left">
                      <p className={`font-bold text-sm ${dept===d ? 'text-white' : 'text-slate-300'}`}>{c.label}</p>
                      <p className="text-slate-500 text-[10px]">{d === 'blow' ? 'Blow Section' : 'Print Section'}</p>
                    </div>
                    {dept === d && <span className="ml-auto text-xs text-brand-400">● ใช้งานอยู่</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* divider */}
        <div className="w-px h-5 bg-slate-700 mr-2"/>

        {/* Nav items */}

        {NAV.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setPage(key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              page === key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}>
            <Icon size={14}/> <span className="hidden md:block">{label}</span>
          </button>
        ))}

        {/* Connection status — ชิดขวา */}
        <div className="ml-auto flex-shrink-0">
          <button onClick={checkConn} title={latency ? `${latency}ms` : undefined}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              connStatus === 'online'   ? 'bg-green-500/10 border-green-500/30 text-green-400' :
              connStatus === 'slow'     ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
              connStatus === 'offline'  ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                                         'bg-slate-800 border-slate-700 text-slate-500'
            }`}>
            {connStatus === 'online'  && <><Wifi size={12} className="animate-none"/> <span className="hidden sm:block">ออนไลน์</span> {latency && <span className="opacity-60">{latency}ms</span>}</>}
            {connStatus === 'slow'    && <><AlertTriangle size={12}/> <span className="hidden sm:block">สัญญาณช้า</span> {latency && <span className="opacity-60">{latency}ms</span>}</>}
            {connStatus === 'offline' && <><WifiOff size={12}/> <span className="hidden sm:block">ออฟไลน์</span></>}
            {connStatus === 'checking'&& <><span className="w-2.5 h-2.5 rounded-full bg-slate-500 animate-pulse inline-block"/><span className="hidden sm:block ml-1">กำลังตรวจ...</span></>}
          </button>
        </div>
      </nav>

      <main className="flex-1 overflow-auto">
        {page === 'weigh'     && <WeighStation dept={dept} />}
        {page === 'transfer'  && <Transfer dept={dept} />}
        {page === 'warehouse' && <Warehouse dept={dept} />}
        {page === 'dashboard' && <Dashboard dept={dept} />}
        {page === 'history'   && <HistoryPage dept={dept} />}
        {page === 'settings'  && <MachineSettings dept={dept} />}
      </main>
    </div>
  )
}
