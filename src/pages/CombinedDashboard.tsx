// รวมข้อมูลเก่า (production_records) + ใหม่ (production_rolls แปลงเป็น ProductionRecord)
// แล้วเรนเดอร์ด้วยแท็บแดชบอดเก่าทั้งชุด → รายละเอียดเหมือนแดชบอดเก่าทุกอย่าง
import { useEffect, useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { supabase, fetchAll } from '../lib/supabase'
import { supabase as legacySupabase } from '../legacy/lib/supabase'
import DashboardTab from '../legacy/pages/DashboardTab'
import DailyTab from '../legacy/pages/DailyTab'
import ProblemsTab from '../legacy/pages/ProblemsTab'
import CompareTab from '../legacy/pages/CompareTab'
import TableTab from '../legacy/pages/TableTab'
import { applyFilter, kpiCalc, uniq } from '../legacy/lib/utils'
import type { ProductionRecord, FilterState } from '../legacy/lib/types'

// ขึ้น v2: ค่าเดิมที่ค้างในเครื่องผู้ใช้คือ 2026-06-01 ซึ่งจะทำให้ข้อมูลเก่า 1–13 มิ.ย. หายทั้งก้อน
const CUTOFF_KEY = 'bwp_combined_cutoff_v2'
// วันสุดท้ายที่ระบบเก่าบันทึกคือ 2026-06-13 → ตั้งแต่ 14 มิ.ย. ใช้ระบบใหม่ล้วน ไม่มีช่วงคาบเกี่ยว
const SEAM_DATE = '2026-06-14'
type Tab = 'dashboard' | 'daily' | 'problems' | 'compare' | 'table'
const EMPTY: FilterState = { from:'', to:'', machine:'', customer:'', size:'', shift:'', search:'' }

// วันที่ตามเวลาไทย (กันม้วนใกล้เที่ยงคืนถูกนับคนละวันกับแดชบอดใหม่)
function thaiDate(iso?: string) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) } catch { return (iso ?? '').slice(0, 10) }
}

// จับชื่อ/รหัสลูกค้าให้ตรงกันระหว่างเก่า(โค้ด) กับใหม่(ชื่อเต็ม)
function custKey(s?: string) {
  const t = (s ?? '').trim()
  if (/หาดทิพย์|HAD/i.test(t)) return 'หาดทิพย์'
  if (/ไทยน้ำทิพย์|COK/i.test(t)) return 'ไทยน้ำทิพย์'
  if (/กรีนสปอต|กรีนสวิลล์|GP/i.test(t)) return 'กรีนสปอต'
  if (/เสริมสุข|SE/i.test(t)) return 'เสริมสุข'
  if (/โอสถสภา/i.test(t)) return 'โอสถสภา'
  if (/กระทิงแดง|TCF/i.test(t)) return 'กระทิงแดง'
  return t || '(ไม่ระบุ)'
}

