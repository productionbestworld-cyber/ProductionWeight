import { useState, useEffect, useMemo } from 'react'
import { Search, Upload, RefreshCw, RotateCcw, Download } from 'lucide-react'
import { supabase } from './lib/supabase'
import { applyFilter, kpiCalc, uniq } from './lib/utils'
import { exportTemplate } from './lib/exportTemplate'
import type { ProductionRecord, FilterState } from './lib/types'
import DashboardTab  from './pages/DashboardTab'
import DailyTab      from './pages/DailyTab'
import ProblemsTab   from './pages/ProblemsTab'
import CompareTab    from './pages/CompareTab'
import TableTab      from './pages/TableTab'
import AdminEntryTab from './pages/AdminEntryTab'
import UploadModal  from './components/UploadModal'

type Tab = 'dashboard' | 'daily' | 'problems' | 'compare' | 'table' | 'admin'

const EMPTY_FILTER: FilterState = { from: '', to: '', machine: '', customer: '', size: '', shift: '', search: '' }
const PAGE = 1000

export default function LegacyDashboard() {
  const [all,      setAll]      = useState<ProductionRecord[]>([])
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState<Tab>('dashboard')
  const [filter,   setFilter]   = useState<FilterState>({ ...EMPTY_FILTER })
  const [showUpload, setShowUpload] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const rows: ProductionRecord[] = []
    let from = 0
    while (true) {
      const { data } = await supabase.from('production_records').select('*').range(from, from + PAGE - 1).order('production_date')
      if (!data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    setAll(rows)
    setLoading(false)
  }

  const filtered = useMemo(() => applyFilter(all, filter), [all, filter])
  // แท็บเปรียบเทียบเลือกช่วงวันเอง จึงใช้ตัวกรองอื่นทั้งหมดแต่ไม่เอา from/to มาทับ
  const compareData = useMemo(() => applyFilter(all, { ...filter, from: '', to: '' }), [all, filter])
  const kpi      = useMemo(() => kpiCalc(filtered), [filtered])

  function set(k: keyof FilterState, v: string) {
    setFilter(f => ({ ...f, [k]: v }))
  }

  const machines  = useMemo(() => uniq(all, 'machine'),  [all])
  const customers = useMemo(() => uniq(all, 'customer'), [all])
  const sizes     = useMemo(() => uniq(all, 'size'),     [all])
  const shifts    = useMemo(() => uniq(all, 'shift'),    [all])

  const TABS: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: '📊 Dashboard ภาพรวม' },
    { key: 'daily',     label: '📅 รายวัน' },
    { key: 'problems',  label: '⚠️ ปัญหา & สาเหตุ' },
    { key: 'compare',   label: '🔄 เปรียบเทียบ' },
    { key: 'table',     label: '📋 ตารางข้อมูล' },
    { key: 'admin',     label: '✏️ กรอกข้อมูล' },
  ]

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: '"Sarabun", sans-serif' }}>
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-sm">
        <div className="px-7 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black text-xs">BWP</div>
            <div>
              <p className="font-bold text-gray-800 text-lg leading-tight">Production Dashboard</p>
              <p className="text-xs text-gray-400">ข้อมูลทั้งหมด {all.length.toLocaleString()} รายการ</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 w-72">
              <Search size={14} className="text-gray-400 shrink-0" />
              <input value={filter.search} onChange={e => set('search', e.target.value)}
                placeholder="ค้นหา ลูกค้า, ขนาด, วันที่, ใบสั่ง..."
                className="bg-transparent outline-none text-sm text-gray-700 w-full placeholder:text-gray-400" />
            </div>
            <button onClick={fetchAll} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium text-gray-600 transition-colors">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={exportTemplate}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-semibold transition-colors">
              <Download size={14} /> Template
            </button>
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors">
              <Upload size={14} /> + อัปโหลดเพิ่ม
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-7 flex gap-1 border-t border-gray-50">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-5 py-3 text-sm font-medium border-b-[3px] transition-all ${
                tab === t.key
                  ? 'border-blue-500 text-blue-600 font-semibold'
                  : 'border-transparent text-gray-500 hover:text-blue-500'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-7 py-5 max-w-screen-2xl mx-auto">
        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-700">ตัวกรองข้อมูล</p>
            <button onClick={() => setFilter({ ...EMPTY_FILTER })}
              className="flex items-center gap-1 text-red-500 text-xs font-medium hover:text-red-600 transition-colors">
              <RotateCcw size={11} /> ล้างค่า (Reset)
            </button>
          </div>
          <div className="grid grid-cols-6 gap-3">
            <div>
              <p className="text-[10px] text-gray-400 font-medium mb-1">ตั้งแต่วันที่</p>
              <input type="date" value={filter.from} onChange={e => set('from', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-blue-400" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-medium mb-1">ถึงวันที่</p>
              <input type="date" value={filter.to} onChange={e => set('to', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-blue-400" />
            </div>
            {[
              { label: 'เครื่องจักร', key: 'machine',  opts: machines  },
              { label: 'ลูกค้า',      key: 'customer', opts: customers },
              { label: 'ขนาด',        key: 'size',     opts: sizes     },
              { label: 'กะ',          key: 'shift',    opts: shifts    },
            ].map(({ label, key, opts }) => (
              <div key={key}>
                <p className="text-[10px] text-gray-400 font-medium mb-1">{label}</p>
                <select value={(filter as any)[key]} onChange={e => set(key as keyof FilterState, e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-blue-400 bg-white">
                  <option value="">ทั้งหมด</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <RefreshCw size={32} className="text-blue-400 mx-auto mb-3 animate-spin" />
              <p className="text-gray-400 text-sm">กำลังโหลดข้อมูล...</p>
            </div>
          </div>
        ) : (
          <>
            {tab === 'dashboard' && <DashboardTab data={filtered} kpi={kpi} />}
            {tab === 'daily'     && <DailyTab     data={filtered} />}
            {tab === 'problems'  && <ProblemsTab  data={filtered} />}
            {tab === 'compare'   && <CompareTab   allData={compareData} />}
            {tab === 'table'     && <TableTab     data={filtered} />}
            {tab === 'admin'     && <AdminEntryTab />}
          </>
        )}

        <p className="text-center text-xs text-gray-300 mt-8 pb-4">Siamscales &amp; Engineering · Production Dashboard</p>
      </div>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={fetchAll} />}
    </div>
  )
}
