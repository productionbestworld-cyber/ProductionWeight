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
  remark?: string | null
  section?: string | null
  rework_status?: string | null
  rework_remark?: string | null
  is_legacy?: boolean
}

type Tab = 'overview' | 'so' | 'transfer' | 'daily' | 'compare' | 'table' | 'machines' | 'customers' | 'rework' | 'logs'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview',  label: '📊 Dashboard ภาพรวม' },
  { key: 'so',        label: '📋 รายงาน SO' },
  { key: 'transfer',  label: '📦 รายงานโอนคลัง' },
  { key: 'machines',  label: '🏭 เครื่องจักร' },
  { key: 'customers', label: '👥 ลูกค้า/สินค้า' },
  { key: 'rework',    label: '🔧 รายงานกรอ' },
  { key: 'daily',     label: '📅 รายวัน' },
  { key: 'compare',   label: '📈 เปรียบเทียบ' },
  { key: 'table',     label: '📄 ตารางข้อมูล' },
  { key: 'logs',      label: '📋 Logs' },
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
  const [jobs,    setJobs]    = useState<any[]>([])
  const [transfers, setTransfers] = useState<any[]>([])
  const [machineProfiles, setMachineProfiles] = useState<any[]>([])
  const [parkedJobs, setParkedJobs]           = useState<any[]>([])
  const [customersDb, setCustomersDb]         = useState<any[]>([])
  const [productsList, setProductsList]       = useState<any[]>([])
  const [weighLogs, setWeighLogs]             = useState<any[]>([])
  const [deletionLogs, setDeletionLogs]       = useState<any[]>([])
  const [reworkRolls, setReworkRolls]         = useState<any[]>([])
  const [reworkSource, setReworkSource]       = useState<'all'|'internal'|'external'>('all')
  const [compDim, setCompDim] = useState<'machine'|'day'|'wo'|'so'|'customer'|'product'|'size'|'reason'|'inspector'|'section'>('machine')
  const [compPeriod, setCompPeriod] = useState<'1d'|'7d'|'15d'|'1m'|'3m'|'6m'|'1y'>('7d')
  const [compRolls,  setCompRolls]  = useState<Roll[]>([])

  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState<Tab>('overview')
  const [openSO,  setOpenSO]  = useState<Record<string, boolean>>({})

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
    const [
      { data: rData }, { data: jData }, { data: tData },
      { data: mpData }, { data: pkData }, { data: cData }, { data: pData },
      { data: wlData }, { data: dlData }, { data: rwData },
    ] = await Promise.all([
      supabase
        .from('production_rolls')
        .select('*')
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .order('created_at', { ascending: true }),
      supabase
        .from('job_summaries')
        .select('*')
        .gte('closed_at', from.toISOString())
        .lte('closed_at', to.toISOString())
        .order('closed_at', { ascending: false }),
      supabase
        .from('transfer_documents')
        .select('*')
        .gte('transferred_at', from.toISOString())
        .lte('transferred_at', to.toISOString())
        .order('transferred_at', { ascending: false }),
      supabase.from('machine_profiles').select('*').order('machine_no'),
      supabase.from('parked_jobs').select('*').order('parked_at', { ascending: false }),
      supabase.from('customers').select('*').order('cust_name'),
      supabase.from('products').select('*').limit(500),
      supabase.from('weigh_logs').select('*').gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).order('created_at', { ascending: false }).limit(500),
      supabase.from('roll_deletion_logs').select('*').gte('deleted_at', from.toISOString()).lte('deleted_at', to.toISOString()).order('deleted_at', { ascending: false }),
      supabase.from('production_rolls').select('*').eq('roll_type', 'bad').not('rework_status', 'is', null).order('rework_received_at', { ascending: false }),
    ])
    setRolls((rData ?? []) as Roll[])
    setJobs(jData ?? [])
    setTransfers(tData ?? [])
    setMachineProfiles(mpData ?? [])
    setParkedJobs(pkData ?? [])
    setCustomersDb(cData ?? [])
    setProductsList(pData ?? [])
    setWeighLogs(wlData ?? [])
    setDeletionLogs(dlData ?? [])
    setReworkRolls(rwData ?? [])
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
        .select('id,roll_type,weight,machine_no,lot_no,product_name,customer,width_cm,thick_mc,created_at,roll_no,section,remark')
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .order('created_at', { ascending: true })
        .then(({ data }) => { if (data) setRolls(data as Roll[]) })
      supabase
        .from('job_summaries')
        .select('*')
        .gte('closed_at', from.toISOString())
        .lte('closed_at', to.toISOString())
        .order('closed_at', { ascending: false })
        .then(({ data }) => { if (data) setJobs(data) })
      supabase
        .from('transfer_documents')
        .select('*')
        .gte('transferred_at', from.toISOString())
        .lte('transferred_at', to.toISOString())
        .order('transferred_at', { ascending: false })
        .then(({ data }) => { if (data) setTransfers(data) })
      supabase.from('machine_profiles').select('*').order('machine_no')
        .then(({ data }) => { if (data) setMachineProfiles(data) })
      supabase.from('parked_jobs').select('*').order('parked_at', { ascending: false })
        .then(({ data }) => { if (data) setParkedJobs(data) })
      supabase.from('production_rolls').select('*').eq('roll_type', 'bad').not('rework_status', 'is', null)
        .then(({ data }) => { if (data) setReworkRolls(data) })
      setCountdown(30)
    }, 30_000)
    // countdown timer
    const ticker = setInterval(() => setCountdown(c => c <= 1 ? 30 : c - 1), 1_000)
    return () => { clearInterval(interval); clearInterval(ticker) }
  }, [dateFrom, dateTo])

  // โหลด rolls สำหรับ compare tab ตาม compPeriod (แยกจาก filter หลัก)
  useEffect(() => {
    if (tab !== 'compare') return
    const days = compPeriod === '1d' ? 1 : compPeriod === '7d' ? 7 : compPeriod === '15d' ? 15 : compPeriod === '1m' ? 30 : compPeriod === '3m' ? 90 : compPeriod === '6m' ? 180 : 365
    const from = new Date(); from.setDate(from.getDate() - days); from.setHours(0,0,0,0)
    supabase.from('production_rolls').select('*').gte('created_at', from.toISOString())
      .then(({ data }) => setCompRolls((data ?? []) as Roll[]))
  }, [tab, compPeriod])

  // dropdown options
  const machines  = useMemo(() => Array.from(new Set(rolls.map(r => r.machine_no).filter(Boolean))).sort(), [rolls])
  const customers = useMemo(() => Array.from(new Set(rolls.map(r => r.customer).filter(Boolean))).sort(), [rolls])
  const sizes  = useMemo(() => Array.from(new Set(rolls.map(r => r.width_cm && r.thick_mc ? `${r.width_cm}cm×${r.thick_mc}mc` : '').filter(Boolean))).sort(), [rolls])
  const grades = useMemo(() => [] as string[], [])

  // filtered
  // เครื่องกรอ (S0X): ถ้า user เลือก → รวมม้วนกรอที่ "ส่งไปกรอที่ S0X" ด้วย (machine_no เป็น BL01 แต่ถูกกรอที่ S0X)
  const filtered = useMemo(() => rolls.filter(r => {
    if (fSection && ((r as any).section ?? 'blow') !== fSection) return false
    if (fMachine) {
      const matchOriginal = r.machine_no === fMachine
      const matchRework = (r.roll_type === 'bad') && (r as any).rework_remark?.includes(`ส่งไปกรอที่ ${fMachine}`)
      if (!matchOriginal && !matchRework) return false
    }
    if (fCustomer && r.customer !== fCustomer) return false
    if (fSize && (r.width_cm && r.thick_mc ? `${r.width_cm}cm×${r.thick_mc}mc` : '') !== fSize) return false
    return true
  }), [rolls, fSection, fMachine, fCustomer, fSize])

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
      if (r.roll_type === 'good')                                      entry.FG      += r.weight
      if (typeof r.roll_type === 'string' && r.roll_type.startsWith('scrap')) entry.ของเสีย += r.weight
      if (r.roll_type === 'bad')                                       entry.ซ่อม    += r.weight
    })
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ ...d, date: new Date(d.date).toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit' }) }))
  }, [filtered])

  // ─── จัดกลุ่ม job_summaries ตาม Sale Order ────────────────────────
  const jobsFiltered = useMemo(() => jobs.filter(j =>
    (!fSection  || (j.section ?? 'blow') === fSection) &&
    (!fMachine  || j.machine_no === fMachine) &&
    (!fCustomer || j.customer === fCustomer)
  ), [jobs, fSection, fMachine, fCustomer])

  // ─── 3-level group: WO > SO > Lot (jobs) ─────────────────────────
  type JobLot     = { lot: string; jobs: any[]; goodKg: number; badKg: number; scrapKg: number; goodRolls: number; planned: number }
  type SoGroup    = { so: string;  lots: JobLot[]; goodKg: number; badKg: number; scrapKg: number; goodRolls: number; planned: number; jobs: number }
  type WoGroup    = { wo: string;  sos: SoGroup[]; goodKg: number; badKg: number; scrapKg: number; goodRolls: number; planned: number; jobs: number; total: number; yieldPct: number; latest: string; customers: string[]; machines: string[]; products: string[] }

  const woGroups: WoGroup[] = useMemo(() => {
    const woMap = new Map<string, Map<string, Map<string, any[]>>>()
    for (const j of jobsFiltered) {
      const wo  = (j.work_order ?? '').trim() || '(ไม่ระบุ WO)'
      const so  = (j.sale_order ?? '').trim() || '(ไม่ระบุ SO)'
      const lot = j.lot_no ?? '(ไม่ระบุ Lot)'
      if (!woMap.has(wo)) woMap.set(wo, new Map())
      if (!woMap.get(wo)!.has(so)) woMap.get(wo)!.set(so, new Map())
      if (!woMap.get(wo)!.get(so)!.has(lot)) woMap.get(wo)!.get(so)!.set(lot, [])
      woMap.get(wo)!.get(so)!.get(lot)!.push(j)
    }

    return [...woMap.entries()].map(([wo, soMap]) => {
      const sos: SoGroup[] = [...soMap.entries()].map(([so, lotMap]) => {
        const lots: JobLot[] = [...lotMap.entries()].map(([lot, jobs]) => ({
          lot, jobs,
          goodKg:    jobs.reduce((s, x) => s + (x.good_kg ?? 0), 0),
          badKg:     jobs.reduce((s, x) => s + (x.bad_kg ?? 0), 0),
          scrapKg:   jobs.reduce((s, x) => s + (x.scrap_kg ?? 0), 0),
          goodRolls: jobs.reduce((s, x) => s + (x.good_rolls ?? 0), 0),
          planned:   jobs.reduce((s, x) => s + (x.planned_qty ?? 0), 0),
        }))
        return {
          so, lots,
          goodKg:    lots.reduce((s, x) => s + x.goodKg, 0),
          badKg:     lots.reduce((s, x) => s + x.badKg, 0),
          scrapKg:   lots.reduce((s, x) => s + x.scrapKg, 0),
          goodRolls: lots.reduce((s, x) => s + x.goodRolls, 0),
          planned:   lots.reduce((s, x) => s + x.planned, 0),
          jobs:      lots.reduce((s, x) => s + x.jobs.length, 0),
        }
      })
      const allJobs = sos.flatMap(s => s.lots.flatMap(l => l.jobs))
      const goodKg  = sos.reduce((s, x) => s + x.goodKg, 0)
      const badKg   = sos.reduce((s, x) => s + x.badKg, 0)
      const scrapKg = sos.reduce((s, x) => s + x.scrapKg, 0)
      const total   = goodKg + badKg + scrapKg
      return {
        wo, sos,
        goodKg, badKg, scrapKg, total,
        goodRolls: sos.reduce((s, x) => s + x.goodRolls, 0),
        planned:   sos.reduce((s, x) => s + x.planned, 0),
        jobs:      sos.reduce((s, x) => s + x.jobs, 0),
        yieldPct:  total ? (goodKg / total * 100) : 0,
        latest:    allJobs.reduce((max, x) => x.closed_at > max ? x.closed_at : max, allJobs[0]?.closed_at ?? ''),
        customers: [...new Set(allJobs.map(x => x.customer).filter(Boolean))] as string[],
        machines:  [...new Set(allJobs.map(x => x.machine_no).filter(Boolean))] as string[],
        products:  [...new Set(allJobs.map(x => x.product_name).filter(Boolean))] as string[],
      }
    }).sort((a, b) => b.latest.localeCompare(a.latest))
  }, [jobsFiltered])

  // legacy soGroups alias สำหรับ KPI cards เดิม
  const soGroups = woGroups

  // ─── สาเหตุเศษเสีย / ม้วนกรอ — รวมตาม remark ───────────────────────
  const reasonSummary = useMemo(() => {
    const map = new Map<string, { reason: string; kind: 'scrap' | 'bad'; count: number; weight: number }>()
    for (const r of filtered) {
      const isScrap = r.roll_type?.startsWith?.('scrap')
      const isBad   = r.roll_type === 'bad'
      if (!isScrap && !isBad) continue
      const reason = (r.remark ?? '').trim() || '(ไม่ระบุเหตุผล)'
      const kind: 'scrap'|'bad' = isScrap ? 'scrap' : 'bad'
      const key = `${kind}::${reason}`
      const cur = map.get(key) ?? { reason, kind, count: 0, weight: 0 }
      cur.count  += 1
      cur.weight += r.weight ?? 0
      map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => b.weight - a.weight)
  }, [filtered])
  const scrapReasons = reasonSummary.filter(r => r.kind === 'scrap')
  const badReasons   = reasonSummary.filter(r => r.kind === 'bad')

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
        <div className="flex gap-0 overflow-x-auto whitespace-nowrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors shrink-0 ${
                tab === t.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
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
                  <div className="flex gap-1.5">
                    {([
                      { val:'',       emoji:'📊', label:'ทั้งหมด', active:'bg-gray-700 text-white border-gray-700' },
                      { val:'blow',   emoji:'🌬', label:'เป่า',    active:'bg-blue-600 text-white border-blue-600' },
                      { val:'print',  emoji:'🖨', label:'พิมพ์',   active:'bg-purple-600 text-white border-purple-600' },
                      { val:'rewind', emoji:'🔁', label:'กรอ',    active:'bg-green-700 text-white border-green-700' },
                    ] as const).map(s=>(
                      <button key={s.val} onClick={() => setFSection(s.val)}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border-2 transition-colors flex items-center gap-1.5 ${
                          fSection===s.val ? s.active : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                        }`}>
                        <span>{s.emoji}</span>
                        <span>{s.label}</span>
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

          {/* KPI cards row 1 — ซ่อน ม้วนกรอ เมื่อ filter เป็นแผนกกรอ */}
          <div className={`grid gap-4 ${fSection === 'rewind' ? 'grid-cols-3' : 'grid-cols-4'}`}>
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
            {/* ม้วนกรอ — แตกย่อย: รอ / กำลังกรอ / กรอเสร็จ / ทำลาย — ซ่อนเมื่อ filter = แผนกกรอ */}
            {fSection !== 'rewind' && (
            <div className="bg-white rounded-xl border-l-4 border-orange-500 border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 font-medium">🔄 ม้วนกรอ (รวม)</p>
              <p className="text-3xl font-black text-gray-800 mt-1">
                {fmtKg(badKg)} <span className="text-sm font-semibold text-gray-400">kg</span>
              </p>
              <p className="text-orange-500 text-xs mt-0.5">
                {bad.length} ม้วน · {fgKg ? (badKg/fgKg*100).toFixed(2) : '0.00'}% ของ FG
              </p>
              {/* breakdown ตามสถานะ rework */}
              {(() => {
                const pending  = bad.filter((r:any) => !r.rework_status || r.rework_status === 'pending')
                const working  = bad.filter((r:any) => r.rework_status === 'reworking')
                const reworked = bad.filter((r:any) => r.rework_status === 'reworked')
                const scrapped = bad.filter((r:any) => r.rework_status === 'scrapped')
                const sumKg = (arr: any[]) => arr.reduce((s, r) => s + (r.weight ?? 0), 0)
                return (
                  <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                    {pending.length > 0 && (
                      <>
                        <span className="text-amber-600">📥 รอกรอ</span>
                        <span className="text-amber-700 font-bold text-right">{pending.length} ม้วน · {num(sumKg(pending),1)}</span>
                      </>
                    )}
                    {working.length > 0 && (
                      <>
                        <span className="text-blue-600">⚙ กำลังกรอ</span>
                        <span className="text-blue-700 font-bold text-right">{working.length} ม้วน · {num(sumKg(working),1)}</span>
                      </>
                    )}
                    {reworked.length > 0 && (
                      <>
                        <span className="text-green-600">✓ กรอเสร็จ</span>
                        <span className="text-green-700 font-bold text-right">{reworked.length} ม้วน · {num(sumKg(reworked),1)}</span>
                      </>
                    )}
                    {scrapped.length > 0 && (
                      <>
                        <span className="text-red-600">🗑 ทำลาย</span>
                        <span className="text-red-700 font-bold text-right">{scrapped.length} ม้วน · {num(sumKg(scrapped),1)}</span>
                      </>
                    )}
                  </div>
                )
              })()}
            </div>
            )}
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

          {/* KPI cards row 2 — เศษแยกประเภท (ซ่อนในแผนกกรอ) */}
          {fSection !== 'rewind' && (
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
          )}

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

          {/* ── สาเหตุของเสีย (เศษ + ม้วนกรอ) ──────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            {/* เศษเสีย */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="font-bold text-gray-700 flex items-center gap-2"><span>🗑</span> สาเหตุเศษเสีย</p>
                <span className="text-xs text-gray-400">{scrapReasons.length} สาเหตุ · {fmtKg(allScrapKg)} kg</span>
              </div>
              {scrapReasons.length === 0 ? (
                <div className="py-10 text-center text-gray-400 text-sm">ไม่มีข้อมูล</div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase tracking-wider sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">เหตุผล</th>
                        <th className="px-3 py-2 text-right font-semibold">ครั้ง</th>
                        <th className="px-3 py-2 text-right font-semibold">น้ำหนัก (kg)</th>
                        <th className="px-3 py-2 text-right font-semibold">% ของเศษ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {scrapReasons.map(r => (
                        <tr key={r.reason} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-700">{r.reason}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{r.count}</td>
                          <td className="px-3 py-2 text-right font-bold text-red-500">{num(r.weight, 1)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">
                            {allScrapKg ? (r.weight / allScrapKg * 100).toFixed(1) : 0}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ม้วนกรอ */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="font-bold text-gray-700 flex items-center gap-2"><span>🔄</span> สาเหตุม้วนกรอ</p>
                <span className="text-xs text-gray-400">{badReasons.length} สาเหตุ · {fmtKg(badKg)} kg</span>
              </div>
              {badReasons.length === 0 ? (
                <div className="py-10 text-center text-gray-400 text-sm">ไม่มีข้อมูล</div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase tracking-wider sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">เหตุผล</th>
                        <th className="px-3 py-2 text-right font-semibold">ครั้ง</th>
                        <th className="px-3 py-2 text-right font-semibold">น้ำหนัก (kg)</th>
                        <th className="px-3 py-2 text-right font-semibold">% ของกรอ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {badReasons.map(r => (
                        <tr key={r.reason} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-700">{r.reason}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{r.count}</td>
                          <td className="px-3 py-2 text-right font-bold text-orange-500">{num(r.weight, 1)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">
                            {badKg ? (r.weight / badKg * 100).toFixed(1) : 0}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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

        {/* ════════════════════════════════ TAB: SO REPORTS ════════════════════════════════ */}
        {tab === 'so' && (
          <div className="space-y-4">
            {/* สรุปบนสุด */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border-l-4 border-blue-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500 font-medium">📋 จำนวน SO</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{soGroups.length}</p>
                <p className="text-blue-500 text-xs mt-1">{jobsFiltered.length} ใบงาน</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-purple-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500 font-medium">📦 รวมยอดสั่ง</p>
                <p className="text-3xl font-black text-gray-800 mt-1">
                  {fmtKg(soGroups.reduce((s, g) => s + g.planned, 0))} <span className="text-sm text-gray-400 font-semibold">kg</span>
                </p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-green-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500 font-medium">✅ ผลิตได้ (FG)</p>
                <p className="text-3xl font-black text-gray-800 mt-1">
                  {fmtKg(soGroups.reduce((s, g) => s + g.goodKg, 0))} <span className="text-sm text-gray-400 font-semibold">kg</span>
                </p>
                <p className="text-green-500 text-xs mt-1">{soGroups.reduce((s, g) => s + g.goodRolls, 0)} ม้วน</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-amber-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500 font-medium">📈 Yield เฉลี่ย</p>
                <p className="text-3xl font-black text-gray-800 mt-1">
                  {(() => {
                    const tot = soGroups.reduce((s, g) => s + g.total, 0)
                    const gd  = soGroups.reduce((s, g) => s + g.goodKg, 0)
                    return tot ? (gd / tot * 100).toFixed(1) : '0.0'
                  })()}<span className="text-sm text-gray-400 font-semibold">%</span>
                </p>
              </div>
            </div>

            {/* รายการ SO */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <p className="font-bold text-gray-700 flex items-center gap-2"><span>📊</span> รายงานการผลิตตาม WO &gt; SO &gt; Lot</p>
              </div>
              {woGroups.length === 0 ? (
                <div className="py-16 text-center text-gray-400">ยังไม่มีงานปิดในช่วงนี้</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {woGroups.map(wg => {
                    const woKey  = `wo:${wg.wo}`
                    const woOpen = openSO[woKey] ?? true
                    return (
                      <div key={wg.wo}>
                        {/* ── WO LEVEL ────────────────────────────── */}
                        <button onClick={() => setOpenSO(p => ({ ...p, [woKey]: !woOpen }))}
                          className="w-full flex items-center gap-3 px-5 py-3 hover:bg-amber-50/50 transition-colors text-left border-l-4 border-amber-500">
                          <span className="text-amber-500 text-base font-bold">{woOpen ? '▼' : '▶'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-mono font-black text-white text-sm bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1 rounded-lg shadow">📋 WO: {wg.wo}</span>
                              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-semibold">{wg.sos.length} SO · {wg.jobs} งาน</span>
                              <span className={`text-xs px-2 py-0.5 rounded font-bold ${wg.yieldPct >= 90 ? 'bg-green-100 text-green-700' : wg.yieldPct >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                Yield {wg.yieldPct.toFixed(1)}%
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 flex items-center gap-3 flex-wrap">
                              <span>👥 {wg.customers.join(', ') || '—'}</span>
                              <span>🏭 {wg.machines.join(', ')}</span>
                              {wg.products[0] && <span className="truncate max-w-[300px]">📦 {wg.products.join(', ')}</span>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="flex gap-4 text-sm">
                              <div><p className="text-[10px] text-gray-400 uppercase">สั่ง</p><p className="font-bold text-gray-700">{num(wg.planned, 0)}</p></div>
                              <div><p className="text-[10px] text-gray-400 uppercase">FG</p><p className="font-bold text-blue-600">{num(wg.goodKg, 1)}</p></div>
                              <div><p className="text-[10px] text-gray-400 uppercase">กรอ</p><p className="font-bold text-orange-500">{num(wg.badKg, 1)}</p></div>
                              <div><p className="text-[10px] text-gray-400 uppercase">เศษ</p><p className="font-bold text-red-500">{num(wg.scrapKg, 1)}</p></div>
                            </div>
                          </div>
                        </button>

                        {woOpen && wg.sos.map(sg => {
                          const soKey  = `${woKey}|so:${sg.so}`
                          const soOpen = openSO[soKey] ?? true
                          return (
                            <div key={sg.so} className="ml-6 border-l-2 border-blue-500/30">
                              {/* ── SO LEVEL ────────────────────────── */}
                              <button onClick={() => setOpenSO(p => ({ ...p, [soKey]: !soOpen }))}
                                className="w-full flex items-center gap-3 px-5 py-2 bg-blue-50/30 hover:bg-blue-50/60 transition-colors text-left">
                                <span className="text-blue-500 text-sm">{soOpen ? '▼' : '▶'}</span>
                                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                  <span className="font-mono font-bold text-blue-700 text-sm bg-blue-100 px-2.5 py-0.5 rounded">SO: {sg.so}</span>
                                  <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{sg.lots.length} Lot · {sg.jobs} งาน</span>
                                </div>
                                <div className="flex gap-3 text-xs shrink-0">
                                  <span className="text-gray-500">FG <b className="text-blue-600">{num(sg.goodKg, 1)}</b></span>
                                  <span className="text-gray-500">กรอ <b className="text-orange-500">{num(sg.badKg, 1)}</b></span>
                                  <span className="text-gray-500">เศษ <b className="text-red-500">{num(sg.scrapKg, 1)}</b></span>
                                </div>
                              </button>

                              {soOpen && sg.lots.map(lg => {
                                const lotKey  = `${soKey}|lot:${lg.lot}`
                                const lotOpen = openSO[lotKey] ?? true
                                return (
                                  <div key={lg.lot} className="ml-6 border-l-2 border-gray-200">
                                    {/* ── LOT LEVEL ─────────────────── */}
                                    <button onClick={() => setOpenSO(p => ({ ...p, [lotKey]: !lotOpen }))}
                                      className="w-full flex items-center gap-2 px-5 py-1.5 hover:bg-gray-50 transition-colors text-left">
                                      <span className="text-gray-400 text-xs">{lotOpen ? '▼' : '▶'}</span>
                                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-700">Lot {lg.lot}</span>
                                      <span className="text-[10px] text-gray-500">{lg.jobs.length} งาน · {fmtKg(lg.goodKg + lg.badKg + lg.scrapKg)} Kg</span>
                                    </button>

                                    {lotOpen && (
                                      <div className="bg-gray-50/50 px-5 pb-3 pt-1 overflow-x-auto">
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="text-gray-500 border-b border-gray-200">
                                              {['ปิดเมื่อ','เครื่อง','ลูกค้า','สินค้า','สั่ง (kg)','FG','กรอ','เศษ','โอนแล้ว','Yield','ผู้ปิด'].map(h=>(
                                                <th key={h} className="px-2 py-1.5 text-left font-semibold text-[10px] uppercase whitespace-nowrap">{h}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-100">
                                            {lg.jobs.map((j: any) => {
                                              const tot = (j.good_kg ?? 0) + (j.bad_kg ?? 0) + (j.scrap_kg ?? 0)
                                              const yp  = tot ? ((j.good_kg ?? 0)/tot*100) : 0
                                              return (
                                                <tr key={j.id} className="hover:bg-white">
                                                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{new Date(j.closed_at).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
                                                  <td className="px-2 py-1.5 font-bold text-blue-600">{j.machine_no}</td>
                                                  <td className="px-2 py-1.5 text-gray-600 max-w-[140px] truncate" title={j.customer}>{j.customer}</td>
                                                  <td className="px-2 py-1.5 text-gray-600 max-w-[140px] truncate" title={j.product_name}>{j.product_name}</td>
                                                  <td className="px-2 py-1.5 text-gray-700">{num(j.planned_qty ?? 0, 0)}</td>
                                                  <td className="px-2 py-1.5 text-blue-600 font-bold">{num(j.good_kg ?? 0, 1)} <span className="text-gray-400 font-normal">({j.good_rolls ?? 0}ม.)</span></td>
                                                  <td className="px-2 py-1.5 text-orange-500">{num(j.bad_kg ?? 0, 1)}</td>
                                                  <td className="px-2 py-1.5 text-red-500">{num(j.scrap_kg ?? 0, 1)}</td>
                                                  <td className="px-2 py-1.5 text-green-600">{num(j.transferred_kg ?? 0, 1)}</td>
                                                  <td className="px-2 py-1.5">
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${yp >= 90 ? 'bg-green-100 text-green-700' : yp >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                                      {yp.toFixed(1)}%
                                                    </span>
                                                  </td>
                                                  <td className="px-2 py-1.5 text-gray-500">{j.closed_by ?? '—'}</td>
                                                </tr>
                                              )
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════ TAB: TRANSFER REPORTS ════════════════════════════════ */}
        {tab === 'transfer' && (
          <div className="space-y-4">
            {/* KPI cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border-l-4 border-green-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500 font-medium">📄 ใบโอน</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{transfers.length}</p>
                <p className="text-green-500 text-xs mt-1">ในช่วงเวลานี้</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-blue-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500 font-medium">📦 ม้วนที่โอน</p>
                <p className="text-3xl font-black text-gray-800 mt-1">
                  {transfers.reduce((s, t) => s + (t.total_rolls ?? 0), 0)}
                </p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-purple-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500 font-medium">⚖ น้ำหนักรวม</p>
                <p className="text-3xl font-black text-gray-800 mt-1">
                  {fmtKg(transfers.reduce((s, t) => s + (t.total_kg ?? 0), 0))} <span className="text-sm text-gray-400 font-semibold">kg</span>
                </p>
              </div>
            </div>

            {/* ตารางใบโอน */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <p className="font-bold text-gray-700 flex items-center gap-2"><span>📋</span> ประวัติใบโอนคลัง</p>
              </div>
              {transfers.length === 0 ? (
                <div className="py-16 text-center text-gray-400">ยังไม่มีใบโอนในช่วงนี้</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-[11px] text-gray-500 uppercase tracking-wider">
                        {['เลขใบโอน','ประเภท','วันที่โอน','ผู้โอน','WO','SO','เครื่อง','สินค้า','Lot','ม้วน','น้ำหนัก (kg)'].map(h=>(
                          <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {transfers.map(t => {
                        const tt = t.transfer_type ?? 'good'
                        const typeBadge = tt === 'bad' ? 'bg-orange-100 text-orange-700' : tt === 'scrap' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                        const typeLabel = tt === 'bad' ? '🔄 ม้วนกรอ' : tt === 'scrap' ? '🗑 เศษ' : '✅ FG'
                        return (
                        <tr key={t.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 font-mono font-bold text-blue-600">{t.doc_no}</td>
                          <td className="px-3 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded ${typeBadge}`}>{typeLabel}</span></td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{new Date(t.transferred_at).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
                          <td className="px-3 py-2.5 text-amber-600 font-semibold">{t.transferred_by}</td>
                          <td className="px-3 py-2.5 text-amber-600 font-mono text-xs">{t.work_order ?? '—'}</td>
                          <td className="px-3 py-2.5 text-blue-500 font-mono text-xs">{t.sale_order ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-700 max-w-[150px] truncate" title={t.machine_no}>{t.machine_no}</td>
                          <td className="px-3 py-2.5 text-gray-600 max-w-[220px] truncate" title={t.product_name}>{t.product_name}</td>
                          <td className="px-3 py-2.5 text-gray-500 font-mono text-xs max-w-[160px] truncate" title={t.lot_no}>{t.lot_no}</td>
                          <td className="px-3 py-2.5 text-gray-700 text-center">{t.total_rolls}</td>
                          <td className="px-3 py-2.5 font-bold text-green-600">{num(t.total_kg ?? 0, 2)}</td>
                        </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                        <td className="px-3 py-2.5 text-gray-700" colSpan={9}>รวม {transfers.length} ใบโอน</td>
                        <td className="px-3 py-2.5 text-center text-gray-700">{transfers.reduce((s, t) => s + (t.total_rolls ?? 0), 0)}</td>
                        <td className="px-3 py-2.5 text-green-600">{num(transfers.reduce((s, t) => s + (t.total_kg ?? 0), 0), 2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════ TAB: MACHINES ════════════════════════════════ */}
        {tab === 'machines' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border-l-4 border-blue-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">🏭 เครื่องทั้งหมด</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{machineProfiles.length}</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-green-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">● กำลังเดิน (มีงาน)</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{machineProfiles.filter(m => m.lot_no).length}</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-gray-400 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">⏸ ว่าง</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{machineProfiles.filter(m => !m.lot_no).length}</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-amber-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">📦 งานจอด (Parked)</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{parkedJobs.length}</p>
              </div>
            </div>

            {/* Machine list */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100"><p className="font-bold text-gray-700">🏭 สถานะเครื่องจักร (Live)</p></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                    <tr>{['เครื่อง','แผนก','Lot','ลูกค้า','สินค้า','ขนาด','Plan(kg)','WO','SO','วันที่ส่ง','ผู้ตรวจ','สถานะ'].map(h => <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {machineProfiles.map(m => (
                      <tr key={m.machine_no} className="hover:bg-gray-50">
                        <td className="px-3 py-2"><span className="bg-blue-100 text-blue-700 font-bold text-xs px-2 py-0.5 rounded">{m.machine_no}</span></td>
                        <td className="px-3 py-2 text-gray-500">{m.section ?? 'blow'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{m.lot_no || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate" title={m.cust_name}>{m.cust_name || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 max-w-[160px] truncate" title={m.product_name}>{m.product_name || '—'}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{m.width_cm && m.thick_mc ? `${m.width_cm}×${m.thick_mc}` : '—'}</td>
                        <td className="px-3 py-2 text-blue-600 font-bold">{m.planned_qty ? num(+m.planned_qty, 0) : '—'}</td>
                        <td className="px-3 py-2 text-amber-600 font-mono text-xs">{m.work_order || '—'}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono text-xs">{m.sale_order || '—'}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{m.delivery_date ? new Date(m.delivery_date).toLocaleDateString('th-TH') : '—'}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">{m.inspector || '—'}</td>
                        <td className="px-3 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.lot_no ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{m.lot_no ? '● เดิน' : '⏸ ว่าง'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Parked Jobs */}
            {parkedJobs.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100"><p className="font-bold text-gray-700">📦 งานจอด (Parked Jobs)</p></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                      <tr>{['เครื่อง','จอดเมื่อ','ผู้จอด','Lot','สินค้า'].map(h => <th key={h} className="px-3 py-2.5 text-left font-semibold">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {parkedJobs.map((p, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-bold text-blue-600">{p.machine_no}</td>
                          <td className="px-3 py-2 text-gray-500">{new Date(p.parked_at).toLocaleString('th-TH')}</td>
                          <td className="px-3 py-2 text-amber-600">{p.parked_by}</td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-700">{p.profile_snapshot?.lotNo ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{p.profile_snapshot?.productName ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════ TAB: CUSTOMERS / PRODUCTS ════════════════════════════════ */}
        {tab === 'customers' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border-l-4 border-blue-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">👥 ลูกค้าทั้งหมด</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{customersDb.length}</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-purple-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">📦 SKU (Item Code)</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{productsList.length}</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-green-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">🎯 ลูกค้าที่มีงานในช่วงนี้</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{new Set(jobs.map(j => j.customer).filter(Boolean)).size}</p>
              </div>
            </div>

            {/* Top customers by FG */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100"><p className="font-bold text-gray-700">🏆 ลูกค้า — Top by FG (kg)</p></div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase sticky top-0">
                      <tr>{['#','ลูกค้า','งาน','FG (kg)','% ของรวม'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        const m = new Map<string, { count: number; kg: number }>()
                        for (const j of jobs) {
                          const k = j.customer ?? '(ไม่ระบุ)'
                          const v = m.get(k) ?? { count: 0, kg: 0 }
                          v.count += 1
                          v.kg    += j.good_kg ?? 0
                          m.set(k, v)
                        }
                        const list = [...m.entries()].map(([c, v]) => ({ c, ...v })).sort((a,b) => b.kg - a.kg)
                        const tot = list.reduce((s,x) => s + x.kg, 0)
                        return list.map((row, i) => (
                          <tr key={row.c} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-500">{i+1}</td>
                            <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate" title={row.c}>{row.c}</td>
                            <td className="px-3 py-2 text-gray-500">{row.count}</td>
                            <td className="px-3 py-2 font-bold text-blue-600">{num(row.kg, 1)}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">{tot ? (row.kg / tot * 100).toFixed(1) : 0}%</td>
                          </tr>
                        ))
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top products */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100"><p className="font-bold text-gray-700">📦 สินค้า — Top by FG (kg)</p></div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase sticky top-0">
                      <tr>{['#','สินค้า','Item Code','FG (kg)'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        const m = new Map<string, { code: string; kg: number }>()
                        for (const j of jobs) {
                          const k = j.product_name ?? '(ไม่ระบุ)'
                          const v = m.get(k) ?? { code: j.item_code ?? '', kg: 0 }
                          v.kg += j.good_kg ?? 0
                          m.set(k, v)
                        }
                        return [...m.entries()].map(([p, v]) => ({ p, ...v })).sort((a,b) => b.kg - a.kg).slice(0, 30).map((row, i) => (
                          <tr key={row.p} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-500">{i+1}</td>
                            <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate" title={row.p}>{row.p}</td>
                            <td className="px-3 py-2 text-gray-500 font-mono text-xs">{row.code}</td>
                            <td className="px-3 py-2 font-bold text-blue-600">{num(row.kg, 1)}</td>
                          </tr>
                        ))
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Customer master */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100"><p className="font-bold text-gray-700">👥 รายชื่อลูกค้าทั้งหมด ({customersDb.length})</p></div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase sticky top-0">
                    <tr>{['รหัส','ชื่อลูกค้า','ที่อยู่','หมายเหตุ'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {customersDb.map(c => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs font-bold text-blue-600">{c.cust_code}</td>
                        <td className="px-3 py-2 text-gray-700">{c.cust_name}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs max-w-[280px] truncate" title={c.cust_address}>{c.cust_address ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{c.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}


        {/* ════════════════════════════════ TAB: REWORK ════════════════════════════════ */}
        {tab === 'rework' && (() => {
          const fromProd = reworkRolls.filter(r => !r.is_legacy)
          const fromExt  = reworkRolls.filter(r =>  r.is_legacy)

          const pareto = (list: any[], field: string) => {
            const m = new Map<string, { count: number; kg: number }>()
            for (const r of list) {
              const k = (r[field] ?? '').trim() || '(ไม่ระบุ)'
              const v = m.get(k) ?? { count: 0, kg: 0 }
              v.count += 1; v.kg += r.weight ?? 0
              m.set(k, v)
            }
            return [...m.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.kg - a.kg)
          }

          const summary = (list: any[]) => {
            const reworked = list.filter(r => r.rework_status === 'reworked')
            const scrapped = list.filter(r => r.rework_status === 'scrapped')
            const sum = (arr: any[]) => arr.reduce((s, r) => s + (r.weight ?? 0), 0)
            return {
              total: list.length,
              totalKg: sum(list),
              reworkedKg: sum(reworked),
              reworkedCount: reworked.length,
              scrappedKg: sum(scrapped),
              scrappedCount: scrapped.length,
              reasonsIn:  pareto(list, 'remark'),
              reasonsOut: pareto(scrapped, 'rework_remark'),
            }
          }

          const P = summary(fromProd)
          const E = summary(fromExt)

          const renderBlock = (label: string, emoji: string, color: string, S: ReturnType<typeof summary>) => (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className={`px-5 py-3 ${color} text-white`}>
                <p className="font-black text-lg flex items-center gap-2">{emoji} {label}</p>
                <p className="text-white/80 text-xs mt-0.5">รับเข้ารวม {fmtKg(S.totalKg)} kg</p>
              </div>

              <div className="grid grid-cols-2 gap-3 p-4">
                <div className="bg-green-50 border-l-4 border-green-500 rounded-lg p-3">
                  <p className="text-green-700 text-xs font-bold uppercase">✓ กรอได้</p>
                  <p className="text-green-700 text-3xl font-black mt-1">{fmtKg(S.reworkedKg)}<span className="text-sm font-normal text-gray-500"> kg</span></p>
                  <p className="text-green-600 text-xs">{S.totalKg ? (S.reworkedKg/S.totalKg*100).toFixed(1) : 0}% ของรับเข้า</p>
                </div>
                <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-3">
                  <p className="text-red-700 text-xs font-bold uppercase">🗑 เศษ (ทำลาย)</p>
                  <p className="text-red-700 text-3xl font-black mt-1">{fmtKg(S.scrappedKg)}<span className="text-sm font-normal text-gray-500"> kg</span></p>
                  <p className="text-red-600 text-xs">{S.totalKg ? (S.scrappedKg/S.totalKg*100).toFixed(1) : 0}% ของรับเข้า</p>
                </div>
              </div>

              <div className="px-4 pb-4 space-y-3">
                <div>
                  <p className="text-xs font-bold text-gray-600 mb-1.5">🔍 ทำไมต้องเอามากรอ ({S.reasonsIn.length} สาเหตุ)</p>
                  {S.reasonsIn.length === 0 ? <p className="text-xs text-gray-400 italic">ไม่มีข้อมูล</p> : (
                    <div className="max-h-40 overflow-y-auto bg-gray-50 rounded-lg">
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-gray-100">
                          {S.reasonsIn.map((r, i) => (
                            <tr key={r.k}>
                              <td className="px-2 py-1.5 text-gray-400 w-6">{i+1}.</td>
                              <td className="px-2 py-1.5 text-gray-700">{r.k}</td>
                              <td className="px-2 py-1.5 text-right text-orange-600 font-bold">{num(r.kg, 1)}</td>
                              <td className="px-2 py-1.5 text-right text-gray-400 w-12">{S.totalKg ? (r.kg/S.totalKg*100).toFixed(0) : 0}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs font-bold text-gray-600 mb-1.5">🗑 ทำลายเพราะอะไร ({S.reasonsOut.length} สาเหตุ · {fmtKg(S.scrappedKg)} kg)</p>
                  {S.reasonsOut.length === 0 ? <p className="text-xs text-gray-400 italic">ไม่มีการทำลาย</p> : (
                    <div className="max-h-40 overflow-y-auto bg-red-50/50 rounded-lg">
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-red-100">
                          {S.reasonsOut.map((r, i) => (
                            <tr key={r.k}>
                              <td className="px-2 py-1.5 text-gray-400 w-6">{i+1}.</td>
                              <td className="px-2 py-1.5 text-gray-700">{r.k}</td>
                              <td className="px-2 py-1.5 text-right text-red-600 font-bold">{num(r.kg, 1)}</td>
                              <td className="px-2 py-1.5 text-right text-gray-400 w-12">{S.scrappedKg ? (r.kg/S.scrappedKg*100).toFixed(0) : 0}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )

          return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {renderBlock('กรอจากเป่า', '🏭', 'bg-gradient-to-r from-blue-500 to-blue-600', P)}
              {renderBlock('กรอจากงานอื่นๆ', '📦', 'bg-gradient-to-r from-purple-500 to-purple-600', E)}
            </div>
          )
        })()}

        {/* ════════════════════════════════ TAB: LOGS ════════════════════════════════ */}
        {tab === 'logs' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border-l-4 border-blue-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">⚖ บันทึกการชั่ง (Weigh Logs)</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{weighLogs.length}</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-red-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">🗑 ลบม้วน (Deletion Logs)</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{deletionLogs.length}</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-amber-500 border border-gray-200 shadow-sm p-4">
                <p className="text-xs text-gray-500">นน.ลบรวม (kg)</p>
                <p className="text-3xl font-black text-gray-800 mt-1">{fmtKg(deletionLogs.reduce((s, d) => s + (d.weight ?? 0), 0))}</p>
              </div>
            </div>

            {/* Weigh logs */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100"><p className="font-bold text-gray-700">⚖ บันทึกการชั่งล่าสุด (500 รายการ)</p></div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase sticky top-0">
                    <tr>{['เวลา','WO','SO','เครื่อง','Lot','ม้วน','ประเภท','Gross','Core','Net','ผู้ตรวจ','หมายเหตุ'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {weighLogs.map(l => (
                      <tr key={l.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(l.created_at).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
                        <td className="px-3 py-2 text-amber-600 font-mono text-xs">{l.work_order ?? '—'}</td>
                        <td className="px-3 py-2 text-blue-500 font-mono text-xs">{l.sale_order ?? '—'}</td>
                        <td className="px-3 py-2 font-bold text-blue-600">{l.machine_no}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{l.lot_no}</td>
                        <td className="px-3 py-2 text-gray-700">#{l.roll_no}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">{l.roll_type}</td>
                        <td className="px-3 py-2 text-gray-500">{num(l.gross_weight, 2)}</td>
                        <td className="px-3 py-2 text-gray-500">{num(l.core_weight, 2)}</td>
                        <td className="px-3 py-2 font-bold text-blue-600">{num(l.net_weight, 2)}</td>
                        <td className="px-3 py-2 text-amber-600 text-xs">{l.inspector ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs max-w-[160px] truncate" title={l.remark}>{l.remark ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Deletion logs */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100"><p className="font-bold text-gray-700">🗑 บันทึกการลบม้วน</p></div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase sticky top-0">
                    <tr>{['ลบเมื่อ','WO','SO','เครื่อง','Lot','ม้วน','ประเภท','นน.','ผู้ลบ','เหตุผล'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {deletionLogs.map(d => (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(d.deleted_at).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
                        <td className="px-3 py-2 text-amber-600 font-mono text-xs">{d.work_order ?? '—'}</td>
                        <td className="px-3 py-2 text-blue-500 font-mono text-xs">{d.sale_order ?? '—'}</td>
                        <td className="px-3 py-2 font-bold text-blue-600">{d.machine_no}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{d.lot_no}</td>
                        <td className="px-3 py-2 text-gray-700">#{d.roll_no}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">{d.roll_type}</td>
                        <td className="px-3 py-2 text-red-500 font-bold">{num(d.weight, 2)}</td>
                        <td className="px-3 py-2 text-amber-600 text-xs">{d.deleted_by}</td>
                        <td className="px-3 py-2 text-gray-700 text-xs max-w-[280px] truncate" title={d.reason}>{d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

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
        {tab === 'compare' && (() => {
          // ── ใช้ compRolls ที่ fetch แยกตาม compPeriod ──
          const now = new Date()
          const daysBack = compPeriod === '1d' ? 1 : compPeriod === '7d' ? 7 : compPeriod === '15d' ? 15 : compPeriod === '1m' ? 30 : compPeriod === '3m' ? 90 : compPeriod === '6m' ? 180 : 365
          const periodFrom = new Date(now); periodFrom.setDate(now.getDate() - daysBack); periodFrom.setHours(0,0,0,0)
          const rangeRolls = compRolls

          // ── group ตาม dimension ──
          type Bucket = { key: string; FG: number; ม้วนกรอ: number; เศษใส: number; เศษสี: number; เศษก้อน: number; total: number; rolls: number }
          const bucketMap = new Map<string, Bucket>()
          const emptyB = (k: string): Bucket => ({ key: k, FG: 0, ม้วนกรอ: 0, เศษใส: 0, เศษสี: 0, เศษก้อน: 0, total: 0, rolls: 0 })

          for (const r of rangeRolls) {
            let key = ''
            if (compDim === 'machine')   key = r.machine_no ?? '—'
            else if (compDim === 'day')  key = (r.created_at as string).slice(0, 10)
            else if (compDim === 'so')   key = ((r as any).sale_order ?? '').trim() || '(ไม่ระบุ SO)'
            else if (compDim === 'wo')   key = ((r as any).work_order ?? '').trim() || '(ไม่ระบุ WO)'
            else if (compDim === 'customer') key = r.customer ?? '—'
            else if (compDim === 'product')  key = r.product_name ?? '—'
            else if (compDim === 'size')     key = (r.width_cm && r.thick_mc) ? `${r.width_cm}×${r.thick_mc}` : '—'
            else if (compDim === 'reason')   key = (r.remark ?? '').trim() || '(ไม่ระบุเหตุผล)'
            else if (compDim === 'inspector') key = (r as any).inspector ?? '—'
            else if (compDim === 'section')   key = (r as any).section ?? 'blow'

            // skip reason dim เฉพาะม้วนที่ไม่มีปัญหา (good rolls มักไม่มี remark)
            if (compDim === 'reason' && r.roll_type === 'good') continue

            if (!bucketMap.has(key)) bucketMap.set(key, emptyB(key))
            const b = bucketMap.get(key)!
            const w = r.weight ?? 0
            if (r.roll_type === 'good') b.FG       += w
            else if (r.roll_type === 'bad') b.ม้วนกรอ += w
            else if (r.roll_type === 'scrap_clear') b.เศษใส += w
            else if (r.roll_type === 'scrap_color') b.เศษสี += w
            else if (r.roll_type === 'scrap_lump')  b.เศษก้อน += w
            b.total += w
            b.rolls += 1
          }

          const data = [...bucketMap.values()].sort((a, b) => b.total - a.total).slice(0, 30)
          // ถ้าเป็น day → เรียง chronologically
          if (compDim === 'day') data.sort((a, b) => a.key.localeCompare(b.key))

          const dimLabel = compDim === 'machine' ? 'เครื่องจักร' : compDim === 'day' ? 'วัน' : compDim === 'so' ? 'Sale Order' : compDim === 'wo' ? 'Work Order' : compDim === 'customer' ? 'ลูกค้า' : compDim === 'product' ? 'สินค้า' : compDim === 'size' ? 'ขนาด' : compDim === 'reason' ? 'สาเหตุของเสีย' : compDim === 'inspector' ? 'ผู้ตรวจสอบ' : 'แผนก'
          const periodLabel = compPeriod === '1d' ? '1 วัน' : compPeriod === '7d' ? '7 วัน' : compPeriod === '15d' ? '15 วัน' : compPeriod === '1m' ? '1 เดือน' : compPeriod === '3m' ? '3 เดือน' : compPeriod === '6m' ? '6 เดือน' : '1 ปี'

          return (
          <div className="space-y-4">
            {/* Controls */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
              <div>
                <p className="text-[10px] text-gray-400 mb-1.5 font-semibold uppercase tracking-wider">📐 มิติเปรียบเทียบ</p>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { k:'machine',  label:'🏭 เครื่อง' },
                    { k:'day',      label:'📅 รายวัน' },
                    { k:'wo',       label:'📋 WO' },
                    { k:'so',       label:'📝 SO' },
                    { k:'customer', label:'👥 ลูกค้า' },
                    { k:'product',  label:'📦 สินค้า' },
                    { k:'size',     label:'📏 ขนาด' },
                    { k:'reason',   label:'⚠ สาเหตุของเสีย' },
                    { k:'inspector',label:'👤 ผู้ตรวจสอบ' },
                    { k:'section',  label:'🏗 แผนก' },
                  ] as const).map(t => (
                    <button key={t.k} onClick={() => setCompDim(t.k)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${compDim===t.k ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] text-gray-400 mb-1.5 font-semibold uppercase tracking-wider">⏱ ช่วงเวลา (ย้อนหลัง)</p>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { k:'1d',  label:'1 วัน' },
                    { k:'7d',  label:'7 วัน' },
                    { k:'15d', label:'15 วัน' },
                    { k:'1m',  label:'1 เดือน' },
                    { k:'3m',  label:'3 เดือน' },
                    { k:'6m',  label:'6 เดือน' },
                    { k:'1y',  label:'1 ปี' },
                  ] as const).map(t => (
                    <button key={t.k} onClick={() => setCompPeriod(t.k)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${compPeriod===t.k ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border-l-4 border-blue-500 border border-gray-200 shadow-sm p-3">
                <p className="text-[10px] text-gray-500">📊 รายการเปรียบเทียบ</p>
                <p className="text-2xl font-black text-gray-800 mt-0.5">{data.length}</p>
                <p className="text-[10px] text-gray-400">{dimLabel}</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-purple-500 border border-gray-200 shadow-sm p-3">
                <p className="text-[10px] text-gray-500">⏱ ช่วงเวลา</p>
                <p className="text-2xl font-black text-gray-800 mt-0.5">{periodLabel}</p>
                <p className="text-[10px] text-gray-400">{periodFrom.toLocaleDateString('th-TH')} → วันนี้</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-green-500 border border-gray-200 shadow-sm p-3">
                <p className="text-[10px] text-gray-500">📦 ม้วนทั้งหมด</p>
                <p className="text-2xl font-black text-gray-800 mt-0.5">{rangeRolls.length}</p>
              </div>
              <div className="bg-white rounded-xl border-l-4 border-orange-500 border border-gray-200 shadow-sm p-3">
                <p className="text-[10px] text-gray-500">⚖ น้ำหนักรวม</p>
                <p className="text-2xl font-black text-gray-800 mt-0.5">{fmtKg(rangeRolls.reduce((s, r) => s + (r.weight ?? 0), 0))} <span className="text-xs text-gray-400">kg</span></p>
              </div>
            </div>

            {/* Chart */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="font-bold text-gray-700 mb-4">📈 เปรียบเทียบ {dimLabel} — ช่วง {periodLabel}</p>
              {data.length === 0
                ? <div className="h-80 flex items-center justify-center text-gray-400">ไม่มีข้อมูลในช่วงนี้</div>
                : (
                <ResponsiveContainer width="100%" height={Math.max(380, data.length * 32)}>
                  <BarChart data={data} layout="vertical" margin={{ top: 10, right: 80, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false}/>
                    <XAxis type="number" tickFormatter={fmtKg} tick={{ fontSize: 10 }}/>
                    <YAxis type="category" dataKey="key" width={130} tick={{ fontSize: 11 }}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Legend wrapperStyle={{ fontSize: 11 }}/>
                    <Bar dataKey="FG"       fill="#3b82f6" stackId="a"/>
                    <Bar dataKey="ม้วนกรอ" fill="#f97316" stackId="a"/>
                    <Bar dataKey="เศษใส"   fill="#ef4444" stackId="a"/>
                    <Bar dataKey="เศษสี"   fill="#a855f7" stackId="a"/>
                    <Bar dataKey="เศษก้อน" fill="#d97706" stackId="a"
                      label={{ position:'right', formatter:(v: any) => fmtKg(Number(v)), fontSize: 10, fill:'#555' }}/>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Detail table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <p className="font-bold text-gray-700">📋 ตารางเปรียบเทียบ — {dimLabel}</p>
              </div>
              {data.length === 0 ? (
                <div className="py-10 text-center text-gray-400">ไม่มีข้อมูล</div>
              ) : (
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase sticky top-0">
                      <tr>{['#', dimLabel, 'ม้วน', 'FG (kg)', 'กรอ (kg)', 'เศษใส', 'เศษสี', 'เศษก้อน', 'รวม (kg)', '% ของรวม', 'Yield%'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.map((row, i) => {
                        const grandTotal = data.reduce((s, x) => s + x.total, 0)
                        const yieldPct = row.total ? (row.FG / row.total * 100) : 0
                        return (
                          <tr key={row.key} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                            <td className="px-3 py-2 text-gray-700 font-semibold max-w-[200px] truncate" title={row.key}>{row.key}</td>
                            <td className="px-3 py-2 text-gray-500">{row.rolls}</td>
                            <td className="px-3 py-2 text-blue-600 font-bold">{num(row.FG, 1)}</td>
                            <td className="px-3 py-2 text-orange-500">{num(row.ม้วนกรอ, 1)}</td>
                            <td className="px-3 py-2 text-red-400">{num(row.เศษใส, 1)}</td>
                            <td className="px-3 py-2 text-purple-500">{num(row.เศษสี, 1)}</td>
                            <td className="px-3 py-2 text-amber-600">{num(row.เศษก้อน, 1)}</td>
                            <td className="px-3 py-2 font-bold text-gray-700">{num(row.total, 1)}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">{grandTotal ? (row.total / grandTotal * 100).toFixed(1) : 0}%</td>
                            <td className="px-3 py-2">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${yieldPct >= 90 ? 'bg-green-100 text-green-700' : yieldPct >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                                {yieldPct.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          )
        })()}

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
