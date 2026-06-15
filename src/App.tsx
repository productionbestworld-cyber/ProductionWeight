import { useState, useRef, useEffect, useCallback } from 'react'
import { Scale, LayoutDashboard, Settings, Package, History, Warehouse as WarehouseIcon, ChevronDown, Wifi, WifiOff, AlertTriangle, Lock, Search, Boxes, CalendarClock } from 'lucide-react'
import { supabase } from './lib/supabase'
import WeighStation from './pages/WeighStation'
import Dashboard from './pages/Dashboard'
import MachineSettings from './pages/MachineSettings'
import RollDetail from './pages/RollDetail'
import Transfer from './pages/Transfer'
import HistoryPage from './pages/History'
import Warehouse from './pages/Warehouse'
import Admin, { PinGate, DeptPinGate, isAdminUnlocked, isDeptUnlocked, lockAllDepts, lockAdmin } from './pages/Admin'
import ReviewQueue from './pages/ReviewQueue'
import ProductsPage from './pages/Products'
import Planning from './pages/Planning'
import CombinedDashboard from './pages/CombinedDashboard'
import { APP_VERSION, APP_BUILD_DATE, CHANGELOG } from './version'

type Page = 'weigh' | 'transfer' | 'dashboard' | 'history' | 'warehouse' | 'settings' | 'admin' | 'review' | 'nc' | 'products' | 'planning' | 'combined'
type Dept = 'blow' | 'print' | 'rewind'

const DEPT_KEY = 'bwp_dept'

// ล็อกทุกแผนก + Admin ตอนโหลดแอปครั้งแรก → บังคับใส่ PIN ทุกครั้งที่เปิด/รีโหลด
lockAllDepts()
lockAdmin()

