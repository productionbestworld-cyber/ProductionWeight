import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar as RBar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase, fetchAll } from '../lib/supabase'
import ExportButton from '../components/ExportButton'
import { RotateCcw } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// แดชบอร์ดผลิต — เฉพาะงานผลิต(เป่า) เท่านั้น (section = blow)
// ไม่รวมงานกรอ และไม่รวมข้อมูลของแผนกอื่น (คลัง / ขาย / ขนส่ง / จัดซื้อ / วางแผน)
// มี: สรุปรวม · Pareto ปัญหา&สาเหตุ · แยกตาม WO / เครื่อง / วัน · รายละเอียดรายม้วน
// ช่วงวันที่ยาว (> 62 วัน) จะสลับไปใช้ RPC production_summary ให้ Postgres รวมยอดมาให้
// (ดู db/production_summary_rpc.sql) — ถ้ายังไม่ได้รัน SQL นั้น จะ fallback มาคำนวณฝั่งเบราว์เซอร์
// กรองได้: ช่วงวันที่ · WO · เครื่อง · ลูกค้า · ประเภทม้วน · ค้นหา
// ─────────────────────────────────────────────────────────────────────────────

type Roll = {
  id: string
  roll_type: string
  weight: number
  gross_weight?: number | null
  core_weight?: number | null
  length?: number | null
  pcs?: number | null
  machine_no: string
  lot_no: string
  product_name?: string | null
  customer?: string | null
  width_cm?: string | null
  width_unit?: string | null
  thick_mc?: string | null
  inspector?: string | null
  work_order?: string | null
  sale_order?: string | null
  created_at: string
  roll_no: number
  section?: string | null
  remark?: string | null
  is_rewound?: boolean | null     // true = ม้วนกรอที่เอามาชั่งที่เครื่องผลิต (ติ๊กที่หน้าชั่ง)
  rework_status?: string | null   // null=ยังไม่ส่งกรอ · 'reworking'=กำลังกรอ · 'reworked'=กรอเสร็จ
}

// ดึงเฉพาะคอลัมน์ที่หน้านี้ใช้จริง — ตัด gross_weight/core_weight/pcs ที่ไม่ได้ใช้ออก ลด egress
const SELECT_COLS =
  'id,roll_type,weight,length,machine_no,lot_no,product_name,customer,' +
  'width_cm,width_unit,thick_mc,inspector,work_order,sale_order,created_at,roll_no,section,remark,is_rewound,rework_status'

const NO_WO = '(ไม่ระบุ WO)'

function toDateStr(d: Date) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}
// คีย์ "วัน" ตามเวลาไทย (created_at เก็บเป็น UTC — ม้วนกะดึกจะได้ไม่ตกไปคนละวัน)
function thaiDay(iso?: string) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) } catch { return (iso ?? '').slice(0, 10) }
}
function thaiTime(iso?: string) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '—' }
}
function num(n: number, d = 1) {
  return (n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtKg(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k'
  return String(Math.round(n))
}
// tooltip ของกราฟ — kg ใส่ทศนิยม 1 ตำแหน่ง ส่วนค่าที่เป็น % ใส่หน่วย %
function KgTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-2.5 text-xs">
      <p className="font-bold text-gray-700 mb-1">{label}</p>
      {payload.map((pl: any) => (
        <div key={pl.dataKey} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: pl.color }} />
          <span className="text-gray-600">{pl.name}:</span>
          <span className="font-bold text-gray-800">
            {String(pl.dataKey).includes('%') ? `${pl.value}%` : `${num(pl.value, 1)} kg`}
          </span>
        </div>
      ))}
    </div>
  )
}
const isScrap = (t: string) => typeof t === 'string' && t.startsWith('scrap')
const typeLabel = (t: string) =>
  t === 'good' ? 'ม้วนดี (FG)' : t === 'bad' ? 'ม้วนเสีย' :
  t === 'scrap_clear' ? 'เศษใส' : t === 'scrap_color' ? 'เศษสี' : t === 'scrap_lump' ? 'เศษก้อน' : t
const sizeOf = (r: Roll) => (r.width_cm && r.thick_mc ? `${r.width_cm}${r.width_unit ?? 'cm'}×${r.thick_mc}mc` : '—')

type Tab = 'summary' | 'problems' | 'wo' | 'machine' | 'day' | 'rolls'
const TABS: { key: Tab; label: string; desc: string }[] = [
  { key: 'summary', label: '📊 สรุปทั้งหมด',   desc: 'ยอดรวมทั้งหมดของงานผลิตในช่วงที่เลือก — ผลิตทั้งหมด / ผลิตดี / ออกไปกรอ / เศษ' },
  { key: 'problems',label: '⚠️ ปัญหา & สาเหตุ', desc: 'Pareto สาเหตุของม้วนเสีย/เศษ — สาเหตุไหนกินน้ำหนักมากสุด แยกตามเครื่องและผู้ตรวจ' },
  { key: 'wo',      label: '📋 ตาม WO',        desc: 'สรุปแยกตามใบสั่งผลิต (WO) — กดที่แถวเพื่อดูม้วนของ WO นั้น' },
  { key: 'machine', label: '🏭 ตามเครื่อง',     desc: 'สรุปแยกตามเครื่องจักร' },
  { key: 'day',     label: '📅 ตามวัน',        desc: 'สรุปแยกตามวันที่ผลิต (เวลาไทย)' },
  { key: 'rolls',   label: '📄 รายละเอียดงาน', desc: 'รายม้วนทุกใบตามตัวกรอง — Export Excel ได้' },
]

// แถวสรุปแบบกลุ่ม — ใช้ร่วมกันทั้งโหมดคำนวณในเบราว์เซอร์และโหมดสรุปจากเซิร์ฟเวอร์
type Row = {
  key: string; goodKg: number; badKg: number; scrapKg: number; total: number
  goodRolls: number; badRolls: number; scrapRolls: number; rolls: number; yieldPct: number
  clearKg: number; colorKg: number; lumpKg: number
  machines: string[]; customers: string[]
}
// แปลงผลลัพธ์จาก RPC production_summary ให้อยู่ในรูป Row เดียวกับที่คำนวณเอง
function rowFromRpc(r: any): Row {
  const goodKg = Number(r.good_kg ?? 0), badKg = Number(r.bad_kg ?? 0), scrapKg = Number(r.scrap_kg ?? 0)
  const total  = Number(r.total_kg ?? 0)
  return {
    key: r.key ?? '', goodKg, badKg, scrapKg, total,
    goodRolls: Number(r.good_rolls ?? 0), badRolls: Number(r.bad_rolls ?? 0),
    scrapRolls: Number(r.scrap_rolls ?? 0), rolls: Number(r.rolls ?? 0),
    yieldPct: total ? (goodKg / total) * 100 : 0,
    clearKg: Number(r.clear_kg ?? 0), colorKg: Number(r.color_kg ?? 0), lumpKg: Number(r.lump_kg ?? 0),
    machines: (r.machines ?? '').split(', ').filter(Boolean),
    customers: (r.customers ?? '').split(', ').filter(Boolean),
  }
}

// การ์ด KPI
function Kpi({ icon, label, value, unit, sub, tone = 'slate' }: {
  icon: string; label: string; value: string; unit?: string; sub?: string; tone?: string
}) {
  const bg: Record<string, string> = {
    slate: 'bg-slate-100', green: 'bg-emerald-50', red: 'bg-red-50', amber: 'bg-amber-50', blue: 'bg-blue-50',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl ${bg[tone] ?? bg.slate} flex items-center justify-center text-lg flex-shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-black text-gray-800">{value} {unit && <span className="text-xs font-normal text-gray-400">{unit}</span>}</p>
        {sub && <p className="text-gray-400 text-[10px]">{sub}</p>}
      </div>
    </div>
  )
}

