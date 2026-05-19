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
  width_cm?: string
  thick_mc?: string
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

export default function Dashboard({ dept }: { dept?: 'blow'|'print'|'rewind' }) {
  const [rolls,   setRolls]   = useState<Roll[]>([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState<Tab>('overview')

  // filters
  const today = toDateStr(new Date())
  const [dateFrom,  setDateFrom]  = useState(() => {
    const d = new Date(); d.setDate(1); return toDateStr(d)
  })
  const [dateTo,    setDateTo]    = useState(today)
  const [fSection,  setFSection]  = useState<''|'blow'|'print'|'rewind'>(dept ?? '')
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
      .select('id,roll_type,weight,machine_no,lot_no,product_name,customer,width_cm,thick_mc,created_at,roll_no,section')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: true })
    setRolls((data ?? []) as Roll[])
    setLoading(false)
  }

  const [countdown, setCountdown] = useState(30)

  // polling ทุก 30 วินาที
  useEffect(() => {
    load()
    setCountdown(30)
    const interval = setInterval(() => {
      // silent reload — ไม่แสดง loading spinner
      const from = new Date(dateFrom); from.setHours(0,0,0,0)
      const to   = new Date(dateTo);   to.setHours(23,59,59,999)
      supabase
        .from('production_rolls')
        .select('id,roll_type,weight,machine_no,lot_no,product_name,customer,width_cm,thick_mc,created_at,roll_no,section')
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .order('created_at', { ascending: true })
        .then(({ data }) => { if (data) setRolls(data as Roll[]) })
      setCountdown(30)
    }, 30_000)
    // countdown timer
    const ticker = setInterval(() => setCountdown(c => c <= 1 ? 30 : c - 1), 1_000)
    return () => { clearInterval(interval); clearInterval(ticker) }
  }, [dateFrom, dateTo])

  // dropdown options
  const machines  = useMemo(() => Array.from(new Set(rolls.map(r => r.machine_no).filter(Boolean))).sort(), [rolls])
  const customers = useMemo(() => Array.from(new Set(rolls.map(r => r.customer).filter(Boolean))).sort(), [rolls])
  const sizes  = useMemo(() => Array.from(new Set(rolls.map(r => r.width_cm && r.thick_mc ? `${r.width_cm}cm×${r.thick_mc}mc` : '').filter(Boolean))).sort(), [rolls])
  const grades = useMemo(() => [] as string[], [])

  // filtered
  const filtered = useMemo(() => rolls.filter(r =>
    (!fSection  || ((r as any).section ?? 'blow') === fSection) &&
    (!fMachine  || r.machine_no === fMachine) &&
    (!fCustomer || r.customer   === fCustomer) &&
    (!fSize  || (r.width_cm && r.thick_mc ? `${r.width_cm}cm×${r.thick_mc}mc` : '') === fSize)
  ), [rolls, fSection, fMachine, fCustomer, fSize])

  // roll_type จริง: good | bad | scrap_clear | scrap_color | scrap_lump
  const fg          = useMemo(() => filtered.filter(r => r.roll_type === 'good'), [filtered])
  const bad         = useMemo(() => filtered.filter(r => r.roll_type === 'bad'), [filtered])
  const scrapClear  = useMemo(() => filtered.filter(r => r.roll_type === 'scrap_clear'), [filtered])
  const scrapColor  = useMemo(() => filtered.filter(r => r.roll_type === 'scrap_color'), [filtered])
  const scrapLump   = useMemo(() => filtered.filter(r => r.roll_type === 'scrap_lump'), [filtered])
  const allScrap    = useMemo(() => [...scrapClear, ...scrapColor, ...scrapLump], [scrapClear, scrapColor, scrapLump])

  const kg = (arr: typeof filtered) => arr.reduce((s, r) => s + (r.weight ?? 0), 0)

  const fgKg         = useMemo(() => kg(fg),         [fg])
  const badKg        = useMemo(() => kg(bad),        [bad])
  const scrapClearKg = useMemo(() => kg(scrapClear), [scrapClear])
  const scrapColorKg = useMemo(() => kg(scrapColor), [scrapColor])
  const scrapLumpKg  = useMemo(() => kg(scrapLump),  [scrapLump])
  const allScrapKg   = useMemo(() => kg(allScrap),   [allScrap])
  const totalKg      = fgKg + badKg + allScrapKg

  // per-machine chart data
  const machineData = useMemo(() => {
    const keys = Array.from(new Set(filtered.map(r => r.machine_no).filter(Boolean))).sort()
    return keys.map(m => {
      const rows = filtered.filter(r => r.machine_no === m)
      const w = (t: string) => rows.filter(r => r.roll_type === t).reduce((s, r) => s + r.weight, 0)
      return {
        machine:  m,
        FG:       w('good'),
        ม้วนกรอ: w('bad'),
        เศษใส:   w('scrap_clear'),
        เศษสี:   w('scrap_color'),
        เศษก้อน: w('scrap_lump'),
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
      const rows  = filtered.filter(r => r.machine_no === m)
      const w     = (t: string) => rows.filter(r => r.roll_type === t).reduce((s, r) => s + r.weight, 0)
      const fgKg  = w('good')
      const badKg = w('bad')
      const scClear = w('scrap_clear'), scColor = w('scrap_color'), scLump = w('scrap_lump')
      const scKg  = scClear + scColor + scLump
      const tot   = fgKg + badKg + scKg
      return {
        machine: m,
        fgKg, fgRolls: rows.filter(r => r.roll_type === 'good').length,
        badKg, scKg, scClear, scColor, scLump, tot,
        badPct: tot ? (badKg / tot * 100) : 0,
        scPct:  tot ? (scKg  / tot * 100) : 0,
      }
    })
  }, [filtered])

  function resetFilters() {
    setFMachine(''); setFCustomer(''); setFSize('')
    const d = new Date(); d.setDate(1)
    setDateFrom(toDateStr(d)); setDateTo(today)
  }

  const hasFilter = fMachine || fCustomer || fSize

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
                {/* Section toggle — เลือกได้เสมอ */}
                <div>
                  <label className="block text-[10px] text-gray-400 mb-0.5">ฝั่งผลิต</label>
                  <div className="flex gap-1">
                    {([
                      { val:'',       label:'ทั้งหมด', active:'bg-gray-600 text-white border-gray-600' },
                      { val:'blow',   label:'🌬 เป่า',  active:'bg-blue-500 text-white border-blue-500' },
                      { val:'print',  label:'🖨 พิม',   active:'bg-purple-500 text-white border-purple-500' },
                      { val:'rewind', label:'🔁 กรอ',   active:'bg-green-600 text-white border-green-600' },
                    ] as const).map(s=>(
                      <button key={s.val} onClick={() => setFSection(s.val)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                          fSection===s.val ? s.active : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'
                        }`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
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
                  { label:'ขนาด',   val: fSize,  set: setFSize,  opts: sizes,  all:'ทั้งหมด' },
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
          <div className="flex items-center gap-3 mt-2">
            {loading && <p className="text-xs text-blue-500">กำลังโหลด...</p>}
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block"/>
              อัพเดตอัตโนมัติทุก 30 วิ
              <button onClick={() => load()}
                className="ml-1 text-blue-500 hover:text-blue-700 font-semibold underline underline-offset-2">
                รีเฟรชเดี๋ยวนี้
              </button>
              <span className="text-gray-300">·</span>
              <span>อีก <b className="text-gray-600">{countdown}</b> วิ</span>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════ TAB: OVERVIEW ══════════════════════════════ */}
        {tab === 'overview' && (<>

          {/* KPI cards row 1 */}
          <div className="grid grid-cols-4 gap-4">
            {/* FG */}
            <div className="bg-white rounded-xl border-l-4 border-blue-500 border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 font-medium">✅ FG (ม้วนดี)</p>
              <p className="text-3xl font-black text-gray-800 mt-1">
                {fmtKg(fgKg)} <span className="text-sm font-semibold text-gray-400">kg</span>
              </p>
              <p className="text-blue-500 text-xs mt-1">{fg.length} ม้วน</p>
            </div>
            {/* Total + Yield */}
            <div className="bg-white rounded-xl border-l-4 border-purple-500 border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 font-medium">📦 Total Output</p>
              <p className="text-3xl font-black text-gray-800 mt-1">
                {fmtKg(totalKg)} <span className="text-sm font-semibold text-gray-400">kg</span>
              </p>
              <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full"
                  style={{ width: totalKg ? `${Math.min((fgKg/totalKg)*100,100)}%` : '0%' }}/>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">
                FG {totalKg ? (fgKg/totalKg*100).toFixed(1) : 0}% · สูญเสีย {totalKg ? ((badKg+allScrapKg)/totalKg*100).toFixed(1) : 0}%
              </p>
            </div>
            {/* ม้วนกรอ */}
            <div className="bg-white rounded-xl border-l-4 border-orange-500 border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 font-medium">🔄 ม้วนกรอ</p>
              <p className="text-3xl font-black text-gray-800 mt-1">
                {fmtKg(badKg)} <span className="text-sm font-semibold text-gray-400">kg</span>
              </p>
              <p className="text-orange-500 text-xs mt-1">
                {bad.length} ม้วน · {fgKg ? (badKg/fgKg*100).toFixed(2) : '0.00'}% ของ FG
              </p>
            </div>
            {/* เศษรวม */}
            <div className="bg-white rounded-xl border-l-4 border-red-500 border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 font-medium">🗑 เศษรวม</p>
              <p className="text-3xl font-black text-gray-800 mt-1">
                {fmtKg(allScrapKg)} <span className="text-sm font-semibold text-gray-400">kg</span>
              </p>
              <p className="text-red-500 text-xs mt-1">
                {fgKg ? (allScrapKg/fgKg*100).toFixed(2) : '0.00'}% ของ FG
              </p>
            </div>
          </div>

          {/* KPI cards row 2 — เศษแยกประเภท */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-lg flex-shrink-0">🫙</div>
              <div>
                <p className="text-xs text-gray-500">เศษใส</p>
                <p className="text-xl font-black text-gray-800">{fmtKg(scrapClearKg)} <span className="text-xs font-normal text-gray-400">kg</span></p>
                <p className="text-gray-400 text-[10px]">{scrapClear.length} ครั้ง · {fgKg ? (scrapClearKg/fgKg*100).toFixed(2) : 0}% ของ FG</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-lg flex-shrink-0">🎨</div>
              <div>
                <p className="text-xs text-gray-500">เศษสี</p>
                <p className="text-xl font-black text-gray-800">{fmtKg(scrapColorKg)} <span className="text-xs font-normal text-gray-400">kg</span></p>
                <p className="text-gray-400 text-[10px]">{scrapColor.length} ครั้ง · {fgKg ? (scrapColorKg/fgKg*100).toFixed(2) : 0}% ของ FG</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-lg flex-shrink-0">🧱</div>
              <div>
                <p className="text-xs text-gray-500">เศษก้อน</p>
                <p className="text-xl font-black text-gray-800">{fmtKg(scrapLumpKg)} <span className="text-xs font-normal text-gray-400">kg</span></p>
                <p className="text-gray-400 text-[10px]">{scrapLump.length} ครั้ง · {fgKg ? (scrapLumpKg/fgKg*100).toFixed(2) : 0}% ของ FG</p>
              </div>
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
                    <Bar dataKey="FG"      fill="#3b82f6" radius={[3,3,0,0]} label={{ position:'top', formatter:(v:any)=>fmtKg(Number(v)), fontSize: 9, fill:'#555' }}/>
                    <Bar dataKey="ม้วนกรอ" fill="#f97316" radius={[3,3,0,0]} label={{ position:'top', formatter:(v:any)=>fmtKg(Number(v)), fontSize: 9, fill:'#555' }}/>
                    <Bar dataKey="เศษใส"  fill="#ef4444" radius={[3,3,0,0]} label={{ position:'top', formatter:(v:any)=>fmtKg(Number(v)), fontSize: 9, fill:'#555' }}/>
                    <Bar dataKey="เศษสี"  fill="#a855f7" radius={[3,3,0,0]} label={{ position:'top', formatter:(v:any)=>fmtKg(Number(v)), fontSize: 9, fill:'#555' }}/>
                    <Bar dataKey="เศษก้อน" fill="#d97706" radius={[3,3,0,0]} label={{ position:'top', formatter:(v:any)=>fmtKg(Number(v)), fontSize: 9, fill:'#555' }}/>
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
                      label={{ position:'right', formatter:(v:any)=>fmtKg(Number(v)), fontSize: 10, fill:'#555' }}/>
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
                    {['เครื่อง','FG (kg)','ม้วน','กรอ (kg)','กรอ%','เศษใส','เศษสี','เศษก้อน','เศษรวม%','Total (kg)'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {machineSummary.length === 0
                    ? <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">ไม่มีข้อมูล</td></tr>
                    : machineSummary.map(row => (
                      <tr key={row.machine} className="hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2.5">
                          <span className="bg-blue-100 text-blue-700 font-bold text-xs px-2 py-0.5 rounded">{row.machine}</span>
                        </td>
                        <td className="px-3 py-2.5 font-bold text-blue-600">{num(row.fgKg, 1)}</td>
                        <td className="px-3 py-2.5 text-gray-500">{row.fgRolls}</td>
                        <td className="px-3 py-2.5 text-orange-500">{num(row.badKg, 1)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${row.badPct > 5 ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>
                            {row.badPct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{num(row.scClear, 1)}</td>
                        <td className="px-3 py-2.5 text-purple-500">{num(row.scColor, 1)}</td>
                        <td className="px-3 py-2.5 text-amber-600">{num(row.scLump, 1)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${row.scPct > 5 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                            {row.scPct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-bold text-gray-700">{num(row.tot, 1)}</td>
                      </tr>
                    ))
                  }
                </tbody>
                {machineSummary.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold text-sm">
                      <td className="px-3 py-2.5 text-gray-700">รวม</td>
                      <td className="px-3 py-2.5 text-blue-600">{num(fgKg, 1)}</td>
                      <td className="px-3 py-2.5 text-gray-600">{fg.length}</td>
                      <td className="px-3 py-2.5 text-orange-500">{num(badKg, 1)}</td>
                      <td className="px-3 py-2.5 text-gray-500">{totalKg ? (badKg/totalKg*100).toFixed(1) : 0}%</td>
                      <td className="px-3 py-2.5 text-slate-500">{num(scrapClearKg, 1)}</td>
                      <td className="px-3 py-2.5 text-purple-500">{num(scrapColorKg, 1)}</td>
                      <td className="px-3 py-2.5 text-amber-600">{num(scrapLumpKg, 1)}</td>
                      <td className="px-3 py-2.5 text-gray-500">{totalKg ? (allScrapKg/totalKg*100).toFixed(1) : 0}%</td>
                      <td className="px-3 py-2.5 text-gray-800">{num(totalKg, 1)}</td>
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
                  <Bar dataKey="FG"      fill="#3b82f6" radius={[3,3,0,0]} label={{ position:'top', formatter:(v:any)=>fmtKg(Number(v)), fontSize: 8, fill:'#666' }}/>
                  <Bar dataKey="ม้วนกรอ"  fill="#f97316" radius={[3,3,0,0]}/>
                  <Bar dataKey="เศษใส"   fill="#ef4444" radius={[3,3,0,0]}/>
                  <Bar dataKey="เศษสี"   fill="#a855f7" radius={[3,3,0,0]}/>
                  <Bar dataKey="เศษก้อน" fill="#d97706" radius={[3,3,0,0]}/>
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
                  <Bar dataKey="ม้วนกรอ"  fill="#f97316" radius={[3,3,0,0]}/>
                  <Bar dataKey="เศษใส"   fill="#ef4444" radius={[3,3,0,0]}/>
                  <Bar dataKey="เศษสี"   fill="#a855f7" radius={[3,3,0,0]}/>
                  <Bar dataKey="เศษก้อน" fill="#d97706" radius={[3,3,0,0]}/>
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
                    {['เวลาชั่ง','เครื่อง','ม้วนที่','ประเภท','สินค้า','ลูกค้า','Lot','ขนาด','นน.สุทธิ (Kgs.)'].map(h => (
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
                        <td className="px-4 py-2 text-gray-500 text-xs">{r.width_cm && r.thick_mc ? `${r.width_cm}×${r.thick_mc}mc` : '—'}</td>
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