export default function App() {
  if (new URLSearchParams(window.location.search).get('roll')) return <RollDetail />

  // ── หน้าแดชบอร์ดแบบลิงก์แยก (เปิดเต็มจอ ไม่ต้องผ่านเมนูชั่ง) ──
  // เปิดผ่าน ...?dashboard=1  หรือ  ...#dashboard
  {
    const sp = new URLSearchParams(window.location.search)
    const path = window.location.pathname.replace(/\/+$/, '').toLowerCase()
    const isDash = sp.get('dashboard') !== null
      || window.location.hash.replace('#', '').toLowerCase() === 'dashboard'
      || path === '/dashboard'
    if (isDash) {
      const d = sp.get('dept') as ('blow'|'print'|'rewind'|null)
      return (
        <div className="min-h-screen bg-[#0a0f1e]">
          <div className="bg-slate-900 border-b border-slate-800 px-5 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="BWP" className="w-8 h-8 rounded-full object-cover"/>
              <span className="text-white font-bold text-sm">Dashboard — ระบบชั่งน้ำหนักม้วน</span>
            </div>
            <a href="/" className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1.5">
              ← กลับหน้าหลัก
            </a>
          </div>
          <div className="p-4">
            <Dashboard dept={d ?? undefined} />
          </div>
        </div>
      )
    }
  }

  // ── ลิงก์แยก: รวมเทียบทั้งปี (เก่า+ใหม่) — ...?combined=1 หรือ /combined ──
  {
    const sp = new URLSearchParams(window.location.search)
    const path = window.location.pathname.replace(/\/+$/, '').toLowerCase()
    const isCombined = sp.get('combined') !== null
      || window.location.hash.replace('#', '').toLowerCase() === 'combined'
      || path === '/combined'
    if (isCombined) {
      return (
        <div className="min-h-screen bg-[#0a0f1e]">
          <div className="bg-slate-900 border-b border-slate-800 px-5 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="BWP" className="w-8 h-8 rounded-full object-cover"/>
              <span className="text-white font-bold text-sm">รวมเทียบทั้งปี (เก่า + ใหม่)</span>
            </div>
            <a href="/" className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1.5">← กลับหน้าหลัก</a>
          </div>
          <CombinedDashboard />
        </div>
      )
    }
  }

  // dept persist ใน localStorage
  const [dept, setDept] = useState<Dept>(() =>
    (localStorage.getItem(DEPT_KEY) as Dept) ?? 'blow'
  )
  const [page, setPage]               = useState<Page>('weigh')
  const [weighKey, setWeighKey]       = useState(0)
  const [showDeptMenu, setShowDeptMenu] = useState(false)
  const [pinTarget, setPinTarget] = useState<Page | null>(null)  // หน้าที่ต้องใส่ PIN ก่อนเข้า
  const [pendingDept, setPendingDept] = useState<Dept | null>(null)

  // ── เข้าครั้งแรก: แสดงหน้าเลือกแผนก (profile select) ──────────────
  const [showDeptSelect, setShowDeptSelect] = useState(true)
  const [showAbout, setShowAbout] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)   // มีเวอร์ชันใหม่บนเซิร์ฟเวอร์

  // เช็คเวอร์ชันใหม่: ดึง /version.json (กัน cache) เทียบกับที่รันอยู่ — ทุก 2 นาที + ตอนกลับมาโฟกัส
  useEffect(() => {
    let alive = true
    async function check() {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json()
        if (alive && j.version && j.version !== APP_VERSION) setUpdateReady(true)
      } catch { /* ออฟไลน์ — ข้าม */ }
    }
    check()
    const iv = setInterval(check, 120000)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => { alive = false; clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [])
  const [showDeptGate, setShowDeptGate] = useState(false) // จะเปิดหลังเลือกแผนก
  const deptRef = useRef<HTMLDivElement>(null)

  // ── Connection status ─────────────────────────────────────────────────
  type ConnStatus = 'online' | 'offline' | 'checking' | 'slow'
  const [connStatus, setConnStatus] = useState<ConnStatus>('checking')
  const [latency, setLatency]       = useState<number | null>(null)

  // ── Badge นับม้วนรอพิจารณา (แจ้งเตือนเมื่อมี NC / ม้วนกรอรอตรวจ) ──────────
  const [reviewBadge, setReviewBadge] = useState(0)  // ผลิตประเมิน (พิจารณาม้วนกรอ)
  const [ncBadge, setNcBadge]         = useState(0)  // NC จริง (คลัง/QC)
  const loadBadges = useCallback(async () => {
    const { data } = await supabase.from('production_rolls')
      .select('section, inbound_type, remark')
      .eq('review_status', 'pending_review')
    const rows = (data ?? []).filter(r => (r.section ?? 'blow') === dept)
    const isNC = (r: any) =>
      r.inbound_type === 'warehouse_damage' || r.inbound_type === 'qc_reject' ||
      (r.remark || '').includes('แจ้ง NC จากคลัง')
    setNcBadge(rows.filter(isNC).length)
    setReviewBadge(rows.filter(r => !isNC(r)).length)
  }, [dept])
  useEffect(() => {
    loadBadges()
    const t = setInterval(loadBadges, 20_000)
    return () => clearInterval(t)
  }, [loadBadges, page])
  const badges: Record<string, number> = { review: reviewBadge, nc: ncBadge }

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
    setShowDeptMenu(false)
    if (d === dept) return
    // ล็อกแผนกเก่าทั้งหมด แล้วบังคับ PIN ของแผนกใหม่
    lockAllDepts()
    if (isDeptUnlocked(d)) {
      setDept(d); localStorage.setItem(DEPT_KEY, d); setPage('weigh')
    } else {
      setPendingDept(d)
    }
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
    blow:   { emoji: '🌬', label: 'ผลิต(เป่า)',    color: 'bg-blue-600',   badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40',   sub: 'Blow Section' },
    print:  { emoji: '🖨', label: 'ผลิต(พิมพ์)',  color: 'bg-purple-600', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40', sub: 'Print Section' },
    rewind: { emoji: '🔁', label: 'กรอ(Rework)',  color: 'bg-green-700',  badge: 'bg-green-500/20 text-green-300 border-green-500/40',   sub: 'Rework Section' },
  }
  const dc = deptConfig[dept]

  const NAV = ([
    { key: 'weigh',         label: 'ชั่งน้ำหนัก', icon: Scale,           depts: ['blow','print','rewind'] },
    { key: 'transfer',  label: 'โอนเข้าคลัง',   icon: Package,         depts: ['blow','print','rewind'] },
    { key: 'warehouse', label: 'คลังสินค้า',    icon: WarehouseIcon,   depts: ['blow','print','rewind'] },
    { key: 'dashboard', label: 'Dashboard',      icon: LayoutDashboard, depts: ['blow','print','rewind'] },
    { key: 'combined',  label: 'รวมเทียบทั้งปี',  icon: LayoutDashboard, depts: ['blow','print','rewind'] },
    { key: 'planning',  label: 'วางแผน',         icon: CalendarClock,   depts: ['blow','print','rewind'] },
    { key: 'history',   label: 'ประวัติผลิต',    icon: History,         depts: ['blow','print','rewind'] },
    { key: 'products',  label: 'คลังข้อมูล',     icon: Boxes,           depts: ['blow','print','rewind'] },
    { key: 'review',    label: 'พิจารณาม้วนกรอ', icon: Search,         depts: ['blow','print','rewind'] },
    { key: 'nc',        label: 'NC (คลัง/QC)',   icon: AlertTriangle,   depts: ['blow','print','rewind'] },
    { key: 'settings',  label: 'ตั้งค่าเครื่อง', icon: Settings,        depts: ['blow','print','rewind'] },
  ] as const).filter(n => (n.depts as readonly string[]).includes(dept))

  // หน้าที่ต้องล็อกด้วย PIN ผจก (เฉพาะ ผจก เข้าได้)
  const LOCKED_PAGES: Page[] = ['review', 'nc', 'admin']
  function goPage(target: Page) {
    if (LOCKED_PAGES.includes(target) && !isAdminUnlocked()) { setPinTarget(target); return }
    setPage(target)
  }
  function gotoAdmin() { goPage('admin') }

  // ── หน้าเลือกแผนก (Profile Select) ─────────────────────────────────
  if (showDeptSelect) {
    return (
      <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          {/* Logo */}
          <div className="text-center mb-8">
            <img src="/logo.png" alt="BWP" className="w-20 h-20 rounded-full object-cover mx-auto mb-4 shadow-lg shadow-brand-600/30"/>
            <h1 className="text-white text-2xl font-bold">ระบบชั่งน้ำหนักม้วน</h1>
            <p className="text-slate-500 text-sm mt-1">เลือกแผนกเพื่อเข้าสู่ระบบ</p>
          </div>

          {/* Department cards */}
          <div className="space-y-3">
            {(['blow','print','rewind'] as const).map(d => {
              const c = deptConfig[d]
              const borderColors = {
                blow: 'border-blue-500/40 hover:border-blue-400 hover:shadow-blue-500/20',
                print: 'border-purple-500/40 hover:border-purple-400 hover:shadow-purple-500/20',
                rewind: 'border-green-500/40 hover:border-green-400 hover:shadow-green-500/20',
              }
              const bgColors = {
                blow: 'bg-blue-500/5 hover:bg-blue-500/10',
                print: 'bg-purple-500/5 hover:bg-purple-500/10',
                rewind: 'bg-green-500/5 hover:bg-green-500/10',
              }
              return (
                <button key={d}
                  onClick={() => {
                    setDept(d)
                    localStorage.setItem(DEPT_KEY, d)
                    setShowDeptGate(true) // ถามPINหลังเลือกแผนก (ยังไม่ปิดหน้าเลือก จนกว่าPINจะผ่าน)
                  }}
                  className={`w-full flex items-center gap-4 px-6 py-5 rounded-2xl border-2 ${borderColors[d]} ${bgColors[d]} transition-all duration-200 hover:shadow-lg group`}>
                  <span className="text-4xl group-hover:scale-110 transition-transform">{c.emoji}</span>
                  <div className="text-left flex-1">
                    <p className="text-white font-bold text-lg">{c.label}</p>
                    <p className="text-slate-500 text-xs">{c.sub}</p>
                  </div>
                  <span className="text-slate-600 group-hover:text-slate-400 text-sm transition-colors">เข้าสู่ระบบ →</span>
                </button>
              )
            })}
          </div>

          <p className="text-center text-slate-600 text-xs mt-6">กรุณาเลือกแผนกที่ต้องการใช้งาน แล้วใส่ PIN เพื่อยืนยัน</p>
          <p className="text-center text-slate-700 text-[11px] mt-3">เวอร์ชัน {APP_VERSION} · {APP_BUILD_DATE}</p>
        </div>

        {/* PIN gate หลังเลือกแผนกแล้ว */}
        {showDeptGate && (
          <DeptPinGate
            dept={dept}
            onUnlock={() => { setShowDeptGate(false); setShowDeptSelect(false) }}
            onClose={() => setShowDeptGate(false)} /* ปิดได้ → กลับไปเลือกแผนกใหม่ */
          />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0f1e]">
      <nav className="flex items-center gap-1 px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0">

        {/* Logo — กดกลับหน้าแรก */}
        <button onClick={() => { setPage('weigh'); setWeighKey(k => k + 1) }} className="flex items-center gap-2 mr-3 hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="BWP" className="w-7 h-7 rounded-full object-cover"/>
          <span className="text-white font-bold text-sm hidden sm:block">ระบบชั่งน้ำหนักม้วน</span>
        </button>

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
              {(['blow','print','rewind'] as const).map(d => {
                const c = deptConfig[d]
                return (
                  <button key={d} onClick={() => switchDept(d)}
                    className={`w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-800 ${dept===d ? 'bg-slate-800/60' : ''}`}>
                    <span className="text-xl">{c.emoji}</span>
                    <div className="text-left">
                      <p className={`font-bold text-sm ${dept===d ? 'text-white' : 'text-slate-300'}`}>{c.label}</p>
                      <p className="text-slate-500 text-[10px]">{c.sub}</p>
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

        {NAV.map(({ key, label, icon: Icon }) => {
          const badge = badges[key] ?? 0
          return (
          <button key={key} onClick={() => goPage(key)}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              page === key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}>
            <Icon size={14}/> <span className="hidden md:block">{label}</span>
            {(key === 'review' || key === 'nc') && <span className="text-amber-400" title="เฉพาะ ผจก (ต้องใส่ PIN)">🔒</span>}
            {badge > 0 && (
              <span className={`ml-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-black text-white ${key==='nc' ? 'bg-purple-600' : 'bg-red-600'} ${page===key ? '' : 'animate-pulse'}`}>
                {badge}
              </span>
            )}
          </button>
          )
        })}

        {/* Admin (lock-protected) */}
        <button onClick={gotoAdmin}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            page === 'admin' ? 'bg-amber-600 text-white' : 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
          }`}>
          <Lock size={14}/> <span className="hidden md:block">Admin</span>
        </button>

        {/* Connection status — ชิดขวา */}
        <div className="ml-auto flex-shrink-0 flex items-center gap-2">
          <button onClick={() => setShowAbout(true)} title="ดูรายละเอียดอัปเดต"
            className="hidden md:block text-[10px] text-slate-500 hover:text-brand-300 transition-colors">v{APP_VERSION}</button>
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
        {page === 'weigh'     && <WeighStation key={weighKey} dept={dept} />}
        {page === 'transfer'  && <Transfer dept={dept} />}
        {page === 'warehouse' && <Warehouse dept={dept} />}
        {page === 'dashboard' && (
          <div>
            <div className="flex justify-end px-4 pt-3">
              <a href={`/Dashboard?dept=${dept}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-1.5">
                🔗 เปิดแดชบอร์ดแยกหน้าต่าง
              </a>
            </div>
            <Dashboard dept={dept} />
          </div>
        )}
        {page === 'combined'  && (
          <div>
            <div className="flex justify-end px-4 pt-3">
              <a href="/combined" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-1.5">
                🔗 เปิดแยกหน้าต่าง
              </a>
            </div>
            <CombinedDashboard />
          </div>
        )}
        {page === 'planning'  && <Planning dept={dept} />}
        {page === 'history'   && <HistoryPage dept={dept} />}
        {page === 'products'  && <ProductsPage />}
        {page === 'review'    && <ReviewQueue dept={dept} mode="prod" />}
        {page === 'nc'        && <ReviewQueue dept={dept} mode="nc" />}
        {page === 'settings'  && <MachineSettings dept={dept} />}
        {page === 'admin'     && <Admin dept={dept} />}
      </main>

      {pinTarget && (
        <PinGate
          onUnlock={() => { const t = pinTarget; setPinTarget(null); setPage(t) }}
          onClose={() => setPinTarget(null)}
        />
      )}

      {/* PIN ตอนสลับแผนก */}
      {pendingDept && (
        <DeptPinGate
          dept={pendingDept}
          onUnlock={() => {
            const d = pendingDept
            setDept(d); localStorage.setItem(DEPT_KEY, d); setPage('weigh')
            setPendingDept(null)
          }}
          onClose={() => setPendingDept(null)}
        />
      )}

      {/* แถบแจ้งเวอร์ชันใหม่ — เด้งให้กดรีเฟรช */}
      {updateReady && (
        <div className="fixed top-0 left-0 right-0 z-[70] bg-brand-600 text-white px-4 py-2 flex items-center justify-center gap-3 shadow-lg">
          <span className="text-sm font-bold">🔄 มีเวอร์ชันใหม่พร้อมใช้งาน</span>
          <button onClick={() => location.reload()}
            className="bg-white text-brand-700 font-bold text-sm px-4 py-1 rounded-lg hover:bg-slate-100">
            อัปเดตเดี๋ยวนี้
          </button>
          <button onClick={() => setUpdateReady(false)} className="text-white/70 hover:text-white text-sm">ภายหลัง</button>
        </div>
      )}

      {/* About — รายละเอียดเวอร์ชัน/อัปเดต */}
      {showAbout && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={() => setShowAbout(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src="/logo.png" className="w-9 h-9 rounded-full object-cover"/>
                <div>
                  <p className="text-white font-bold">ระบบชั่งน้ำหนักม้วน BWP</p>
                  <p className="text-slate-400 text-xs">เวอร์ชัน {APP_VERSION} · {APP_BUILD_DATE}</p>
                </div>
              </div>
              <button onClick={() => setShowAbout(false)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-4 overflow-y-auto space-y-4">
              <p className="text-slate-300 text-sm font-semibold">📋 ประวัติการอัปเดต</p>
              {CHANGELOG.map(c => (
                <div key={c.version} className="border-l-2 border-brand-500/50 pl-3">
                  <p className="text-brand-300 font-bold text-sm">v{c.version} <span className="text-slate-500 font-normal text-xs">· {c.date}</span></p>
                  <ul className="mt-1 space-y-1">
                    {c.items.map((it, i) => (
                      <li key={i} className="text-slate-400 text-xs leading-snug flex gap-1.5"><span className="text-brand-400">•</span><span>{it}</span></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-800">
              <button onClick={() => setShowAbout(false)} className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm">ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