// แถบสัดส่วนแนวนอน (ใช้ในตารางสรุป)
function Bar({ pct, tone = 'bg-emerald-500' }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-full min-w-[60px]">
      <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

// ป้ายสถานะกรอของม้วนเสีย
function reworkLabel(r: Roll): { text: string; cls: string } {
  if (r.roll_type !== 'bad') return { text: '—', cls: 'text-gray-300' }
  if (r.rework_status === 'reworked')  return { text: '✓ กรอเสร็จ', cls: 'text-emerald-600' }
  if (r.rework_status === 'reworking') return { text: '⏳ กำลังกรอ', cls: 'text-blue-500' }
  return { text: 'ยังไม่ส่งกรอ', cls: 'text-gray-400' }
}

// ── ส่วนประกอบเจาะลึก (ใช้ร่วมทุกแท็บ: WO / เครื่อง / วัน / สาเหตุ) ──────────
type MiniRow = { key: string; kg: number; rolls: number }
function miniGroup(rows: Roll[], keyOf: (r: Roll) => string): MiniRow[] {
  const m = new Map<string, MiniRow>()
  for (const r of rows) {
    const k = keyOf(r); let v = m.get(k)
    if (!v) { v = { key: k, kg: 0, rolls: 0 }; m.set(k, v) }
    v.kg += r.weight ?? 0; v.rolls += 1
  }
  return Array.from(m.values()).sort((a, b) => b.kg - a.kg)
}
const sumKg = (a: Roll[]) => a.reduce((s, r) => s + (r.weight ?? 0), 0)

// การ์ดแยกมิติย่อย (เครื่อง/WO/วัน/สินค้า/สาเหตุ)
function MiniBreak({ title, rows, limit = 8, tone = 'bg-rose-400' }: { title: string; rows: MiniRow[]; limit?: number; tone?: string }) {
  const max = Math.max(1, ...rows.map(r => r.kg))
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-[11px] font-bold text-gray-600 mb-2">{title} <span className="text-gray-400 font-normal">({rows.length})</span></p>
      {rows.length === 0 ? <p className="text-[11px] text-gray-400">—</p> : (
        <div className="space-y-1.5">
          {rows.slice(0, limit).map(r => (
            <div key={r.key} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-gray-700 truncate font-mono" title={r.key}>{r.key}</span>
                <span className="text-gray-500 whitespace-nowrap"><b className="text-gray-700">{num(r.kg, 0)}</b> kg · {r.rolls}</span>
              </div>
              <Bar pct={(r.kg / max) * 100} tone={tone} />
            </div>
          ))}
          {rows.length > limit && <p className="text-[10px] text-gray-400">…และอีก {rows.length - limit} รายการ</p>}
        </div>
      )}
    </div>
  )
}