export default function CombinedDashboard() {
  const [oldRows, setOldRows] = useState<ProductionRecord[]>([])
  const [newRows, setNewRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [cutoff, setCutoff] = useState(() => localStorage.getItem(CUTOFF_KEY) || SEAM_DATE)
  // โหมดช่วงรอยต่อ:
  //  'cut'  = ตัดตามจุดตัด (เก่าก่อนจุดตัด · ใหม่ตั้งแต่จุดตัด) ★ค่าเริ่มต้น — ตัวเลขตรงที่สุด
  //  'auto' = เครื่อง+วันไหนมีในระบบใหม่ ใช้ข้อมูลใหม่ · ที่เหลือใช้เก่า
  //           ⚠️ ช่วง 1–13 มิ.ย. ระบบใหม่ชั่งไม่ครบ โหมดนี้จะทิ้งข้อมูลเก่าทั้งวันแล้วเหลือแต่ยอดใหม่ที่ไม่ครบ
  //           (เช่น 8 มิ.ย. BL03 ของจริง 3,285 kg เหลือ 202 kg) — ข้อมูลช่วงนี้คลาดเคลื่อน
  //  'sum'  = บวกเก่า+ใหม่ทั้งหมด (วันทับกันจะนับซ้ำ)
  const [seamMode, setSeamMode] = useState<'auto' | 'sum' | 'cut'>('cut')
  const [filter, setFilter] = useState<FilterState>({ ...EMPTY })

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [oldData, newData] = await Promise.all([
        fetchAll(() => legacySupabase.from('production_records').select('*').order('production_date')),
        fetchAll(() => supabase.from('production_rolls')
          .select('created_at, roll_type, weight, machine_no, customer, product_name, product_code, width_cm, width_unit, thick_mc, work_order, sale_order, remark, section, is_rewound, rework_source_weight')
          .order('created_at', { ascending: true })),
      ])
      setOldRows(oldData); setNewRows(newData ?? [])
      setLoading(false)
    })()
  }, [])
  useEffect(() => { localStorage.setItem(CUTOFF_KEY, cutoff) }, [cutoff])

  // แปลงม้วน(ใหม่) → ProductionRecord รวมต่อ วัน+เครื่อง+ลูกค้า+สินค้า
  const newAsRecords = useMemo<ProductionRecord[]>(() => {
    const m = new Map<string, ProductionRecord>()
    for (const r of newRows) {
      const date = thaiDate(r.created_at); if (!date) continue
      const mc = (r.machine_no ?? '').trim()
      const cust = custKey(r.customer)
      const size = r.width_cm && r.thick_mc ? `${r.width_cm}${r.width_unit ?? 'cm'}×${r.thick_mc}mc` : ''
      // อาการต้องอยู่ใน key ด้วย ไม่งั้นน้ำหนักเสียของทั้งกลุ่มจะถูกโยนไปให้อาการของม้วนแรกม้วนเดียว
      // (ม้วนดีไม่มี remark → ตกกลุ่ม '' ตามเดิม ยอดรวม FG/KPI ไม่เปลี่ยนเพราะเป็นการบวกกันอยู่แล้ว)
      // remark ของม้วนดีไม่ใช่ "อาการ" — นับเฉพาะม้วนเสีย/เศษ
      const sym = r.roll_type === 'good' ? '' : String(r.remark ?? '').trim()
      const k = `${date}|${mc}|${cust}|${size}|${sym}`
      if (!m.has(k)) m.set(k, {
        production_date: date, machine: mc, customer: cust, size,
        product_code: r.product_code ?? '', order_no: r.work_order ?? '', sales_order: r.sale_order ?? '',
        shift: 'unknown', fg_kg: 0, fg_rolls: 0, scrap_kg: 0, rework_kg: 0, rework_rolls: 0,
        symptom: sym || undefined,
      } as ProductionRecord)
      const rec = m.get(k)!; const w = +(r.weight ?? 0)
      if (r.roll_type === 'good') {
        rec.fg_kg = (rec.fg_kg ?? 0) + w; rec.fg_rolls = (rec.fg_rolls ?? 0) + 1
        if ((r.section ?? '') === 'rewind' || (r as any).is_rewound === true) {
          rec.rework_fg_kg = (rec.rework_fg_kg ?? 0) + w
          // เศษจากกรอ = ส่วนต่างน้ำหนัก (หยิบม้วนเสียมา X → กรอได้ดี w → เศษ = X − w)
          const src = +(r.rework_source_weight ?? 0)
          if (src > w) rec.rework_scrap_kg = (rec.rework_scrap_kg ?? 0) + (src - w)
        }
      }
      else if (r.roll_type === 'bad') { rec.rework_kg = (rec.rework_kg ?? 0) + w; rec.rework_rolls = (rec.rework_rolls ?? 0) + 1 }
      else if (String(r.roll_type).startsWith('scrap')) { rec.scrap_kg = (rec.scrap_kg ?? 0) + w; if ((r.section ?? '') === 'rewind') rec.rework_scrap_kg = (rec.rework_scrap_kg ?? 0) + w }
    }
    return [...m.values()]
  }, [newRows])

  // รวม old(ก่อน cutoff) + new(ตั้งแต่ cutoff) + จับลูกค้าให้ตรงกัน
  const combinedAll = useMemo<ProductionRecord[]>(() => {
    const out: ProductionRecord[] = []
    // (วัน|เครื่อง) ที่มีในระบบใหม่ — สำหรับโหมด auto กันนับซ้ำ
    const newDayMc = new Set<string>()
    if (seamMode === 'auto') for (const r of newAsRecords) newDayMc.add(`${r.production_date}|${(r.machine ?? '').trim()}`)
    // ข้อมูลเก่า
    for (const r of oldRows) {
      const d = (r.production_date ?? '').slice(0, 10); if (!d) continue
      if (seamMode === 'cut' && d >= cutoff) continue
      if (seamMode === 'auto' && newDayMc.has(`${d}|${(r.machine ?? '').trim()}`)) continue  // วัน+เครื่องนี้มีในใหม่แล้ว → ข้าม
      out.push({ ...r, customer: custKey(r.customer) })
    }
    // ข้อมูลใหม่
    for (const r of newAsRecords) {
      const d = (r.production_date ?? ''); if (!d) continue
      if (seamMode === 'cut' && d < cutoff) continue
      out.push(r)
    }
    return out
  }, [oldRows, newAsRecords, cutoff, seamMode])

  const filtered = useMemo(() => applyFilter(combinedAll, filter), [combinedAll, filter])
  // แท็บเปรียบเทียบเลือกช่วงวันเอง จึงใช้ตัวกรองอื่นทั้งหมดแต่ไม่เอา from/to มาทับ
  const compareData = useMemo(() => applyFilter(combinedAll, { ...filter, from: '', to: '' }), [combinedAll, filter])
  const kpi = useMemo(() => kpiCalc(filtered), [filtered])
  const set = (k: keyof FilterState, v: string) => setFilter(f => ({ ...f, [k]: v }))
  const machines  = useMemo(() => uniq(combinedAll, 'machine'),  [combinedAll])
  const customers = useMemo(() => uniq(combinedAll, 'customer'), [combinedAll])
  const sizes     = useMemo(() => uniq(combinedAll, 'size'),     [combinedAll])

  const TABS: { key: Tab; label: string }[] = [
    { key:'dashboard', label:'📊 ภาพรวม' }, { key:'daily', label:'📅 รายวัน' },
    { key:'problems', label:'⚠️ ปัญหา & สาเหตุ' }, { key:'compare', label:'🔀 เปรียบเทียบ' }, { key:'table', label:'📋 ตาราง' },
  ]

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center text-gray-400" style={{ fontFamily:'"Sarabun",sans-serif' }}>
      <div className="text-center"><div className="w-9 h-9 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"/>กำลังรวมข้อมูลเก่า + ใหม่...</div>
    </div>
  )

  return (
    <div className="bg-gray-50 min-h-[calc(100vh-48px)]" style={{ fontFamily:'"Sarabun",sans-serif' }}>
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm px-5 py-3 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="font-bold text-gray-800 text-lg leading-tight">📊 รวมเทียบทั้งปี (เก่า + ใหม่)</p>
          <p className="text-xs text-gray-400">เก่า {oldRows.length.toLocaleString()} + ใหม่ {newRows.length.toLocaleString()} ม้วน · รวม {combinedAll.length.toLocaleString()} รายการ · {seamMode==='auto'?'โหมดอัตโนมัติ: เครื่อง+วันไหนมีในระบบใหม่ใช้ใหม่ ที่เหลือใช้เก่า (ไม่ตก ไม่ซ้ำ)':seamMode==='sum'?'โหมดรวมทั้งคู่: บวกเก่า+ใหม่ทั้งหมด':'โหมดตัดตามวันที่'}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-gray-100 border border-gray-200 rounded-lg p-0.5">
            {([['auto','อัตโนมัติ'],['sum','รวมทั้งคู่'],['cut','ตัดตามวันที่']] as const).map(([k,label]) => (
              <button key={k} onClick={() => setSeamMode(k as any)}
                className={`text-xs font-bold px-2.5 py-1 rounded ${seamMode===k ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-200'}`}>{label}</button>
            ))}
          </div>
          {seamMode === 'cut' && (
            <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-amber-50">
              <span className="text-xs text-gray-500">จุดตัด:</span>
              <input type="date" value={cutoff} onChange={e => setCutoff(e.target.value)} className="bg-white border border-gray-200 rounded px-2 py-1 text-sm text-gray-700 outline-none"/>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-5 flex gap-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-[3px] transition-all ${tab===t.key ? 'border-blue-500 text-blue-600 font-semibold' : 'border-transparent text-gray-500 hover:text-blue-500'}`}>{t.label}</button>
        ))}
      </div>

      <div className="px-5 py-4 max-w-screen-2xl mx-auto">
        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-gray-700">ตัวกรอง</p>
            <button onClick={() => setFilter({ ...EMPTY })} className="flex items-center gap-1 text-red-500 text-xs font-medium hover:text-red-600"><RotateCcw size={11}/> ล้างค่า</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div><p className="text-[10px] text-gray-400 mb-1">ตั้งแต่วันที่</p><input type="date" value={filter.from} onChange={e=>set('from',e.target.value)} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-blue-400"/></div>
            <div><p className="text-[10px] text-gray-400 mb-1">ถึงวันที่</p><input type="date" value={filter.to} onChange={e=>set('to',e.target.value)} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-blue-400"/></div>
            {[['เครื่องจักร','machine',machines],['ลูกค้า','customer',customers],['ขนาด','size',sizes]].map(([label,key,opts]) => (
              <div key={key as string}><p className="text-[10px] text-gray-400 mb-1">{label as string}</p>
                <select value={(filter as any)[key as string]} onChange={e=>set(key as keyof FilterState,e.target.value)} className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-blue-400 bg-white">
                  <option value="">ทั้งหมด</option>{(opts as string[]).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        {tab === 'dashboard' && <DashboardTab data={filtered} kpi={kpi} />}
        {tab === 'daily'     && <DailyTab     data={filtered} />}
        {tab === 'problems'  && <ProblemsTab  data={filtered} />}
        {tab === 'compare'   && <CompareTab   allData={compareData} />}
        {tab === 'table'     && <TableTab     data={filtered} />}
      </div>
    </div>
  )
}
