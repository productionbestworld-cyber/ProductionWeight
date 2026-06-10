import { useEffect, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import ExportButton from '../components/ExportButton'

function fmt(n: number | null | undefined, d = 1) {
  if (n == null || isNaN(n as number)) return (0).toFixed(d)
  return (n as number).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function dt(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

type Job = {
  key: string
  machine_no: string
  lot_no: string
  work_order: string
  sale_order: string
  product_name: string
  customer: string
  active: boolean        // เครื่องกำลังเดินงานนี้อยู่
  start?: string
  end?: string
  closedAt?: string
  target: number
  goodKg: number; goodRolls: number
  badKg: number;  badRolls: number
  scrapKg: number
}

export default function Planning({ dept }: { dept?: string }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: profs }, { data: rolls }, { data: sums }] = await Promise.all([
      supabase.from('machine_profiles').select('machine_no, lot_no, work_order, sale_order, product_name, cust_name, planned_qty, section'),
      supabase.from('production_rolls')
        .select('machine_no, lot_no, work_order, sale_order, product_name, customer, roll_type, weight, created_at, section')
        .order('created_at', { ascending: true }).limit(8000),
      supabase.from('job_summaries').select('machine_no, lot_no, work_order, planned_qty, closed_at').limit(2000),
    ])

    // งานปัจจุบันต่อเครื่อง (key = machine|lot|wo)
    const activeKey = new Set<string>()
    const targetByKey: Record<string, number> = {}
    for (const p of profs ?? []) {
      if (!p.machine_no) continue
      const k = `${p.machine_no}|${p.lot_no ?? ''}|${p.work_order ?? ''}`
      activeKey.add(k)
      const t = parseFloat(p.planned_qty ?? '') || 0
      if (t) targetByKey[k] = t
    }
    // เป้า + closed จาก job_summaries
    const closedByKey: Record<string, string> = {}
    for (const s of sums ?? []) {
      const k = `${s.machine_no}|${s.lot_no ?? ''}|${s.work_order ?? ''}`
      const t = parseFloat(s.planned_qty ?? '') || 0
      if (t && !targetByKey[k]) targetByKey[k] = t
      if (s.closed_at) closedByKey[k] = s.closed_at
    }

    const map = new Map<string, Job>()
    for (const r of rolls ?? []) {
      if (!r.machine_no) continue
      const k = `${r.machine_no}|${r.lot_no ?? ''}|${r.work_order ?? ''}`
      let j = map.get(k)
      if (!j) {
        j = {
          key: k, machine_no: r.machine_no, lot_no: r.lot_no ?? '', work_order: r.work_order ?? '',
          sale_order: r.sale_order ?? '', product_name: r.product_name ?? '', customer: r.customer ?? '',
          active: activeKey.has(k), target: targetByKey[k] ?? 0, closedAt: closedByKey[k],
          goodKg: 0, goodRolls: 0, badKg: 0, badRolls: 0, scrapKg: 0,
        }
        map.set(k, j)
      }
      if (!j.start || r.created_at < j.start) j.start = r.created_at
      if (!j.end   || r.created_at > j.end)   j.end   = r.created_at
      if (!j.sale_order && r.sale_order) j.sale_order = r.sale_order
      if (r.roll_type === 'good')      { j.goodKg += r.weight ?? 0; j.goodRolls += 1 }
      else if (r.roll_type === 'bad')  { j.badKg  += r.weight ?? 0; j.badRolls  += 1 }
      else if (typeof r.roll_type === 'string' && r.roll_type.startsWith('scrap')) { j.scrapKg += r.weight ?? 0 }
    }
    // เครื่องที่ตั้งงานแล้วแต่ยังไม่ได้ชั่ง (ไม่มี roll) — โชว์เป็น active ด้วย
    for (const p of profs ?? []) {
      if (!p.machine_no || !p.lot_no) continue
      const k = `${p.machine_no}|${p.lot_no}|${p.work_order ?? ''}`
      if (!map.has(k)) {
        map.set(k, {
          key: k, machine_no: p.machine_no, lot_no: p.lot_no, work_order: p.work_order ?? '',
          sale_order: p.sale_order ?? '', product_name: p.product_name ?? '', customer: p.cust_name ?? '',
          active: true, target: targetByKey[k] ?? 0,
          goodKg: 0, goodRolls: 0, badKg: 0, badRolls: 0, scrapKg: 0,
        })
      }
    }

    let list = [...map.values()]
    if (dept) {
      // กรองตามแผนก: ดูจาก section ของ profile (เป่า/พิมพ์/กรอ) — ถ้าไม่ระบุ แสดงทั้งหมด
    }
    list.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return (b.end || '').localeCompare(a.end || '')
    })
    setJobs(list)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = jobs.filter(j => {
    if (onlyActive && !j.active) return false
    if (!search.trim()) return true
    const s = search.toLowerCase()
    return [j.machine_no, j.lot_no, j.work_order, j.sale_order, j.product_name, j.customer]
      .filter(Boolean).some(x => String(x).toLowerCase().includes(s))
  })

  const activeCount = jobs.filter(j => j.active).length
  const totGood = filtered.reduce((s, j) => s + j.goodKg, 0)
  const totScrap = filtered.reduce((s, j) => s + j.scrapKg, 0)
  const totBad = filtered.reduce((s, j) => s + j.badKg, 0)

  return (
    <div className="bg-[#0a0f1e] p-4 min-h-[calc(100vh-48px)]">
      <div className="max-w-[1500px] mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-white font-bold text-xl flex items-center gap-2">📅 วางแผน — ติดตามสถานะงาน</h1>
            <p className="text-slate-400 text-xs mt-0.5">เครื่องเดินงานอะไร · เริ่ม-จบเมื่อไหร่ · ยอดผลิต · ม้วนกรอ · เศษ · ยอดคงเหลือที่ขาด</p>
          </div>
          <div className="flex gap-2">
            <ExportButton rows={filtered}
              cols={[
                { header:'เครื่อง', value:'machine_no' },
                { header:'สถานะ', value: (j:Job) => j.active ? 'กำลังเดิน' : 'จบงาน' },
                { header:'สินค้า', value:'product_name', width:28 },
                { header:'ลูกค้า', value:'customer', width:22 },
                { header:'WO', value:'work_order' },
                { header:'SO', value:'sale_order' },
                { header:'Lot', value:'lot_no', width:16 },
                { header:'เริ่มผลิต', value:(j:Job)=>dt(j.start), width:14 },
                { header:'จบงาน', value:(j:Job)=>j.active?'':dt(j.closedAt||j.end), width:14 },
                { header:'เป้า (kg)', value:'target' },
                { header:'ผลิตได้ (kg)', value:(j:Job)=>+j.goodKg.toFixed(1) },
                { header:'ม้วนดี', value:'goodRolls' },
                { header:'ม้วนกรอ (kg)', value:(j:Job)=>+j.badKg.toFixed(1) },
                { header:'เศษ (kg)', value:(j:Job)=>+j.scrapKg.toFixed(1) },
                { header:'คงเหลือขาด (kg)', value:(j:Job)=>+Math.max(0, j.target - j.goodKg).toFixed(1) },
              ]}
              fileName="แผนงาน_ติดตามผลิต" sheetName="ติดตามงาน" label="📥 Export" />
            <button onClick={load} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg">
              <RefreshCw size={12}/> รีเฟรช
            </button>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900 border-l-4 border-green-500 border border-slate-800 rounded-xl p-3">
            <p className="text-[11px] text-slate-500">🟢 เครื่องกำลังเดิน</p>
            <p className="text-2xl font-black text-green-400">{activeCount} <span className="text-xs font-normal text-slate-500">เครื่อง</span></p>
          </div>
          <div className="bg-slate-900 border-l-4 border-brand-500 border border-slate-800 rounded-xl p-3">
            <p className="text-[11px] text-slate-500">ผลิตได้รวม</p>
            <p className="text-2xl font-black text-brand-300">{fmt(totGood,0)} <span className="text-xs font-normal text-slate-500">kg</span></p>
          </div>
          <div className="bg-slate-900 border-l-4 border-amber-500 border border-slate-800 rounded-xl p-3">
            <p className="text-[11px] text-slate-500">ม้วนกรอรวม</p>
            <p className="text-2xl font-black text-amber-400">{fmt(totBad,0)} <span className="text-xs font-normal text-slate-500">kg</span></p>
          </div>
          <div className="bg-slate-900 border-l-4 border-red-500 border border-slate-800 rounded-xl p-3">
            <p className="text-[11px] text-slate-500">เศษรวม</p>
            <p className="text-2xl font-black text-red-400">{fmt(totScrap,0)} <span className="text-xs font-normal text-slate-500">kg</span></p>
          </div>
        </div>

        {/* Search + filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหา เครื่อง/WO/SO/Lot/สินค้า/ลูกค้า..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white outline-none focus:border-brand-500"/>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)}/>
            เฉพาะเครื่องที่กำลังเดิน
          </label>
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/40 text-[10px] text-slate-500 uppercase tracking-wider">
                <tr>
                  {['เครื่อง','สถานะ','สินค้า / WO / SO / Lot','เริ่มผลิต','จบงาน','เป้า','ผลิตได้','กรอ','เศษ','คงเหลือ (ขาด)','%'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {loading ? (
                  <tr><td colSpan={11} className="py-16 text-center text-slate-500">กำลังโหลด...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={11} className="py-16 text-center text-slate-600">ไม่มีงาน</td></tr>
                ) : filtered.map(j => {
                  const remain = Math.max(0, j.target - j.goodKg)
                  const pct = j.target > 0 ? Math.min(100, Math.round(j.goodKg / j.target * 100)) : 0
                  return (
                    <tr key={j.key} className={`hover:bg-slate-800/30 ${j.active ? 'bg-green-500/5' : ''}`}>
                      <td className="px-3 py-2 font-black text-white whitespace-nowrap">{j.machine_no}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {j.active
                          ? <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-500/20 text-green-300 flex items-center gap-1 w-fit"><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/>กำลังเดิน</span>
                          : <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-700 text-slate-300">จบงาน</span>}
                      </td>
                      <td className="px-3 py-2 min-w-[240px]">
                        <p className="text-white text-xs font-semibold truncate max-w-[260px]">{j.product_name || '—'}</p>
                        <div className="flex items-center gap-1.5 flex-wrap text-[10px] mt-0.5">
                          {j.work_order && <span className="bg-amber-500/15 text-amber-300 px-1.5 rounded">WO {j.work_order}</span>}
                          {j.sale_order && <span className="bg-blue-500/15 text-blue-300 px-1.5 rounded">SO {j.sale_order}</span>}
                          <span className="font-mono text-slate-500">Lot {j.lot_no}</span>
                          {j.customer && <span className="text-slate-500">· {j.customer}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">{dt(j.start)}</td>
                      <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">{j.active ? '—' : dt(j.closedAt || j.end)}</td>
                      <td className="px-3 py-2 text-right text-slate-300 whitespace-nowrap">{j.target ? fmt(j.target,0) : '—'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap"><b className="text-green-400">{fmt(j.goodKg)}</b><span className="text-slate-600 text-[10px]"> · {j.goodRolls}ม้วน</span></td>
                      <td className="px-3 py-2 text-right text-amber-400 whitespace-nowrap">{j.badKg ? fmt(j.badKg) : '—'}</td>
                      <td className="px-3 py-2 text-right text-red-400 whitespace-nowrap">{j.scrapKg ? fmt(j.scrapKg) : '—'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {j.target ? <b className={remain > 0 ? 'text-orange-400' : 'text-green-400'}>{remain > 0 ? fmt(remain) : '✓ ครบ'}</b> : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400 text-xs whitespace-nowrap">{j.target ? `${pct}%` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