// ตารางรายม้วนจริง + ปุ่มเรียง + Export (จัดการ sort เองภายใน)
function RollDetailTable({ rows, fileName }: { rows: Roll[]; fileName: string }) {
  const [sort, setSort] = useState<'time' | 'weight'>('time')
  const sorted = useMemo(() => rows.slice().sort((a, b) =>
    sort === 'weight' ? (b.weight ?? 0) - (a.weight ?? 0) : (a.created_at < b.created_at ? 1 : -1)), [rows, sort])
  const cols = [
    { header: 'วันที่/เวลา', value: (r: Roll) => thaiTime(r.created_at) },
    { header: 'WO', value: (r: Roll) => r.work_order ?? '' },
    { header: 'SO', value: (r: Roll) => r.sale_order ?? '' },
    { header: 'เครื่อง', value: (r: Roll) => r.machine_no ?? '' },
    { header: 'Lot', value: (r: Roll) => r.lot_no ?? '' },
    { header: 'ม้วนที่', value: (r: Roll) => r.roll_no ?? '' },
    { header: 'ประเภท', value: (r: Roll) => typeLabel(r.roll_type) },
    { header: 'น้ำหนัก (kg)', value: (r: Roll) => r.weight ?? 0 },
    { header: 'ความยาว', value: (r: Roll) => r.length ?? '' },
    { header: 'ขนาด', value: (r: Roll) => sizeOf(r) },
    { header: 'สินค้า', value: (r: Roll) => r.product_name ?? '' },
    { header: 'ลูกค้า', value: (r: Roll) => r.customer ?? '' },
    { header: 'ผู้ตรวจ', value: (r: Roll) => r.inspector ?? '' },
    { header: 'สถานะกรอ', value: (r: Roll) => reworkLabel(r).text },
  ]
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-bold text-gray-600">รายม้วนทั้งหมด ({rows.length.toLocaleString('th-TH')})</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-400">เรียง:</span>
            <button onClick={() => setSort('time')} className={`px-1.5 py-0.5 rounded ${sort === 'time' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'}`}>เวลา</button>
            <button onClick={() => setSort('weight')} className={`px-1.5 py-0.5 rounded ${sort === 'weight' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'}`}>น้ำหนัก</button>
          </div>
          <ExportButton rows={sorted} cols={cols} fileName={fileName.slice(0, 60)} sheetName="รายม้วน"
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-[10px] font-bold" />
        </div>
      </div>
      <div className="overflow-x-auto max-h-[360px]">
        <table className="w-full text-[11px]">
          <thead className="bg-gray-50 text-gray-500 border-b border-gray-200 sticky top-0">
            <tr>{['วันที่/เวลา', 'WO', 'SO', 'เครื่อง', 'Lot', 'ม้วนที่', 'ประเภท', 'นน. (kg)', 'ความยาว', 'ขนาด', 'สินค้า', 'ผู้ตรวจ', 'สถานะกรอ'].map(h => (
              <th key={h} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.slice(0, 500).map(r => {
              const rw = reworkLabel(r)
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{thaiTime(r.created_at)}</td>
                  <td className="px-2 py-1 font-mono text-amber-600">{r.work_order || '—'}</td>
                  <td className="px-2 py-1 font-mono text-blue-500">{r.sale_order || '—'}</td>
                  <td className="px-2 py-1 font-mono text-gray-700">{r.machine_no || '—'}</td>
                  <td className="px-2 py-1 font-mono text-gray-600">{r.lot_no || '—'}</td>
                  <td className="px-2 py-1 text-gray-600">#{r.roll_no}</td>
                  <td className={`px-2 py-1 whitespace-nowrap font-semibold ${r.roll_type === 'good' ? 'text-emerald-600' : r.roll_type === 'bad' ? 'text-red-500' : 'text-amber-600'}`}>{typeLabel(r.roll_type)}</td>
                  <td className="px-2 py-1 text-right font-bold text-gray-800">{num(r.weight ?? 0)}</td>
                  <td className="px-2 py-1 text-right text-gray-600">{r.length ?? '—'}</td>
                  <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{sizeOf(r)}</td>
                  <td className="px-2 py-1 text-gray-600 truncate max-w-[150px]">{r.product_name || '—'}</td>
                  <td className="px-2 py-1 text-gray-500">{r.inspector || '—'}</td>
                  <td className={`px-2 py-1 whitespace-nowrap font-semibold ${rw.cls}`}>{rw.text}</td>
                </tr>
              )
            })}
            {sorted.length > 500 && (
              <tr><td colSpan={13} className="px-2 py-1.5 text-center text-gray-400">แสดง 500 จาก {sorted.length} ม้วน — กด Export เพื่อดูทั้งหมด</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// แผงเจาะลึกทั่วไป — chips สรุป + การ์ดแยกมิติ + ตารางรายม้วน
function Drill({ title, rows, dims, fileName }: { title: string; rows: Roll[]; dims: { title: string; rows: MiniRow[] }[]; fileName: string }) {
  const good = rows.filter(r => r.roll_type === 'good')
  const bad = rows.filter(r => r.roll_type === 'bad')
  const scrap = rows.filter(r => isScrap(r.roll_type))
  const sent = bad.filter(r => !!r.rework_status)
  const totalKg = sumKg(rows), goodKg = sumKg(good), badKg = sumKg(bad), scrapKg = sumKg(scrap)
  const yieldPct = totalKg ? goodKg / totalKg * 100 : 0
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-gray-800">🔎 {title}</span>
        <span className="text-[11px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">รวม {num(totalKg, 0)} kg · {rows.length.toLocaleString('th-TH')} ม้วน</span>
        <span className="text-[11px] bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">ผลิตดี {num(goodKg, 0)} kg · {good.length} · Yield {yieldPct.toFixed(1)}%</span>
        <span className="text-[11px] bg-red-50 text-red-600 rounded-full px-2 py-0.5">ม้วนเสีย {num(badKg, 0)} kg · {bad.length}</span>
        <span className="text-[11px] bg-amber-50 text-amber-600 rounded-full px-2 py-0.5">เศษ {num(scrapKg, 0)} kg · {scrap.length}</span>
        {sent.length > 0 && (
          <span className="text-[11px] bg-blue-50 text-blue-600 rounded-full px-2 py-0.5">ส่งไปกรอ {sent.length} ม้วน ({num(sumKg(sent), 0)} kg)</span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
        {dims.map(d => <MiniBreak key={d.title} title={d.title} rows={d.rows} />)}
      </div>
      <RollDetailTable rows={rows} fileName={fileName} />
    </div>
  )
}

export default function ProductionDashboard() {
  const today = toDateStr(new Date())
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return toDateStr(d) })
  const [dateTo,   setDateTo]   = useState(today)
  const [fWo,      setFWo]      = useState('')
  const [fMachine, setFMachine] = useState('')
  const [fCustomer,setFCustomer]= useState('')
  const [fType,    setFType]    = useState<'' | 'good' | 'bad' | 'scrap'>('')
  const [q,        setQ]        = useState('')

  const [rolls, setRolls]   = useState<Roll[]>([])
  const [loading, setLoading] = useState(true)
  // ม้วนจากกรอที่ถูกตัดออกจากยอดผลิต (โชว์ให้รู้ว่าไม่ใช่ข้อมูลหาย)
  const [rewoundOut, setRewoundOut] = useState<{ rolls: number; kg: number }>({ rolls: 0, kg: 0 })
  const [tab, setTab] = useState<Tab>('summary')
  // แถวที่กางดูรายละเอียดลึก — เก็บเป็น `${kind}::${key}` เพื่อให้มีที่เดียวทั่วทุกแท็บ
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [openReason, setOpenReason] = useState<string | null>(null)

  // ── โหมดสรุปจากเซิร์ฟเวอร์ ────────────────────────────────────────────────
  // ช่วงวันที่ยาว ๆ ถ้าดึงม้วนทุกใบมาคำนวณในเบราว์เซอร์จะช้าและกิน egress มาก
  // → ให้ Postgres รวมยอดมาให้แทนผ่าน RPC production_summary (db/production_summary_rpc.sql)
  const rangeDays = useMemo(() => {
    const a = new Date(dateFrom).getTime(), b = new Date(dateTo).getTime()
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) + 1 : 0
  }, [dateFrom, dateTo])
  const LONG_RANGE_DAYS = 31
  const [forceClient, setForceClient] = useState(false)   // ผู้ใช้กดขอดึงรายม้วนเองทั้งที่ช่วงยาว
  const [rpcMissing, setRpcMissing]   = useState(false)   // ยังไม่ได้รัน SQL บนฐานข้อมูล
  const serverMode = rangeDays > LONG_RANGE_DAYS && !forceClient && !rpcMissing
  const [srv, setSrv] = useState<{ day: Row[]; machine: Row[]; wo: Row[]; reason: Row[] } | null>(null)

  async function load(silent = false) {
    if (!silent) setLoading(true)
    const from = new Date(dateFrom); from.setHours(0, 0, 0, 0)
    const to   = new Date(dateTo);   to.setHours(23, 59, 59, 999)

    if (serverMode) {
      const args = {
        p_from: from.toISOString(), p_to: to.toISOString(),
        p_machine: fMachine || null, p_wo: fWo || null, p_customer: fCustomer || null,
      }
      const groups = ['day', 'machine', 'wo', 'reason'] as const
      const res = await Promise.all(groups.map(g => supabase.rpc('production_summary', { ...args, p_group: g })))
      const failed = res.find(r => r.error)
      if (failed) {
        // ยังไม่ได้รัน db/production_summary_rpc.sql → ถอยไปคำนวณฝั่งเบราว์เซอร์ (ไม่พัง)
        console.warn('RPC production_summary ใช้ไม่ได้ — คำนวณฝั่งเบราว์เซอร์แทน', failed.error)
        setRpcMissing(true)
        return
      }
      const [day, machine, wo, reason] = res.map(r => ((r.data ?? []) as any[]).map(rowFromRpc)) as Row[][]
      setSrv({
        day:     day.sort((a, b) => (a.key < b.key ? 1 : -1)),
        machine: machine.sort((a, b) => b.total - a.total),
        wo:      wo.sort((a, b) => b.total - a.total),
        reason:  reason.sort((a, b) => b.total - a.total),
      })
      setRolls([])
      setRewoundOut({ rolls: 0, kg: 0 })   // โหมดเซิร์ฟเวอร์ไม่ได้ดึงรายม้วน → ไม่มีตัวเลขนี้
      setLoading(false)
      return
    }

    const data = await fetchAll<Roll>(() => supabase
      .from('production_rolls')
      .select(SELECT_COLS)
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: false }))
    // เฉพาะงานผลิต(เป่า) เท่านั้น — ไม่เอางานกรอ (section=rewind) และแผนกอื่น
    // ม้วนที่ไม่ระบุ section ถือเป็นผลิต(เป่า) ตามระบบเดิม
    //
    // ⚠ ตัดม้วนที่ติ๊ก "มาจากกรอ" (is_rewound) ออกด้วย — กันนับซ้ำ
    //   เนื้อวัสดุถูกนับไปแล้วตอนชั่งเป็นม้วนเสีย ถ้านับตอนกรอกลับมาอีก ยอดผลิต/Yield จะเกินจริง
    //   ม้วนพวกนี้เป็นผลงานของแผนกกรอ → ดูได้ที่ "แดชบอร์ดกรอ" (นับให้ครบอยู่แล้ว)
    const blowAll = data.filter(r => (r.section ?? 'blow') === 'blow')
    const rewound = blowAll.filter(r => r.is_rewound)
    setRewoundOut({ rolls: rewound.length, kg: rewound.reduce((s, r) => s + (r.weight ?? 0), 0) })
    setRolls(blowAll.filter(r => !r.is_rewound))
    setSrv(null)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // ไม่ auto-refresh — เดิมดึงม้วนทุกใบใหม่ทุก 2 นาที กิน egress มาก
    // อยากได้ข้อมูลล่าสุดให้กดปุ่ม "รีเฟรช" เอง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, serverMode, fMachine, fWo, fCustomer])

  // โหมดเซิร์ฟเวอร์ไม่ได้ดึงรายม้วนมา — กันผู้ใช้ค้างอยู่แท็บที่ว่างเปล่า
  useEffect(() => {
    if (serverMode && tab === 'rolls') setTab('summary')
  }, [serverMode, tab])

  // ── ตัวเลือกใน dropdown (คิดจากข้อมูลที่โหลดมาจริง) ────────────────────────
  // โหมดเซิร์ฟเวอร์ไม่มีรายม้วน → เอารายชื่อจากผลสรุปที่เซิร์ฟเวอร์ส่งมาแทน
  const woOptions      = useMemo(() => srv
    ? srv.wo.map(r => r.key).filter(k => k !== NO_WO).sort()
    : Array.from(new Set(rolls.map(r => (r.work_order ?? '').trim()).filter(Boolean))).sort(), [rolls, srv])
  const machineOptions = useMemo(() => srv
    ? srv.machine.map(r => r.key).sort()
    : Array.from(new Set(rolls.map(r => r.machine_no).filter(Boolean))).sort(), [rolls, srv])
  const custOptions    = useMemo(() => srv
    ? Array.from(new Set(srv.wo.flatMap(r => r.customers))).sort()
    : Array.from(new Set(rolls.map(r => (r.customer ?? '').trim()).filter(Boolean))).sort(), [rolls, srv])

  // ── ตัวกรอง 2 ระดับ ───────────────────────────────────────────────────────
  // scoped   = กรองเชิงโครงสร้าง (วันที่/WO/เครื่อง/ลูกค้า) → ใช้กับ "ทุกแท็บสรุป"
  //            เพื่อให้ยอดผลิตดี/Yield/อันดับ เป็นภาพรวมจริงเสมอ
  // filtered = scoped + ประเภทม้วน + ค้นหา → ใช้เฉพาะตาราง "รายละเอียดงาน"
  //            (ถ้าเอาประเภทม้วนไปกรองยอดสรุปด้วย เช่นเลือก "ม้วนเสีย" ผลิตดีจะกลายเป็น 0
  //             และ Yield 0% ทุก WO ซึ่งทำให้เข้าใจผิด — จึงจำกัดผลไว้ที่ตารางรายม้วนเท่านั้น)
  const scoped = useMemo(() => rolls.filter(r => {
    if (fWo && (r.work_order ?? '').trim() !== fWo) return false
    if (fMachine && r.machine_no !== fMachine) return false
    if (fCustomer && (r.customer ?? '').trim() !== fCustomer) return false
    return true
  }), [rolls, fWo, fMachine, fCustomer])

  const filtered = useMemo(() => scoped.filter(r => {
    if (fType === 'scrap' ? !isScrap(r.roll_type) : fType && r.roll_type !== fType) return false
    if (q.trim()) {
      const s = q.trim().toLowerCase()
      const hay = [r.work_order, r.sale_order, r.lot_no, r.machine_no, r.customer, r.product_name, r.inspector, r.remark]
        .map(v => (v ?? '').toString().toLowerCase()).join(' ')
      if (!hay.includes(s)) return false
    }
    return true
  }), [scoped, fType, q])

  const detailNarrowed = (fType !== '' || q.trim() !== '')   // ตัวกรองที่มีผลเฉพาะตารางรายม้วน

  const kg = (arr: Roll[]) => arr.reduce((s, r) => s + (r.weight ?? 0), 0)

  const stat = useMemo(() => {
    if (srv) {
      // โหมดเซิร์ฟเวอร์: รวมยอดจากแถวรายวันที่ Postgres สรุปมาให้
      const sum = (f: (r: Row) => number) => srv.day.reduce((a, r) => a + f(r), 0)
      const goodKg = sum(r => r.goodKg), badKg = sum(r => r.badKg), scrapKg = sum(r => r.scrapKg)
      const total = goodKg + badKg + scrapKg
      return {
        good: { length: sum(r => r.goodRolls) }, bad: { length: sum(r => r.badRolls) },
        scrap: { length: sum(r => r.scrapRolls) },
        goodKg, badKg, scrapKg, total,
        yieldPct: total ? (goodKg / total) * 100 : 0,
        clearKg: sum(r => r.clearKg), colorKg: sum(r => r.colorKg), lumpKg: sum(r => r.lumpKg),
        days: srv.day.length, machines: srv.machine.length, wos: srv.wo.length,
        rolls: sum(r => r.rolls),
      }
    }
    const good  = scoped.filter(r => r.roll_type === 'good')
    const bad   = scoped.filter(r => r.roll_type === 'bad')
    const scrap = scoped.filter(r => isScrap(r.roll_type))
    const goodKg = kg(good), badKg = kg(bad), scrapKg = kg(scrap)
    const total  = goodKg + badKg + scrapKg
    return {
      good, bad, scrap, goodKg, badKg, scrapKg, total,
      yieldPct: total ? (goodKg / total) * 100 : 0,
      clearKg: kg(scoped.filter(r => r.roll_type === 'scrap_clear')),
      colorKg: kg(scoped.filter(r => r.roll_type === 'scrap_color')),
      lumpKg:  kg(scoped.filter(r => r.roll_type === 'scrap_lump')),
      days:    new Set(scoped.map(r => thaiDay(r.created_at))).size,
      machines:new Set(scoped.map(r => r.machine_no).filter(Boolean)).size,
      wos:     new Set(scoped.map(r => (r.work_order ?? '').trim() || NO_WO)).size,
      rolls:   scoped.length,
    }
  }, [scoped, srv])

  // ── รวมยอดตามคีย์ (ใช้ซ้ำได้ทั้ง WO / เครื่อง / วัน / สาเหตุ) ─────────────
  function groupBy(rows: Roll[], keyOf: (r: Roll) => string): Row[] {
    const map = new Map<string, Row & { _m: Set<string>; _c: Set<string> }>()
    for (const r of rows) {
      const k = keyOf(r)
      let v = map.get(k)
      if (!v) {
        v = { key: k, goodKg: 0, badKg: 0, scrapKg: 0, total: 0,
              goodRolls: 0, badRolls: 0, scrapRolls: 0, rolls: 0, yieldPct: 0,
              clearKg: 0, colorKg: 0, lumpKg: 0,
              machines: [], customers: [], _m: new Set(), _c: new Set() }
        map.set(k, v)
      }
      const w = r.weight ?? 0
      if (r.roll_type === 'good')      { v.goodKg += w; v.goodRolls += 1 }
      else if (r.roll_type === 'bad')  { v.badKg  += w; v.badRolls  += 1 }
      else if (isScrap(r.roll_type))   {
        v.scrapKg += w; v.scrapRolls += 1
        if (r.roll_type === 'scrap_clear')      v.clearKg += w
        else if (r.roll_type === 'scrap_color') v.colorKg += w
        else if (r.roll_type === 'scrap_lump')  v.lumpKg  += w
      }
      v.total += w
      v.rolls += 1
      if (r.machine_no) v._m.add(r.machine_no)
      if (r.customer)   v._c.add(r.customer)
    }
    return Array.from(map.values()).map(v => ({
      ...v,
      machines: Array.from(v._m).sort(),
      customers: Array.from(v._c).sort(),
      yieldPct: v.total ? (v.goodKg / v.total) * 100 : 0,
    }))
  }

  const byWo      = useMemo(() => srv ? srv.wo
    : groupBy(scoped, r => (r.work_order ?? '').trim() || NO_WO).sort((a, b) => b.total - a.total), [scoped, srv])
  const byMachine = useMemo(() => srv ? srv.machine
    : groupBy(scoped, r => r.machine_no || '(ไม่ระบุเครื่อง)').sort((a, b) => b.total - a.total), [scoped, srv])
  const byDay     = useMemo(() => srv ? srv.day
    : groupBy(scoped, r => thaiDay(r.created_at)).sort((a, b) => (a.key < b.key ? 1 : -1)), [scoped, srv])

  // ── ข้อมูลแท็บ "ปัญหา & สาเหตุ" ───────────────────────────────────────────
  // สาเหตุ = ช่องหมายเหตุที่พนักงานเลือกตอนชั่ง (เช่น กรีดม้วน / หน้าไม่เรียบ / เปลี่ยนงาน)
  const problemRolls = useMemo(() => scoped.filter(r => r.roll_type !== 'good'), [scoped])
  const byReason  = useMemo(() => srv ? srv.reason
    : groupBy(problemRolls, r => (r.remark ?? '').trim() || '(ไม่ระบุ)').sort((a, b) => b.total - a.total), [problemRolls, srv])
  // แยกตามเครื่อง / ผู้ตรวจ ทำได้เฉพาะโหมดที่มีรายม้วน
  const problemByMachine  = useMemo(() => groupBy(problemRolls, r => r.machine_no || '(ไม่ระบุเครื่อง)').sort((a, b) => b.total - a.total), [problemRolls])
  const problemByInspector= useMemo(() => groupBy(problemRolls, r => (r.inspector ?? '').trim() || '(ไม่ระบุ)').sort((a, b) => b.total - a.total), [problemRolls])

  // ── เจาะลึกรายสาเหตุ (คลิกสาเหตุในตาราง Pareto) → รายม้วน + แยกมิติ ─────────
  const reasonDrill = useMemo(() => {
    if (!openReason) return null
    const rows = problemRolls.filter(r => ((r.remark ?? '').trim() || '(ไม่ระบุ)') === openReason)
    if (rows.length === 0) return null
    return {
      rows,
      dims: [
        { title: '🏭 ตามเครื่อง', rows: miniGroup(rows, r => r.machine_no || '(ไม่ระบุเครื่อง)') },
        { title: '📋 ตาม WO',    rows: miniGroup(rows, r => (r.work_order ?? '').trim() || NO_WO) },
        { title: '👷 ตามผู้ตรวจ (กะ)', rows: miniGroup(rows, r => (r.inspector ?? '').trim() || '(ไม่ระบุ)') },
        { title: '📅 ตามวัน',     rows: miniGroup(rows, r => thaiDay(r.created_at)).sort((a, b) => (a.key < b.key ? 1 : -1)) },
      ],
    }
  }, [openReason, problemRolls])

  // ── เจาะลึกกลุ่ม (คลิกแถวในแท็บ WO / เครื่อง / วัน) → รายม้วน + แยกมิติ ──────
  const groupMembers = (kind: 'wo' | 'machine' | 'day', key: string) => scoped.filter(x =>
    kind === 'wo'      ? ((x.work_order ?? '').trim() || NO_WO) === key
    : kind === 'machine' ? (x.machine_no || '(ไม่ระบุเครื่อง)') === key
    :                    thaiDay(x.created_at) === key)
  const groupDims = (kind: 'wo' | 'machine' | 'day', rows: Roll[]) => {
    const nonGood = rows.filter(r => r.roll_type !== 'good')
    const dims: { title: string; rows: MiniRow[] }[] = []
    if (kind !== 'machine') dims.push({ title: '🏭 ตามเครื่อง', rows: miniGroup(rows, r => r.machine_no || '(ไม่ระบุเครื่อง)') })
    if (kind !== 'wo')      dims.push({ title: '📋 ตาม WO',    rows: miniGroup(rows, r => (r.work_order ?? '').trim() || NO_WO) })
    if (kind !== 'day')     dims.push({ title: '📅 ตามวัน',     rows: miniGroup(rows, r => thaiDay(r.created_at)).sort((a, b) => (a.key < b.key ? 1 : -1)) })
    dims.push({ title: '📦 ตามสินค้า', rows: miniGroup(rows, r => (r.product_name ?? '').trim() || '(ไม่ระบุ)') })
    dims.push({ title: '⚠️ สาเหตุของเสีย', rows: miniGroup(nonGood, r => (r.remark ?? '').trim() || '(ไม่ระบุ)') })
    return dims
  }

  // ── ม้วนเสียที่ "ส่งไปกรอ" — กี่ม้วน WO ไหน (ต้องมีรายม้วน จึงไม่รองรับโหมดเซิร์ฟเวอร์) ──
  // ส่งไปกรอ = ม้วนเสีย (roll_type='bad') ที่มี rework_status (reworking=กำลังกรอ / reworked=กรอเสร็จ)
  const sentToRework = useMemo(() => scoped.filter(r => r.roll_type === 'bad' && !!r.rework_status), [scoped])
  const reworkStat = useMemo(() => ({
    rolls: sentToRework.length,
    kg: kg(sentToRework),
    done: sentToRework.filter(r => r.rework_status === 'reworked').length,
    doing: sentToRework.filter(r => r.rework_status === 'reworking').length,
    badRolls: scoped.filter(r => r.roll_type === 'bad').length,
  }), [sentToRework, scoped])
  const reworkByWo = useMemo(() => {
    const map = new Map<string, { wo: string; rolls: number; kg: number; done: number; doing: number; machines: Set<string> }>()
    for (const r of sentToRework) {
      const k = (r.work_order ?? '').trim() || NO_WO
      let v = map.get(k)
      if (!v) { v = { wo: k, rolls: 0, kg: 0, done: 0, doing: 0, machines: new Set() }; map.set(k, v) }
      v.rolls += 1; v.kg += r.weight ?? 0
      if (r.rework_status === 'reworked') v.done += 1
      else if (r.rework_status === 'reworking') v.doing += 1
      if (r.machine_no) v.machines.add(r.machine_no)
    }
    return Array.from(map.values())
      .map(v => ({ ...v, machineList: Array.from(v.machines).sort() }))
      .sort((a, b) => b.rolls - a.rolls)
  }, [sentToRework])
  // ตารางสาเหตุพร้อม % และ % สะสม (Pareto)
  const paretoRows = useMemo(() => {
    const totalKg = byReason.reduce((sum, r) => sum + r.total, 0)
    let cum = 0
    return byReason.map(r => {
      cum += r.total
      return { ...r, pct: totalKg ? r.total / totalKg * 100 : 0, cumPct: totalKg ? cum / totalKg * 100 : 0, totalKg }
    })
  }, [byReason])

  const maxTotal = (rows: Row[]) => Math.max(1, ...rows.map(r => r.total))

  function resetFilters() {
    setFWo(''); setFMachine(''); setFCustomer(''); setFType(''); setQ('')
  }

  const selCls = 'bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40'

  // คอลัมน์ export ของตารางรายม้วน
  const rollCols = [
    { header: 'วันที่/เวลา', value: (r: Roll) => thaiTime(r.created_at) },
    { header: 'WO',        value: (r: Roll) => r.work_order ?? '' },
    { header: 'SO',        value: (r: Roll) => r.sale_order ?? '' },
    { header: 'เครื่อง',    value: (r: Roll) => r.machine_no ?? '' },
    { header: 'Lot',       value: (r: Roll) => r.lot_no ?? '' },
    { header: 'ม้วนที่',    value: (r: Roll) => r.roll_no ?? '' },
    { header: 'ประเภท',     value: (r: Roll) => typeLabel(r.roll_type) },
    { header: 'น้ำหนัก (kg)', value: (r: Roll) => r.weight ?? 0 },
    { header: 'ความยาว',    value: (r: Roll) => r.length ?? '' },
    { header: 'ขนาด',      value: (r: Roll) => sizeOf(r) },
    { header: 'สินค้า',     value: (r: Roll) => r.product_name ?? '' },
    { header: 'ลูกค้า',     value: (r: Roll) => r.customer ?? '' },
    { header: 'ผู้ตรวจ',    value: (r: Roll) => r.inspector ?? '' },
    { header: 'หมายเหตุ',   value: (r: Roll) => r.remark ?? '' },
  ]
  const groupCols = (label: string) => [
    { header: label,          value: (r: Row) => r.key },
    { header: 'ผลิตดี (kg)',  value: (r: Row) => r.goodKg },
    { header: 'ม้วนดี',       value: (r: Row) => r.goodRolls },
    { header: 'ม้วนเสีย (kg)', value: (r: Row) => r.badKg },
    { header: 'เศษ (kg)',     value: (r: Row) => r.scrapKg },
    { header: 'รวมชั่ง (kg)',  value: (r: Row) => r.total },
    { header: 'Yield %',      value: (r: Row) => Number(r.yieldPct.toFixed(2)) },
    { header: 'เครื่อง',       value: (r: Row) => r.machines.join(', ') },
    { header: 'ลูกค้า',        value: (r: Row) => r.customers.join(', ') },
  ]

  // ── ตารางสรุปแบบกลุ่ม (ใช้ทั้งแท็บ WO / เครื่อง / วัน) — คลิกแถวเพื่อกางดูลึก ──
  function GroupTable({ rows, label, kind }: { rows: Row[]; label: string; kind: 'wo' | 'machine' | 'day' }) {
    const max = maxTotal(rows)
    const clickable = !srv   // โหมดเซิร์ฟเวอร์ไม่มีรายม้วน จึงกางไม่ได้
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <p className="font-bold text-gray-700 text-sm">สรุปแยกตาม{label} <span className="text-gray-400 font-normal">({rows.length} รายการ)</span>
            {clickable && <span className="ml-2 text-[11px] text-blue-500 font-normal">👆 คลิกที่แถวเพื่อดูรายละเอียดลึก</span>}</p>
          <ExportButton rows={rows} cols={groupCols(label)} fileName={`production-by-${label}`} sheetName={label} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                {[label, 'ผลิตดี (kg)', 'ม้วนดี', 'ม้วนเสีย (kg)', 'เศษ (kg)', 'รวมชั่ง (kg)', 'Yield', 'สัดส่วน', kind === 'machine' ? 'จำนวนม้วน' : 'เครื่อง', 'ลูกค้า'].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">ไม่มีข้อมูลตามตัวกรองที่เลือก</td></tr>
              )}
              {rows.map(r => {
                const okey = `${kind}::${r.key}`
                const open = clickable && openGroup === okey
                const members = open ? groupMembers(kind, r.key) : []
                return (
                  <Fragment key={r.key}>
                  <tr className={clickable ? `cursor-pointer hover:bg-gray-50 ${open ? 'bg-blue-50/60' : ''}` : 'hover:bg-gray-50'}
                      onClick={clickable ? () => setOpenGroup(o => (o === okey ? null : okey)) : undefined}>
                    <td className="px-3 py-2.5 font-mono text-amber-600 font-bold whitespace-nowrap">
                      {clickable && <span className="text-gray-400 mr-1">{open ? '▾' : '▸'}</span>}{r.key}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-emerald-600 whitespace-nowrap">{num(r.goodKg)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{r.goodRolls}</td>
                    <td className="px-3 py-2.5 text-right text-red-500 whitespace-nowrap">{num(r.badKg)}</td>
                    <td className="px-3 py-2.5 text-right text-amber-600 whitespace-nowrap">{num(r.scrapKg)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-gray-800 whitespace-nowrap">{num(r.total)}</td>
                    <td className={`px-3 py-2.5 text-right font-bold whitespace-nowrap ${r.yieldPct >= 95 ? 'text-emerald-600' : r.yieldPct >= 90 ? 'text-amber-600' : 'text-red-500'}`}>
                      {r.yieldPct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 w-28"><Bar pct={(r.total / max) * 100} tone="bg-brand-500" /></td>
                    <td className="px-3 py-2.5 text-gray-600 font-mono text-xs truncate max-w-[140px]">
                      {kind === 'machine' ? r.rolls.toLocaleString('th-TH') : (r.machines.join(', ') || '—')}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs truncate max-w-[180px]">{r.customers.join(', ') || '—'}</td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-50">
                      <td colSpan={10} className="px-3 py-3">
                        <Drill title={`${label}: ${r.key}`} rows={members} dims={groupDims(kind, members)} fileName={`${label}-${r.key}`} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-gray-50 border-t border-gray-200 font-bold text-gray-700">
                <tr>
                  <td className="px-3 py-2.5">รวมทั้งหมด</td>
                  <td className="px-3 py-2.5 text-right text-emerald-700">{num(stat.goodKg)}</td>
                  <td className="px-3 py-2.5 text-right">{stat.good.length}</td>
                  <td className="px-3 py-2.5 text-right text-red-600">{num(stat.badKg)}</td>
                  <td className="px-3 py-2.5 text-right text-amber-700">{num(stat.scrapKg)}</td>
                  <td className="px-3 py-2.5 text-right">{num(stat.total)}</td>
                  <td className="px-3 py-2.5 text-right">{stat.yieldPct.toFixed(1)}%</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )
  }

  // ── ข้อมูลที่ป้อนให้กราฟ (recharts) ──────────────────────────────────────
  const chartDaily = useMemo(() => byDay.slice(0, 45).slice().reverse().map(d => ({
    key: d.key.slice(5),                       // MM-DD อ่านง่ายบนแกน x
    'ผลิตดี': Number(d.goodKg.toFixed(1)),
    'ม้วนเสีย': Number(d.badKg.toFixed(1)),
    'เศษ': Number(d.scrapKg.toFixed(1)),
    'Yield %': Number(d.yieldPct.toFixed(1)),
  })), [byDay])
  const chartMachine = useMemo(() => byMachine.slice(0, 15).map(m => ({
    key: m.key,
    'ผลิตดี': Number(m.goodKg.toFixed(1)),
    'ม้วนเสีย': Number(m.badKg.toFixed(1)),
    'เศษ': Number(m.scrapKg.toFixed(1)),
  })), [byMachine])
  const chartPareto = useMemo(() => paretoRows.slice(0, 15).map(r => ({
    key: r.key.length > 18 ? r.key.slice(0, 17) + '…' : r.key,
    'ม้วนเสีย': Number(r.badKg.toFixed(1)),
    'เศษ': Number(r.scrapKg.toFixed(1)),
    '% สะสม': Number(r.cumPct.toFixed(1)),
  })), [paretoRows])
  const topReasonNote = paretoRows.length
    ? `อันดับ 1: ${paretoRows[0].key} (${paretoRows[0].pct.toFixed(0)}%)`
    : 'ไม่มีของเสียในช่วงนี้'

  const tabDesc = TABS.find(t => t.key === tab)?.desc ?? ''

  return (
    <div className="p-4 space-y-4 bg-gray-50 min-h-full">

      {/* หัวเรื่อง + ตัวกรอง */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-black text-gray-800">🏭 แดชบอร์ดผลิต</h1>
            <p className="text-xs text-gray-500">เฉพาะงานผลิต(เป่า) — ไม่รวมงานกรอ และไม่รวมข้อมูลของแผนกอื่น</p>
          </div>
          <div className="flex items-center gap-2">
            {loading && <span className="text-xs text-gray-400">กำลังโหลด…</span>}
            <button onClick={() => load()} className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-bold">
              <RotateCcw size={14} /> รีเฟรช
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-semibold">ตั้งแต่วันที่</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={selCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-semibold">ถึงวันที่</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={selCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-semibold">WO (ใบสั่งผลิต)</span>
            <select value={fWo} onChange={e => { setFWo(e.target.value); setOpenGroup(null) }} className={selCls}>
              <option value="">ทุก WO</option>
              {woOptions.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-semibold">เครื่อง</span>
            <select value={fMachine} onChange={e => setFMachine(e.target.value)} className={selCls}>
              <option value="">ทุกเครื่อง</option>
              {machineOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-semibold">ลูกค้า</span>
            <select value={fCustomer} onChange={e => setFCustomer(e.target.value)} className={selCls}>
              <option value="">ทุกลูกค้า</option>
              {custOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-semibold">ประเภทม้วน</span>
            <select value={fType} onChange={e => setFType(e.target.value as any)} disabled={serverMode}
              className={`${selCls} disabled:opacity-50 disabled:cursor-not-allowed`}>
              <option value="">ทุกประเภท</option>
              <option value="good">ม้วนดี (FG)</option>
              <option value="bad">ม้วนเสีย</option>
              <option value="scrap">เศษทั้งหมด</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <span className="text-[11px] text-gray-500 font-semibold">ค้นหา (WO / SO / Lot / สินค้า / ผู้ตรวจ)</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={serverMode ? 'ใช้ได้เมื่อดึงรายม้วน' : 'พิมพ์คำค้น…'}
              disabled={serverMode} className={`${selCls} disabled:opacity-50 disabled:cursor-not-allowed`} />
          </label>
          <button onClick={resetFilters} className="bg-slate-100 hover:bg-slate-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm font-semibold">ล้างตัวกรอง</button>
        </div>

        <p className="text-xs text-gray-500">
          พบ <b className="text-gray-700">{stat.rolls.toLocaleString('th-TH')}</b> ม้วน ·
          {' '}{stat.wos} WO · {stat.machines} เครื่อง · {stat.days} วัน · ช่วงที่เลือก {rangeDays} วัน
        </p>
        {rewoundOut.rolls > 0 && (
          <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            🔁 ช่วงนี้มีม้วนที่ติ๊กว่า <b>"มาจากกรอ"</b> {rewoundOut.rolls.toLocaleString('th-TH')} ม้วน ·
            {' '}{rewoundOut.kg.toLocaleString('th-TH', { maximumFractionDigits: 1 })} kg —
            <b> ไม่ถูกนับในยอดผลิต/Yield ของหน้านี้</b> เพราะเนื้อวัสดุถูกนับไปแล้วตอนชั่งเป็นม้วนเสีย (กันนับซ้ำ) ·
            ดูรายละเอียดม้วนพวกนี้ได้ที่ <b>แดชบอร์ดกรอ</b>
          </p>
        )}
        {detailNarrowed && !serverMode && (
          <p className="text-[11px] text-gray-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            ℹ️ ตัวกรอง <b>ประเภทม้วน</b>/<b>ค้นหา</b> มีผลเฉพาะแท็บ <b>"รายละเอียดงาน"</b> เท่านั้น —
            แท็บสรุป/ตาม WO/เครื่อง/วัน/ปัญหา ยังแสดงภาพรวมจริง (ผลิตดี &amp; Yield ไม่ถูกตัดออก) ·
            กรองยอดสรุปด้วย วันที่ / WO / เครื่อง / ลูกค้า ได้
          </p>
        )}

        {/* โหมดสรุปจากเซิร์ฟเวอร์ — ช่วงยาวไม่ต้องลากม้วนทุกใบมาที่เบราว์เซอร์ */}
        {serverMode && (
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <span className="text-base leading-none">⚡</span>
            <div className="text-[11px] text-blue-800 leading-relaxed">
              <b>โหมดสรุปจากเซิร์ฟเวอร์</b> — ช่วงที่เลือกยาวกว่า {LONG_RANGE_DAYS} วัน จึงให้ฐานข้อมูลรวมยอดมาให้
              (เร็วกว่าและประหยัดเน็ต) · แท็บ "รายละเอียดงาน" ตัวกรองประเภทม้วน และช่องค้นหา จะใช้ไม่ได้ในโหมดนี้
              <button onClick={() => setForceClient(true)} className="ml-2 underline font-bold hover:text-blue-950">
                ดึงรายม้วนทั้งหมดแทน (ช้ากว่า)
              </button>
            </div>
          </div>
        )}
        {forceClient && rangeDays > LONG_RANGE_DAYS && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            กำลังดึงรายม้วนทั้งหมดของช่วง {rangeDays} วัน — อาจใช้เวลาสักครู่
            <button onClick={() => setForceClient(false)} className="ml-2 underline font-bold">กลับไปโหมดสรุปจากเซิร์ฟเวอร์</button>
          </p>
        )}
        {rpcMissing && rangeDays > LONG_RANGE_DAYS && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            ⚠️ ยังไม่ได้ติดตั้งฟังก์ชันสรุปฝั่งเซิร์ฟเวอร์ — กำลังคำนวณในเบราว์เซอร์แทน (ช้ากว่าเมื่อช่วงยาว) ·
            ให้ผู้ดูแลรันไฟล์ <code className="font-mono">db/production_summary_rpc.sql</code> ใน Supabase SQL Editor ครั้งเดียว
          </p>
        )}
      </div>

      {/* แท็บ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(t => {
            const off = serverMode && t.key === 'rolls'
            return (
              <button key={t.key} onClick={() => setTab(t.key)} disabled={off}
                title={off ? 'ดูรายม้วนได้เมื่อเลือกช่วงสั้นลง หรือกด "ดึงรายม้วนทั้งหมด"' : t.desc}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                  off ? 'text-gray-300 cursor-not-allowed'
                  : tab === t.key ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}`}>
                {t.label}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">{tabDesc}</p>
      </div>

      {/* ── สรุปทั้งหมด ─────────────────────────────────────────────── */}
      {tab === 'summary' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi icon="🏭" tone="blue"  label="ผลิตทั้งหมด" value={num(stat.total)}   unit="kg" sub={`${stat.rolls.toLocaleString('th-TH')} ม้วน · ${stat.wos.toLocaleString('th-TH')} WO · ${stat.days} วัน`} />
            <Kpi icon="✅" tone="green" label="ผลิตดี (FG)" value={num(stat.goodKg)}  unit="kg" sub={`${stat.good.length.toLocaleString('th-TH')} ม้วน · Yield ${stat.yieldPct.toFixed(1)}%`} />
            <Kpi icon="🔁" tone="amber" label="ออกไปกรอ"    value={num(stat.badKg)}   unit="kg" sub={`${stat.bad.length.toLocaleString('th-TH')} ม้วน`} />
            <Kpi icon="🗑" tone="red"   label="เศษ"         value={num(stat.scrapKg)} unit="kg" sub={`ใส ${num(stat.clearKg, 0)} · สี ${num(stat.colorKg, 0)} · ก้อน ${num(stat.lumpKg, 0)}`} />
          </div>

          {/* Top 10 WO และ Top เครื่อง */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[
              { title: '📋 WO ที่ผลิตมากสุด (10 อันดับ)', rows: byWo.slice(0, 10) },
              { title: '🏭 เครื่องที่ผลิตมากสุด',           rows: byMachine.slice(0, 10) },
            ].map(box => {
              const max = maxTotal(box.rows)
              return (
                <div key={box.title} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="font-bold text-gray-700 text-sm mb-3">{box.title}</p>
                  {box.rows.length === 0 && <p className="text-gray-400 text-sm">ไม่มีข้อมูล</p>}
                  <div className="space-y-2">
                    {box.rows.map(r => (
                      <div key={r.key} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono font-bold text-gray-700 truncate">{r.key}</span>
                          <span className="text-gray-500 whitespace-nowrap">
                            <b className="text-emerald-600">{num(r.goodKg, 0)}</b> / {num(r.total, 0)} kg · {r.yieldPct.toFixed(0)}%
                          </span>
                        </div>
                        <Bar pct={(r.total / max) * 100} tone="bg-brand-500" />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* กราฟผลิตรายวัน — แท่งซ้อน FG / ม้วนเสีย / เศษ + เส้น Yield */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <p className="font-bold text-gray-700 text-sm mb-1">📅 ผลิตรายวัน</p>
            <p className="text-[11px] text-gray-400 mb-3">แท่ง = น้ำหนัก (kg) · เส้น = Yield % · แสดงล่าสุด {Math.min(byDay.length, 45)} วัน</p>
            {byDay.length === 0 ? <p className="text-gray-400 text-sm py-8 text-center">ไม่มีข้อมูล</p> : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartDaily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="key" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="kg" tick={{ fontSize: 10 }} tickFormatter={fmtKg} />
                  <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip content={<KgTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <RBar yAxisId="kg" dataKey="ผลิตดี"  stackId="a" fill="#10b981" />
                  <RBar yAxisId="kg" dataKey="ม้วนเสีย" stackId="a" fill="#ef4444" />
                  <RBar yAxisId="kg" dataKey="เศษ"     stackId="a" fill="#f59e0b" />
                  <Line yAxisId="pct" type="monotone" dataKey="Yield %" stroke="#2563eb" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* กราฟผลผลิตต่อเครื่อง */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <p className="font-bold text-gray-700 text-sm mb-1">🏭 ผลผลิตต่อเครื่อง</p>
            <p className="text-[11px] text-gray-400 mb-3">น้ำหนัก (kg) แยกผลิตดี / ม้วนเสีย / เศษ</p>
            {byMachine.length === 0 ? <p className="text-gray-400 text-sm py-8 text-center">ไม่มีข้อมูล</p> : (
              <ResponsiveContainer width="100%" height={Math.max(220, byMachine.length * 34)}>
                <BarChart data={chartMachine} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={fmtKg} />
                  <YAxis type="category" dataKey="key" width={70} tick={{ fontSize: 11 }} />
                  <Tooltip content={<KgTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <RBar dataKey="ผลิตดี"  stackId="a" fill="#10b981" />
                  <RBar dataKey="ม้วนเสีย" stackId="a" fill="#ef4444" />
                  <RBar dataKey="เศษ"     stackId="a" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ── ปัญหา & สาเหตุ (Pareto) ──────────────────────────────────── */}
      {tab === 'problems' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi icon="⚠️" tone="red"   label="ของเสียรวม" value={num(stat.badKg + stat.scrapKg)} unit="kg"
              sub={`${stat.total ? ((stat.badKg + stat.scrapKg) / stat.total * 100).toFixed(2) : '0.00'}% ของยอดชั่งทั้งหมด`} />
            <Kpi icon="🔧" tone="amber" label="ม้วนเสีย"   value={num(stat.badKg)} unit="kg" sub={`${stat.bad.length.toLocaleString('th-TH')} ม้วน`} />
            <Kpi icon="🗑" tone="amber" label="เศษ"        value={num(stat.scrapKg)} unit="kg" sub={`ใส ${num(stat.clearKg, 0)} · สี ${num(stat.colorKg, 0)} · ก้อน ${num(stat.lumpKg, 0)}`} />
            <Kpi icon="🔎" tone="blue"  label="จำนวนสาเหตุ" value={byReason.length.toLocaleString('th-TH')} unit="แบบ"
              sub={topReasonNote} />
          </div>

          {/* กราฟ Pareto: แท่ง = kg ของแต่ละสาเหตุ · เส้น = % สะสม */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <p className="font-bold text-gray-700 text-sm mb-1">⚠️ Pareto สาเหตุของเสีย (15 อันดับแรก)</p>
            <p className="text-[11px] text-gray-400 mb-3">เส้นสีน้ำเงิน = % สะสม — จุดที่เส้นแตะ 80% คือกลุ่มสาเหตุที่ควรแก้ก่อน</p>
            {paretoRows.length === 0 ? <p className="text-gray-400 text-sm py-8 text-center">ไม่มีข้อมูลของเสียในช่วงนี้</p> : (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartPareto} margin={{ top: 5, right: 10, left: 0, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="key" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} height={70} />
                  <YAxis yAxisId="kg" tick={{ fontSize: 10 }} tickFormatter={fmtKg} />
                  <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip content={<KgTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <RBar yAxisId="kg" dataKey="ม้วนเสีย" stackId="a" fill="#ef4444" />
                  <RBar yAxisId="kg" dataKey="เศษ"     stackId="a" fill="#f59e0b" />
                  <Line yAxisId="pct" type="monotone" dataKey="% สะสม" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ตารางสาเหตุแบบเต็ม */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
              <p className="font-bold text-gray-700 text-sm">สาเหตุทั้งหมด <span className="text-gray-400 font-normal">({paretoRows.length} แบบ)</span>
                {!srv && <span className="ml-2 text-[11px] text-blue-500 font-normal">👆 คลิกที่สาเหตุเพื่อดูรายละเอียดลึก</span>}</p>
              <ExportButton rows={paretoRows} fileName="production-problem-reasons" sheetName="สาเหตุ"
                cols={[
                  { header: 'สาเหตุ', value: (r: any) => r.key },
                  { header: 'จำนวนม้วน', value: (r: any) => r.rolls },
                  { header: 'ม้วนเสีย (kg)', value: (r: any) => r.badKg },
                  { header: 'เศษ (kg)', value: (r: any) => r.scrapKg },
                  { header: 'รวม (kg)', value: (r: any) => r.total },
                  { header: '% ของของเสีย', value: (r: any) => Number(r.pct.toFixed(2)) },
                  { header: '% สะสม', value: (r: any) => Number(r.cumPct.toFixed(2)) },
                  { header: 'เครื่อง', value: (r: any) => r.machines.join(', ') },
                ]} />
            </div>
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 border-b border-gray-200 sticky top-0">
                  <tr>
                    {['#', 'สาเหตุ', 'จำนวนม้วน', 'ม้วนเสีย (kg)', 'เศษ (kg)', 'รวม (kg)', '%', '% สะสม', 'เครื่องที่เจอ'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paretoRows.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">ไม่มีข้อมูลของเสียในช่วงนี้</td></tr>
                  )}
                  {paretoRows.map((r, i) => {
                    const open = !srv && openReason === r.key
                    return (
                    <Fragment key={r.key}>
                    <tr className={`${!srv ? 'cursor-pointer' : ''} hover:bg-gray-50 ${r.cumPct <= 80 ? 'bg-red-50/40' : ''} ${open ? 'bg-blue-50/60' : ''}`}
                        onClick={!srv ? () => setOpenReason(o => (o === r.key ? null : r.key)) : undefined}>
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 text-gray-800 font-semibold max-w-[260px] truncate" title={r.key}>
                        {!srv && <span className="text-gray-400 mr-1">{open ? '▾' : '▸'}</span>}{r.key}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.rolls.toLocaleString('th-TH')}</td>
                      <td className="px-3 py-2 text-right text-red-500">{num(r.badKg)}</td>
                      <td className="px-3 py-2 text-right text-amber-600">{num(r.scrapKg)}</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-800">{num(r.total)}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{r.pct.toFixed(1)}%</td>
                      <td className="px-3 py-2 w-40">
                        <div className="flex items-center gap-1.5">
                          <Bar pct={r.cumPct} tone="bg-blue-500" />
                          <span className="text-[10px] text-gray-400 w-9 text-right">{r.cumPct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-600 font-mono text-xs truncate max-w-[140px]">{r.machines.join(', ') || '—'}</td>
                    </tr>
                    {open && reasonDrill && (
                      <tr className="bg-slate-50">
                        <td colSpan={9} className="px-3 py-3">
                          <Drill title={r.key} rows={reasonDrill.rows} dims={reasonDrill.dims} fileName={`problem-${r.key}`} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
              แถวพื้นแดงอ่อน = กลุ่มที่รวมกันแล้วคิดเป็น 80% แรกของของเสีย (หลัก Pareto — แก้กลุ่มนี้ได้ผลมากสุด)
            </p>
          </div>

          {/* แยกตามเครื่อง / ผู้ตรวจ — ต้องมีรายม้วนจึงคำนวณได้ */}
          {srv ? (
            <p className="text-xs text-gray-500 bg-white border border-gray-200 rounded-xl p-4">
              การแยกของเสียตามเครื่องและตามผู้ตรวจ ดูได้เมื่อเลือกช่วงสั้นกว่า {LONG_RANGE_DAYS} วัน (หรือกด "ดึงรายม้วนทั้งหมด")
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[
                { title: '🏭 ของเสียแยกตามเครื่อง', rows: problemByMachine, unit: 'เครื่อง' },
                { title: '👷 ของเสียแยกตามผู้ตรวจ (กะ)', rows: problemByInspector, unit: 'ผู้ตรวจ' },
              ].map(box => {
                const max = Math.max(1, ...box.rows.map(r => r.total))
                return (
                  <div key={box.title} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <p className="font-bold text-gray-700 text-sm mb-3">{box.title}</p>
                    {box.rows.length === 0 && <p className="text-gray-400 text-sm">ไม่มีข้อมูล</p>}
                    <div className="space-y-2">
                      {box.rows.slice(0, 12).map(r => (
                        <div key={r.key} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-gray-700 truncate">{r.key}</span>
                            <span className="text-gray-500 whitespace-nowrap">
                              เสีย <b className="text-red-500">{num(r.badKg, 0)}</b> · เศษ <b className="text-amber-600">{num(r.scrapKg, 0)}</b> kg · {r.rolls} ม้วน
                            </span>
                          </div>
                          <Bar pct={(r.total / max) * 100} tone="bg-red-400" />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── ม้วนเสียที่ส่งไปกรอ — กี่ม้วน / WO ไหน ─────────────────────── */}
          {srv ? (
            <p className="text-xs text-gray-500 bg-white border border-gray-200 rounded-xl p-4">
              รายละเอียดม้วนเสียที่ส่งไปกรอ ดูได้เมื่อเลือกช่วงสั้นกว่า {LONG_RANGE_DAYS} วัน (หรือกด "ดึงรายม้วนทั้งหมด")
            </p>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-bold text-gray-700 text-sm">🔁 ม้วนเสียที่ส่งไปกรอ</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    ส่งไปกรอ <b className="text-emerald-600">{reworkStat.rolls.toLocaleString('th-TH')}</b> ม้วน
                    ({num(reworkStat.kg, 0)} kg) จากม้วนเสียทั้งหมด {reworkStat.badRolls.toLocaleString('th-TH')} ม้วน
                    {reworkStat.badRolls > 0 && <> · คิดเป็น {(reworkStat.rolls / reworkStat.badRolls * 100).toFixed(0)}%</>}
                    {' · '}กรอเสร็จ {reworkStat.done} · กำลังกรอ {reworkStat.doing}
                  </p>
                </div>
                <ExportButton rows={reworkByWo} fileName="production-bad-sent-to-rework" sheetName="ส่งไปกรอ"
                  cols={[
                    { header: 'WO', value: (r: any) => r.wo },
                    { header: 'ส่งไปกรอ (ม้วน)', value: (r: any) => r.rolls },
                    { header: 'น้ำหนัก (kg)', value: (r: any) => r.kg },
                    { header: 'กรอเสร็จ', value: (r: any) => r.done },
                    { header: 'กำลังกรอ', value: (r: any) => r.doing },
                    { header: 'เครื่อง', value: (r: any) => r.machineList.join(', ') },
                  ]} />
              </div>
              <div className="overflow-x-auto max-h-[50vh]">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 border-b border-gray-200 sticky top-0">
                    <tr>
                      {['WO', 'ส่งไปกรอ (ม้วน)', 'น้ำหนัก (kg)', 'กรอเสร็จ', 'กำลังกรอ', 'เครื่อง'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {reworkByWo.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">ช่วงนี้ไม่มีม้วนเสียที่ส่งไปกรอ</td></tr>
                    )}
                    {reworkByWo.map(r => (
                      <tr key={r.wo} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-amber-600 font-bold whitespace-nowrap">{r.wo}</td>
                        <td className="px-3 py-2 text-right font-bold text-gray-800">{r.rolls.toLocaleString('th-TH')}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{num(r.kg)}</td>
                        <td className="px-3 py-2 text-right text-emerald-600">{r.done || '—'}</td>
                        <td className="px-3 py-2 text-right text-blue-500">{r.doing || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 font-mono text-xs truncate max-w-[160px]">{r.machineList.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  {reworkByWo.length > 0 && (
                    <tfoot className="bg-gray-50 border-t border-gray-200 font-bold text-gray-700">
                      <tr>
                        <td className="px-3 py-2.5">รวม {reworkByWo.length} WO</td>
                        <td className="px-3 py-2.5 text-right">{reworkStat.rolls.toLocaleString('th-TH')}</td>
                        <td className="px-3 py-2.5 text-right">{num(reworkStat.kg)}</td>
                        <td className="px-3 py-2.5 text-right text-emerald-700">{reworkStat.done}</td>
                        <td className="px-3 py-2.5 text-right text-blue-600">{reworkStat.doing}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'wo'      && <GroupTable rows={byWo} label="WO" kind="wo" />}
      {tab === 'machine' && <GroupTable rows={byMachine} label="เครื่อง" kind="machine" />}
      {tab === 'day'     && <GroupTable rows={byDay} label="วันที่" kind="day" />}

      {/* ── รายละเอียดงานรายม้วน ────────────────────────────────────── */}
      {tab === 'rolls' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
            <p className="font-bold text-gray-700 text-sm">
              รายละเอียดงาน <span className="text-gray-400 font-normal">({filtered.length.toLocaleString('th-TH')} ม้วน)</span>
            </p>
            <ExportButton rows={filtered} cols={rollCols} fileName="production-rolls" sheetName="รายละเอียดงาน" />
          </div>
          <div className="overflow-x-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 border-b border-gray-200 sticky top-0">
                <tr>
                  {['วันที่/เวลา', 'WO', 'SO', 'เครื่อง', 'Lot', 'ม้วนที่', 'ประเภท', 'นน. (kg)', 'ความยาว', 'ขนาด', 'สินค้า', 'ลูกค้า', 'ผู้ตรวจ'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr><td colSpan={13} className="px-3 py-8 text-center text-gray-400">ไม่มีข้อมูลตามตัวกรองที่เลือก</td></tr>
                )}
                {filtered.slice(0, 1000).map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{thaiTime(r.created_at)}</td>
                    <td className="px-3 py-2 font-mono text-amber-600 text-xs">{r.work_order || '—'}</td>
                    <td className="px-3 py-2 font-mono text-blue-500 text-xs">{r.sale_order || '—'}</td>
                    <td className="px-3 py-2 font-mono text-gray-700">{r.machine_no || '—'}</td>
                    <td className="px-3 py-2 font-mono text-gray-600 text-xs">{r.lot_no || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">#{r.roll_no}</td>
                    <td className={`px-3 py-2 whitespace-nowrap font-semibold ${
                      r.roll_type === 'good' ? 'text-emerald-600' : r.roll_type === 'bad' ? 'text-red-500' : 'text-amber-600'}`}>
                      {typeLabel(r.roll_type)}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-gray-800">{num(r.weight ?? 0, 2)}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{r.length ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{sizeOf(r)}</td>
                    <td className="px-3 py-2 text-gray-600 truncate max-w-[180px]">{r.product_name || '—'}</td>
                    <td className="px-3 py-2 text-gray-600 truncate max-w-[160px]">{r.customer || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{r.inspector || '—'}</td>
                  </tr>
                ))}
                {filtered.length > 1000 && (
                  <tr><td colSpan={13} className="px-3 py-3 text-center text-gray-400">
                    แสดง 1,000 แถวแรกจาก {filtered.length.toLocaleString('th-TH')} — กรองให้แคบลง หรือกด Export Excel เพื่อดูทั้งหมด
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
