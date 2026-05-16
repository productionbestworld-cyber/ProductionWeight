import { useEffect, useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart as HBarChart,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { RotateCcw } from 'lucide-react'

// ─── helpers ────────────────────────────────────────────────────────────────
function fmtKg(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k'
  return n.toFixed(1)
}
function num(n: number, d = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}

type Roll = {
  id: string
  roll_type: string
  weight: number
  machine_no: string
  lot_no: string
  product_name: string
  customer: string
  size: string
  grade: string
  created_at: string
  roll_no: number
}

type Tab = 'overview' | 'daily' | 'compare' | 'table'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Dashboard ภาพรวม' },
  { key: 'daily',    label: 'รายวัน' },
  { key: 'compare',  label: 'เปรียบเทียบ' },
  { key: 'table',    label: 'ตารางข้อมูล' },
]

// custom tooltip for bar chart
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-bold text-gray-700 mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }}/>
          <span className="text-gray-600">{p.name}:</span>
          <span className="font-bold text-gray-800">{num(p.value, 1)} kg</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [rolls,   setRolls]   = useState<Roll[]>([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState<Tab>('overview')

  // filters
  const today = toDateStr(new Date())
  const [dateFrom,  setDateFrom]  = useState(() => {
    const d = new Date(); d.setDate(1); return toDateStr(d)   // first of month
  })
  const [dateTo,    setDateTo]    = useState(today)
  const [fMachine,  setFMachine]  = useState('')
  const [fCustomer, setFCustomer] = useState('')
  const [fSize,     setFSize]     = useState('')
  const [fGrade,    setFGrade]    = useState('')

  async function load() {
    setLoading(true)
    const from = new Date(dateFrom); from.setHours(0,0,0,0)
    const to   = new Date(dateTo);   to.setHours(23,59,59,999)
    const { data } = await supabase
      .from('production_rolls')
      .select('id,roll_type,weight,machine_no,lot_no,product_name,customer,size,grade,created_at,roll_no')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: true })
    setRolls((data ?? []) as Roll[])
    setLoading(false)
  }

  useEffect(() => { load() }, [dateFrom, dateTo])

  // dropdown options
  const machines  = useMemo(() => Array.from(new Set(rolls.map(r => r.machine_no).filter(Boolean))).sort(), [rolls])
  const customers = useMemo(() => Array.from(new Set(rolls.map(r => r.customer).filter(Boolean))).sort(), [rolls])
  const sizes     = useMemo(() => Array.from(new Set(rolls.map(r => r.size).filter(Boolean))).sort(), [rolls])
  const grades    = useMemo(() => Array.from(new Set(rolls.map(r => r.grade).filter(Boolean))).sort(), [rolls])

  // filtered
  const filtered = useMemo(() => rolls.filter(r =>
    (!fMachine  || r.machine_no === fMachine) &&
    (!fCustomer || r.customer   === fCustomer) &&
    (!fSize     || r.size       === fSize) &&
    (!fGrade    || r.grade      === fGrade)
  ), [rolls, fMachine, fCustomer, fSize, fGrade])

  const fg     = useMemo(() => filtered.filter(r => r.roll_type === 'good'), [filtered])
  const scrap  = useMemo(() => filtered.filter(r => r.roll_type === 'scrap'), [filtered])
  const rework = useMemo(() => filtered.filter(r => r.roll_type === 'rework'), [filtered])

  const fgKg     = useMemo(() => fg.reduce((s, r) => s + (r.weight ?? 0), 0), [fg])
  const scrapKg  = useMemo(() => scrap.reduce((s, r) => s + (r.weight ?? 0), 0), [scrap])
  const reworkKg = useMemo(() => rework.reduce((s, r) => s + (r.weight ?? 0), 0), [rework])
  const totalKg  = fgKg + scrapKg + reworkKg

  // per-machine chart data
  const machineData = useMemo(() => {
    const keys = Array.from(new Set(filtered.map(r => r.machine_no).filter(Boolean))).sort()
    return keys.map(m => {
      const rows = filtered.filter(r => r.machine_no === m)
      return {
        machine: m,
        FG:       rows.filter(r => r.roll_type === 'good').reduce((s, r) => s + r.weight, 0),
        ของเสีย:  rows.filter(r => r.roll_type === 'scrap').reduce((s, r) => s + r.weight, 0),
        ซ่อม:    rows.filter(r => r.roll_type === 'rework').reduce((s, r) => s + r.weight, 0),
      }
    })
  }, [filtered])

  // per-customer chart data
  const customerData = useMemo(() => {
    const keys = Array.from(new Set(fg.map(r => r.customer).filter(Boolean)))
    return keys.map(c => ({
      customer: c,
      FG: fg.filter(r => r.customer === c).reduce((s, r) => s + r.weight, 0),
    })).sort((a, b) => b.FG - a.FG).slice(0, 15)
  }, [fg])

  // daily chart data
  const dailyData = useMemo(() => {
    const map = new Map<string, { date: string; FG: number; ของเสีย: number; ซ่อม: number }>()
    filtered.forEach(r => {
      const d = r.created_at.slice(0, 10)
      if (!map.has(d)) map.set(d, { date: d, FG: 0, ของเสีย: 0, ซ่อม: 0 })
      const entry = map.get(d)!
      if (r.roll_type === 'good')   entry.FG      += r.weight
      if (r.roll_type === 'scrap')  entry.ของเสีย += r.weight
      if (r.roll_type === 'rework') entry.ซ่อม    += r.weight
    })
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ ...d, date: new Date(d.date).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit' }) }))
  }, [filtered])

  // per-machine summary table
  const machineSummary = useMemo(() => {
    const keys = Array.from(new Set(filtered.map(r => r.machine_no).filter(Boolean))).sort()
    return keys.map(m => {
      const rows   = filtered.filter(r => r.machine_no === m)
      const fgRows = rows.filter(r => r.roll_type === 'good')
      const scRows = rows.filter(r => r.roll_type === 'scrap')
      const rwRows = rows.filter(r => r.roll_type === 'rework')
      const fgKg   = fgRows.reduce((s, r) => s + r.weight, 0)
      const scKg   = scRows.reduce((s, r) => s + r.weight, 0)
      const rwKg   = rwRows.reduce((s, r) => s + r.weight, 0)
      const tot    = fgKg + scKg + rwKg
      return { machine: m, fgKg, scKg, rwKg, tot, fgRolls: fgRows.length,
        scPct: tot ? (scKg / tot * 100) : 0,
        rwPct: tot ? (rwKg / tot * 100) : 0,
      }
    })
  }, [filtered])

  function resetFilters() {
    setFMachine(''); setFCustomer(''); setFSize(''); setFGrade('')
    const d = new Date(); d.setDate(1)
    setDateFrom(toDateStr(d)); setDateTo(today)
  }

  const hasFilter = fMachine || fCustomer || fSize || fGrade

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">

      {/* ── Tabs ── */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t.key === 'overview' && '📊 '}
              {t.key === 'daily'    && '📅 '}
              {t.key === 'compare'  && '📈 '}
              {t.key === 'table'    && '📋 '}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5 max-w-screen-2xl mx-auto space-y-4">

        {/* ── Filter bar ── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 font-semibold uppercase tracking-wider">ตัวกรองข้อมูล</label>
              <div className="flex gap-3 flex-wrap items-end">
                <div>
                  <label className="block text-[10px] text-gray-400 mb-0.5">ตั้งแต่วันที่</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white outline-none focus:border-blue-400"/>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-0.5">ถึงวันที่</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white outline-none focus:border-blue-400"/>
                </div>
                {[
                  { label:'เครื่องจักร', val: fMachine,  set: setFMachine,  opts: machines,  all:'ทั้งหมด' },
                  { label:'ลูกค้า',      val: fCustomer, set: setFCustomer, opts: customers, all:'ทั้งหมด' },
                  { label:'ขนาด',        val: fSize,     set: setFSize,     opts: sizes,     all:'ทั้งหมด' },
                  { label:'เกรด',        val: fGrade,    set: setFGrade,    opts: grades,    all:'ทั้งหมด' },
                ].map(f => (
                  <div key={f.label}>
                    <label className="block text-[10px] text-gray-400 mb-0.5">{f.label}</label>
                    <select value={f.val} onChange={e => f.set(e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white outline-none focus:border-blue-400 min-w-[120px]">
                      <option value="">{f.all}</option>
                      {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={resetFilters}
              className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors self-end ${
                hasFilter ? 'bg-blue-50 border-blue-300 text-blue-600 hover:bg-blue-100' : 'border-gray-200 text-gray-400 hover:text-gray-600'
              }`}>
              <RotateCcw size={12}/> ล้างค่า (Reset)
            </button>
          </div>
          {loading && <p className="text-xs text-blue-500 mt-2">กำลังโหลด...</p>}
        </div>

        {/* ════════════════════════════════ TAB: OVERVIEW ══════════════════════════════ */}
        {tab === 'overview' && (<>

          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-4">
            {/* FG */}
            <div className="bg-white rounded-xl border-l-4 border-blue-500 border border-gray-200 shadow-sm p-5">
              <p className="text-xs text-gray-500 font-medium">FG</p>
              <p className="text-3xl font-black text-gray-800 mt-1">
                {fmtKg(fgKg)} <span className="text-base font-semibold text-gray-500">kg</span>
              </p>
              <p className="text-blue-500 text-xs mt-1">{fg.length.toLocaleString()} ม้วน</p>
            </div>
            {/* Total Output */}
            <div className="bg-white rounded-xl border-l-4 border-purple-500 border border-gray-200 shadow-sm p-5">
              <p className="text-xs text-gray-500 font-medium">Total Output</p>
              <p className="text-3xl font-black text-gray-800 mt-1">
                {fmtKg(totalKg)} <span className="text-base font-semibold text-gray-500">kg</span>
              </p>
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-red-400 rounded-full"
                  style={{ width: totalKg ? `${Math.min((fgKg/totalKg)*100, 100)}%` : '0%' }}/>
              </div>
              <div className="flex justify-between text-[10px] mt-1 text-gray-400">
                <span>FG: {totalKg ? (fgKg/totalKg*100).toFixed(2) : 0}%</span>
                <span>สูญเสีย: {totalKg ? ((scrapKg+reworkKg)/totalKg*100).toFixed(2) : 0}%</span>
              </div>
            </div>
            {/* Scrap */}
            <div className="bg-white rounded-xl border-l-4 border-red-500 border border-gray-200 shadow-sm p-5">
              <p className="text-xs text-gray-500 font-medium">Scrap</p>
              <p className="text-3xl font-black text-gray-800 mt-1">
                {fmtKg(scrapKg)} <span className="text-base font-semibold text-gray-500">kg</span>
              </p>
              <p className="text-red-500 text-xs mt-1">
                {fgKg ? (scrapKg/fgKg*100).toFixed(2) : '0.00'}% ของ FG
              </p>
            </div>
            {/* Rework */}
            <div className="bg-white rounded-xl border-l-4 border-orange-400 border border-gray-200 shadow-sm p-5">
              <p className="text-xs text-gray-500 font-medium">Rework</p>
              <p className="text-3xl font-black text-gray-800 mt-1">
                {fmtKg(reworkKg)} <span className="text-base font-semibold text-gray-500">kg</span>
              </p>
              <p className="text-orange-500 text-xs mt-1">
                {fgKg ? (reworkKg/fgKg*100).toFixed(2) : '0.00'}% ของ FG
              </p>
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-2 gap-4">

            {/* ผลผลิตต่อเครื่องจักร */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="font-bold text-gray-700 mb-4 flex items-center gap-2">
                <span>📊</span> ผลผลิตต่อเครื่องจักร (kg)
              </p>
              {machineData.length === 0
                ? <div className="h-64 flex items-center justify-center text-gray-400 text-sm">ไม่มีข้อมูล</div>
                : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={machineData} margin={{ top: 15, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                    <XAxis dataKey="machine" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={fmtKg} tick={{ fontSize: 10 }} width={45}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Legend wrapperStyle={{ fontSize: 11 }}/>
                    <Bar dataKey="FG"      fill="#3b82f6" radius={[3,3,0,0]} label={{ position:'top', formatter: fmtKg, fontSize: 9, fill:'#555' }}/>
                    <Bar dataKey="ของเสีย" fill="#ef4444" radius={[3,3,0,0]} label={{ position:'top', formatter: fmtKg, fontSize: 9, fill:'#555' }}/>
                    <Bar dataKey="ซ่อม"   fill="#f97316" radius={[3,3,0,0]} label={{ position:'top', formatter: fmtKg, fontSize: 9, fill:'#555' }}/>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* FG ต่อลูกค้า */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="font-bold text-gray-700 mb-4 flex items-center gap-2">
                <span>👥</span> FG ต่อลูกค้า (kg)
              </p>
              {customerData.length === 0
                ? <div className="h-64 flex items-center justify-center text-gray-400 text-sm">ไม่มีข้อมูล</div>
                : (
                <ResponsiveContainer width="100%" height={Math.max(280, customerData.length * 28)}>
                  <HBarChart data={customerData} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false}/>
                    <XAxis type="number" tickFormatter={fmtKg} tick={{ fontSize: 10 }}/>
                    <YAxis type="category" dataKey="customer" width={60} tick={{ fontSize: 11 }}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Bar dataKey="FG" fill="#3b82f6" radius={[0,3,3,0]}
                      label={{ position:'right', formatter: fmtKg, fontSize: 10, fill:'#555' }}/>
                  </HBarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* สรุปต่อเครื่องจักร */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="font-bold text-gray-700 flex items-center gap-2"><span>📊</span> สรุปต่อเครื่องจักร</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] text-gray-500 uppercase tracking-wider">
                    {['เครื่องจักร','FG (kg)','FG (ม้วน)','Scrap (kg)','Scrap %','Rework (kg)','Rework %','Total (kg)'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {machineSummary.length === 0
                    ? <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">ไม่มีข้อมูล</td></tr>
                    : machineSummary.map(row => (
                      <tr key={row.machine} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5">
                          <span className="bg-blue-100 text-blue-700 font-bold text-xs px-2 py-0.5 rounded">{row.machine}</span>
                        </td>
                        <td className="px-4 py-2.5 font-bold text-blue-600">{num(row.fgKg, 1)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{row.fgRolls.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-red-500">{num(row.scKg, 1)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${row.scPct > 5 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                            {row.scPct.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-orange-500">{num(row.rwKg, 1)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${row.rwPct > 10 ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>
                            {row.rwPct.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-bold text-gray-700">{num(row.tot, 1)}</td>
                      </tr>
                    ))
                  }
                </tbody>
                {machineSummary.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold text-sm">
                      <td className="px-4 py-2.5 text-gray-700">รวมทั้งหมด</td>
                      <td className="px-4 py-2.5 text-blue-600">{num(fgKg, 1)}</td>
                      <td className="px-4 py-2.5 text-gray-600">{fg.length.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-red-500">{num(scrapKg, 1)}</td>
                      <td className="px-4 py-2.5 text-gray-600">{totalKg ? (scrapKg/totalKg*100).toFixed(2) : 0}%</td>
                      <td className="px-4 py-2.5 text-orange-500">{num(reworkKg, 1)}</td>
                      <td className="px-4 py-2.5 text-gray-600">{totalKg ? (reworkKg/totalKg*100).toFixed(2) : 0}%</td>
                      <td className="px-4 py-2.5 text-gray-800">{num(totalKg, 1)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>)}

        {/* ════════════════════════════════ TAB: DAILY ══════════════════════════════════ */}
        {tab === 'daily' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="font-bold text-gray-700 mb-4 flex items-center gap-2">
              <span>📅</span> ผลผลิตรายวัน (kg)
            </p>
            {dailyData.length === 0
              ? <div className="h-80 flex items-center justify-center text-gray-400">ไม่มีข้อมูล</div>
              : (
              <ResponsiveContainer width="100%" height={380}>
                <BarChart data={dailyData} margin={{ top: 15, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }}/>
                  <YAxis tickFormatter={fmtKg} tick={{ fontSize: 10 }} width={48}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Legend wrapperStyle={{ fontSize: 11 }}/>
                  <Bar dataKey="FG"      fill="#3b82f6" radius={[3,3,0,0]} label={{ position:'top', formatter: fmtKg, fontSize: 8, fill:'#666' }}/>
                  <Bar dataKey="ของเสีย" fill="#ef4444" radius={[3,3,0,0]}/>
                  <Bar dataKey="ซ่อม"   fill="#f97316" radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* ════════════════════════════════ TAB: COMPARE ══════════════════════════════ */}
        {tab === 'compare' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="font-bold text-gray-700 mb-4">📈 เปรียบเทียบเครื่องจักรรายวัน</p>
            {machineData.length === 0
              ? <div className="h-80 flex items-center justify-center text-gray-400">ไม่มีข้อมูล</div>
              : (
              <ResponsiveContainer width="100%" height={380}>
                <BarChart data={machineData} margin={{ top: 15, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="machine" tick={{ fontSize: 11 }}/>
                  <YAxis tickFormatter={fmtKg} tick={{ fontSize: 10 }} width={48}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Legend wrapperStyle={{ fontSize: 11 }}/>
                  <Bar dataKey="FG"      fill="#3b82f6" radius={[3,3,0,0]}/>
                  <Bar dataKey="ของเสีย" fill="#ef4444" radius={[3,3,0,0]}/>
                  <Bar dataKey="ซ่อม"   fill="#f97316" radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* ════════════════════════════════ TAB: TABLE ════════════════════════════════ */}
        {tab === 'table' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="font-bold text-gray-700">📋 ตารางข้อมูลรายม้วน</p>
              <p className="text-gray-400 text-xs">{filtered.length.toLocaleString()} รายการ</p>
            </div>
            <div className="overflow-auto max-h-[65vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                  <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                    {['เวลาชั่ง','เครื่อง','ม้วนที่','ประเภท','สินค้า','ลูกค้า','Lot','ขนาด','เกรด','นน.สุทธิ (Kgs.)'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.length === 0
                    ? <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">ไม่มีข้อมูล</td></tr>
                    : filtered.slice().reverse().map(r => (
                      <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                          {new Date(r.created_at).toLocaleString('th-TH',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
                        </td>
                        <td className="px-4 py-2">
                          <span className="bg-blue-100 text-blue-700 font-bold text-xs px-1.5 py-0.5 rounded">{r.machine_no||'—'}</span>
                        </td>
                        <td className="px-4 py-2 font-mono font-bold text-gray-700">#{r.roll_no}</td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            r.roll_type === 'good'   ? 'bg-blue-100 text-blue-600'   :
                            r.roll_type === 'scrap'  ? 'bg-red-100 text-red-600'     :
                                                       'bg-orange-100 text-orange-600'
                          }`}>
                            {r.roll_type === 'good' ? 'FG' : r.roll_type === 'scrap' ? 'ของเสีย' : 'ซ่อม'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-600 text-xs max-w-[150px] truncate">{r.product_name||'—'}</td>
                        <td className="px-4 py-2 text-gray-600 text-xs">{r.customer||'—'}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{r.lot_no||'—'}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{r.size||'—'}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{r.grade||'—'}</td>
                        <td className="px-4 py-2 font-black text-blue-600">{num(r.weight)}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
