import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar as RBar, ComposedChart, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase, fetchAll } from '../lib/supabase'
import { rewoundFlag } from '../lib/rework'
import ExportButton from '../components/ExportButton'
import { RotateCcw } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// แดชบอร์ดกรอ — เฉพาะงานแผนกกรอ (rewind)
// ตอบ 2 คำถามหลักของแผนกกรอ:
//   1) "มีม้วนเข้ามาเท่าไหร่ อะไรบ้าง"  → มาจากผลิต = ม้วนเสียที่ผลิตชั่ง (production_rolls roll_type='bad')
//   2) "แต่ละวันกรออะไรออกไปบ้าง"        → ผลงานกรอ = ม้วนที่แผนกกรอชั่ง (production_rolls section=rewind
//                                          หรือ is_rewound=true ที่ไปชั่งต่อที่เครื่องเป่าที่เดินอยู่)
// หน้าตา/ตัวกรอง/Export ยึดแบบเดียวกับ "แดชบอร์ดผลิต(เป่า)"
// ไม่ auto-refresh (ลด egress) — อยากได้ข้อมูลล่าสุดกดปุ่ม "รีเฟรช"
// ─────────────────────────────────────────────────────────────────────────────

// ── ม้วนที่ "เข้ามา" = ม้วนเสียที่มาจากผลิต (production_rolls roll_type='bad') ──
// นับที่ตัวม้วนจริงจากผลิต ไม่ใช่ "รายการเบิก" — ม้วนที่ผลิตชั่งแล้วยังไม่มีใครเบิก
// ก็ต้องนับเป็น "ยังไม่ได้กรอ" ด้วย (เดิมนับจาก rework_withdrawals จะมองไม่เห็นม้วนพวกนี้)
type InRoll = {
  id: string
  created_at: string
  weight?: number | null
  product_name?: string | null
  item_code?: string | null
  lot_no?: string | null            // Lot จากผลิต
  work_order?: string | null
  sale_order?: string | null
  machine_no?: string | null        // เครื่องเป่าที่ผลิตม้วนนี้
  roll_no?: number | null
  remark?: string | null            // เหตุผลที่ต้องกรอ
  rework_status?: string | null     // null/pending=รอเบิก · reworking=เบิกไปกรอแล้ว · reworked=กรอเสร็จ · scrapped=ทำลาย
  rework_received_by?: string | null
  rework_received_at?: string | null
  is_legacy?: boolean | null        // ม้วนที่ import ย้อนหลัง — หน้าเบิกม้วนกรอไม่นับ เราก็ไม่นับ
  // ── ค่าที่เติมให้ตอนโหลด (ให้ส่วนที่เขียนไว้เดิมใช้ต่อได้) ──
  source_roll_id?: string | null    // = id ของม้วนเอง
  withdrawn_by?: string | null      // = rework_received_by
}
const IN_COLS =
  'id,created_at,weight,product_name,item_code,lot_no,work_order,sale_order,machine_no,roll_no,' +
  'remark,rework_status,rework_received_by,rework_received_at,is_legacy'

// ── ม้วนที่ "ออกไป" = ผลงานกรอ (ม้วนที่แผนกกรอชั่งเสร็จ) ─────────────────────
type OutRoll = {
  id: string
  created_at: string
  machine_no?: string | null        // สถานีกรอ (S01–S04)
  inspector?: string | null         // คนกรอ
  weight?: number | null
  roll_type: string                 // good | scrap_clear | scrap_color | scrap_lump | (bad พบน้อยมาก)
  product_name?: string | null
  customer?: string | null
  lot_no?: string | null
  work_order?: string | null
  sale_order?: string | null
  item_code?: string | null
  width_cm?: string | null
  width_unit?: string | null
  thick_mc?: string | null
  length?: string | number | null
  roll_no?: number | null
  transferred?: boolean | null      // โอนเข้าคลังแล้ว
  rework_source_lot?: string | null // Lot ต้นทางที่กรอมา
  rework_source_weight?: number | null // นน. ก่อนกรอ (ของม้วนต้นทาง)
  section?: string | null
  is_rewound?: boolean | null
  rework_source_roll_id?: string | null // ม้วนต้นทาง (ผูกกับ rework_withdrawals.source_roll_id)
}
const OUT_COLS =
  'id,created_at,machine_no,inspector,weight,roll_type,product_name,customer,lot_no,' +
  'work_order,sale_order,item_code,width_cm,width_unit,thick_mc,length,roll_no,transferred,' +
  'rework_source_lot,rework_source_weight,section,is_rewound,rework_source_roll_id'

const NO_PROD = '(ไม่ระบุสินค้า)'
const NO_LOT  = '(ไม่ระบุ Lot)'

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
function KgTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-2.5 text-xs">
      <p className="font-bold text-gray-700 mb-1">{label}</p>
      {payload.map((pl: any) => (
        <div key={pl.dataKey} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: pl.color }} />
          <span className="text-gray-600">{pl.name}:</span>
          <span className="font-bold text-gray-800">{num(pl.value, 1)} kg</span>
        </div>
      ))}
    </div>
  )
}
const isScrap = (t: string) => typeof t === 'string' && t.startsWith('scrap')
const typeLabel = (t: string) =>
  t === 'good' ? 'กรอดี (FG)' : t === 'bad' ? 'ม้วนเสีย' :
  t === 'scrap_clear' ? 'เศษใส' : t === 'scrap_color' ? 'เศษสี' : t === 'scrap_lump' ? 'เศษก้อน' : t
const sizeOf = (r: OutRoll) => (r.width_cm && r.thick_mc ? `${r.width_cm}${r.width_unit ?? 'cm'}×${r.thick_mc}mc` : '—')

type Tab = 'summary' | 'day' | 'product' | 'station' | 'trace' | 'incoming' | 'output'
// โฟกัสของแท็บ "ไล่ม้วนตาม WO" — คลิกมาจากการ์ด KPI
type Focus = 'all' | 'pending' | 'done'
const TABS: { key: Tab; label: string; desc: string }[] = [
  { key: 'summary',  label: '📊 สรุปเข้า–ออก', desc: 'ภาพรวมช่วงที่เลือก — ม้วนที่มาจากผลิต เทียบกับที่กรอออกไปแล้ว' },
  { key: 'day',      label: '📅 ตามวัน',       desc: 'แต่ละวัน รับเข้ากี่ม้วน · กรอออกไปกี่ม้วน · เศษ · โอนเข้าคลัง — กดแถวเพื่อดูรายละเอียด' },
  { key: 'product',  label: '📦 ตามสินค้า',     desc: 'แยกตามสินค้า — รับเข้าเทียบกับกรอออก แต่ละรายการ' },
  { key: 'station',  label: '🏭 ตามสถานี/คนกรอ', desc: 'ผลงานกรอแยกตามสถานีกรอ (S01–S04) และคนกรอ' },
  { key: 'trace',    label: '🎯 ไล่ม้วนตาม WO', desc: 'ม้วนเสียที่มาจากผลิต แยกตาม WO — ขาว = ยังไม่ได้กรอ · เขียว = กรอแล้ว' },
  { key: 'incoming', label: '📥 ม้วนเข้ามา',     desc: 'รายม้วนที่มาจากผลิตทั้งหมดในช่วงนี้ (เบิกแล้ว/ยังไม่เบิก) — Export ได้' },
  { key: 'output',   label: '📤 ผลงานกรอ (รายม้วน)', desc: 'รายม้วนที่แผนกกรอชั่งเสร็จทุกใบตามตัวกรอง — Export ได้' },
]

// การ์ด KPI
function Kpi({ icon, label, value, unit, sub, tone = 'slate', onClick }: {
  icon: string; label: string; value: string; unit?: string; sub?: string; tone?: string; onClick?: () => void
}) {
  const bg: Record<string, string> = {
    slate: 'bg-slate-100', green: 'bg-emerald-50', red: 'bg-red-50', amber: 'bg-amber-50', blue: 'bg-blue-50',
  }
  return (
    <div onClick={onClick}
      className={`bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4 relative ${
        onClick ? 'cursor-pointer hover:border-brand-400 hover:shadow-md transition' : ''}`}>
      {onClick && <span className="absolute top-2 right-2.5 text-[10px] text-brand-500 font-bold">ดูรายละเอียด →</span>}
      <div className={`w-10 h-10 rounded-xl ${bg[tone] ?? bg.slate} flex items-center justify-center text-lg flex-shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-black text-gray-800">{value} {unit && <span className="text-xs font-normal text-gray-400">{unit}</span>}</p>
        {sub && <p className="text-gray-400 text-[10px]">{sub}</p>}
      </div>
    </div>
  )
}

// แถบสัดส่วนแนวนอน
function Bar({ pct, tone = 'bg-emerald-500' }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-full min-w-[60px]">
      <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

// ── การ์ดแยกมิติย่อย (ใช้ตอนกางดูลึกรายวัน) ────────────────────────────────
type MiniRow = { key: string; kg: number; rolls: number }
function miniGroup<T>(rows: T[], keyOf: (r: T) => string, wOf: (r: T) => number): MiniRow[] {
  const m = new Map<string, MiniRow>()
  for (const r of rows) {
    const k = keyOf(r); let v = m.get(k)
    if (!v) { v = { key: k, kg: 0, rolls: 0 }; m.set(k, v) }
    v.kg += wOf(r) ?? 0; v.rolls += 1
  }
  return Array.from(m.values()).sort((a, b) => b.kg - a.kg)
}
function MiniBreak({ title, rows, limit = 8, tone = 'bg-brand-400' }: { title: string; rows: MiniRow[]; limit?: number; tone?: string }) {
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

const inKg  = (a: InRoll[])  => a.reduce((s, r) => s + (r.weight ?? 0), 0)
const outKg = (a: OutRoll[]) => a.reduce((s, r) => s + (r.weight ?? 0), 0)

// ── ตารางรายการ "ม้วนเข้ามา" (withdrawals) ──────────────────────────────────
function InTable({ rows, fileName }: { rows: InRoll[]; fileName: string }) {
  const sorted = useMemo(() => rows.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)), [rows])
  const cols = [
    { header: 'วันที่/เวลา', value: (r: InRoll) => thaiTime(r.created_at) },
    { header: 'เครื่องเป่า', value: (r: InRoll) => r.machine_no ?? '' },
    { header: 'ม้วนที่', value: (r: InRoll) => r.roll_no ?? '' },
    { header: 'ผู้เบิก', value: (r: InRoll) => r.withdrawn_by ?? '' },
    { header: 'Lot', value: (r: InRoll) => r.lot_no ?? '' },
    { header: 'WO', value: (r: InRoll) => r.work_order ?? '' },
    { header: 'SO', value: (r: InRoll) => r.sale_order ?? '' },
    { header: 'สินค้า', value: (r: InRoll) => r.product_name ?? '' },
    { header: 'Item', value: (r: InRoll) => r.item_code ?? '' },
    { header: 'น้ำหนัก (kg)', value: (r: InRoll) => r.weight ?? 0 },
    { header: 'เหตุที่ต้องกรอ', value: (r: InRoll) => r.remark ?? '' },
  ]
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-bold text-gray-600">ม้วนที่มาจากผลิต ({rows.length.toLocaleString('th-TH')})</p>
        <ExportButton rows={sorted} cols={cols} fileName={fileName.slice(0, 60)} sheetName="ม้วนเข้ามา"
          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-[10px] font-bold" />
      </div>
      <div className="overflow-x-auto max-h-[360px]">
        <table className="w-full text-[11px]">
          <thead className="bg-gray-50 text-gray-500 border-b border-gray-200 sticky top-0">
            <tr>{['วันที่/เวลา', 'เครื่อง', 'ผู้เบิก', 'Lot', 'WO', 'SO', 'สินค้า', 'นน. (kg)'].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 font-semibold whitespace-nowrap border-r border-gray-100 last:border-r-0 ${i === 7 ? 'text-right' : 'text-left'}`}>{h}</th>))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 && <tr><td colSpan={8} className="px-2 py-6 text-center text-gray-400">— ไม่มีม้วนจากผลิตในช่วงนี้ —</td></tr>}
            {sorted.slice(0, 500).map(r => (
              <tr key={r.id} className="hover:bg-blue-50 even:bg-gray-50/60 [&>td]:border-r [&>td]:border-gray-100 [&>td:last-child]:border-r-0">
                <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{thaiTime(r.created_at)}</td>
                <td className="px-2 py-1 font-mono text-gray-700">{r.machine_no || '—'}{r.roll_no != null ? ` #${r.roll_no}` : ''}</td>
                <td className="px-2 py-1 text-sky-600">{r.withdrawn_by || '—'}</td>
                <td className="px-2 py-1 font-mono text-gray-700">{r.lot_no || '—'}</td>
                <td className="px-2 py-1 font-mono text-amber-600">{r.work_order || '—'}</td>
                <td className="px-2 py-1 font-mono text-blue-500">{r.sale_order || '—'}</td>
                <td className="px-2 py-1 text-gray-600 truncate max-w-[180px]">{r.product_name || '—'}</td>
                <td className="px-2 py-1 text-right font-bold text-gray-800">{num(r.weight ?? 0, 2)}</td>
              </tr>
            ))}
            {sorted.length > 500 && (
              <tr><td colSpan={8} className="px-2 py-1.5 text-center text-gray-400">แสดง 500 จาก {sorted.length} — กด Export เพื่อดูทั้งหมด</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── ตารางรายม้วน "ผลงานกรอ" (output) ────────────────────────────────────────
function OutTable({ rows, fileName }: { rows: OutRoll[]; fileName: string }) {
  const [sort, setSort] = useState<'time' | 'weight'>('time')
  const sorted = useMemo(() => rows.slice().sort((a, b) =>
    sort === 'weight' ? (b.weight ?? 0) - (a.weight ?? 0) : (a.created_at < b.created_at ? 1 : -1)), [rows, sort])
  const loss = (r: OutRoll) => (r.rework_source_weight != null && r.weight != null) ? (r.rework_source_weight - r.weight) : null
  const cols = [
    { header: 'วันที่/เวลา', value: (r: OutRoll) => thaiTime(r.created_at) },
    { header: 'สถานี', value: (r: OutRoll) => r.machine_no ?? '' },
    { header: 'ชั่งที่', value: (r: OutRoll) => r.is_rewound ? 'เครื่องผลิต (ติ๊กมาจากกรอ)' : 'สถานีกรอ' },
    { header: 'คนกรอ', value: (r: OutRoll) => r.inspector ?? '' },
    { header: 'Lot', value: (r: OutRoll) => r.lot_no ?? '' },
    { header: 'ม้วนที่', value: (r: OutRoll) => r.roll_no ?? '' },
    { header: 'ประเภท', value: (r: OutRoll) => typeLabel(r.roll_type) },
    { header: 'น้ำหนัก (kg)', value: (r: OutRoll) => r.weight ?? 0 },
    { header: 'Lot ต้นทาง', value: (r: OutRoll) => r.rework_source_lot ?? '' },
    { header: 'ชุดงาน', value: (r: OutRoll) => (r.rework_source_roll_id ? 'ในระบบ (ผูกม้วนผลิต)' : 'นอกระบบ (สร้างงานเอง)') },
    { header: 'นน.ก่อนกรอ (kg)', value: (r: OutRoll) => r.rework_source_weight ?? '' },
    { header: 'เศษกรอ (kg)', value: (r: OutRoll) => { const l = loss(r); return l != null ? Number(l.toFixed(2)) : '' } },
    { header: 'ขนาด', value: (r: OutRoll) => sizeOf(r) },
    { header: 'สินค้า', value: (r: OutRoll) => r.product_name ?? '' },
    { header: 'ลูกค้า', value: (r: OutRoll) => r.customer ?? '' },
    { header: 'WO', value: (r: OutRoll) => r.work_order ?? '' },
    { header: 'โอนคลัง', value: (r: OutRoll) => r.transferred ? 'โอนแล้ว' : 'รอโอน' },
    { header: 'มาจากกรอ', value: (r: OutRoll) => rewoundFlag(r.is_rewound) },
  ]
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-bold text-gray-600">ผลงานกรอรายม้วน ({rows.length.toLocaleString('th-TH')})</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-gray-400">เรียง:</span>
            <button onClick={() => setSort('time')} className={`px-1.5 py-0.5 rounded ${sort === 'time' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'}`}>เวลา</button>
            <button onClick={() => setSort('weight')} className={`px-1.5 py-0.5 rounded ${sort === 'weight' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'}`}>น้ำหนัก</button>
          </div>
          <ExportButton rows={sorted} cols={cols} fileName={fileName.slice(0, 60)} sheetName="ผลงานกรอ"
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-[10px] font-bold" />
        </div>
      </div>
      <div className="overflow-x-auto max-h-[360px]">
        <table className="w-full text-[11px]">
          <thead className="bg-gray-50 text-gray-500 border-b border-gray-200 sticky top-0">
            <tr>{['วันที่/เวลา', 'สถานี', 'คนกรอ', 'Lot', 'ม้วนที่', 'ประเภท', 'นน. (kg)', 'Lot ต้นทาง', 'เศษกรอ', 'ขนาด', 'สินค้า', 'โอน'].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 font-semibold whitespace-nowrap border-r border-gray-100 last:border-r-0 ${i === 6 || i === 8 ? 'text-right' : 'text-left'}`}>{h}</th>))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 && <tr><td colSpan={12} className="px-2 py-6 text-center text-gray-400">— ไม่มีผลงานกรอในช่วงนี้ —</td></tr>}
            {sorted.slice(0, 500).map(r => {
              const l = loss(r)
              return (
                <tr key={r.id} className="hover:bg-blue-50 even:bg-gray-50/60 [&>td]:border-r [&>td]:border-gray-100 [&>td:last-child]:border-r-0">
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{thaiTime(r.created_at)}</td>
                  <td className="px-2 py-1 font-mono text-gray-700">{r.machine_no || '—'}</td>
                  <td className="px-2 py-1 text-sky-600 truncate max-w-[90px]">{r.inspector || '—'}</td>
                  <td className="px-2 py-1 font-mono text-gray-600">{r.lot_no || '—'}</td>
                  <td className="px-2 py-1 text-gray-600">#{r.roll_no ?? '—'}</td>
                  <td className={`px-2 py-1 whitespace-nowrap font-semibold ${r.roll_type === 'good' ? 'text-emerald-600' : isScrap(r.roll_type) ? 'text-amber-600' : 'text-red-500'}`}>{typeLabel(r.roll_type)}</td>
                  <td className="px-2 py-1 text-right font-bold text-gray-800">{num(r.weight ?? 0, 2)}</td>
                  <td className="px-2 py-1 font-mono text-gray-500">
                    {!r.rework_source_roll_id && <span className="text-[9px] bg-purple-100 text-purple-700 rounded px-1 py-0.5 mr-1 font-sans">นอกระบบ</span>}
                    {r.rework_source_lot || '—'}
                  </td>
                  <td className="px-2 py-1 text-right text-amber-600">{l != null ? num(l, 2) : '—'}</td>
                  <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{sizeOf(r)}</td>
                  <td className="px-2 py-1 text-gray-600 truncate max-w-[150px]">{r.product_name || '—'}</td>
                  <td className={`px-2 py-1 whitespace-nowrap ${r.transferred ? 'text-emerald-600' : 'text-gray-400'}`}>{r.transferred ? '✓' : '—'}</td>
                </tr>
              )
            })}
            {sorted.length > 500 && (
              <tr><td colSpan={12} className="px-2 py-1.5 text-center text-gray-400">แสดง 500 จาก {sorted.length} — กด Export เพื่อดูทั้งหมด</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function RewindDashboard() {
  const today = toDateStr(new Date())
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return toDateStr(d) })
  const [dateTo,   setDateTo]   = useState(today)
  const [fStation, setFStation] = useState('')
  const [fProduct, setFProduct] = useState('')
  const [q,        setQ]        = useState('')

  const [inRolls,  setInRolls]  = useState<InRoll[]>([])
  const [outRolls, setOutRolls] = useState<OutRoll[]>([])
  // ม้วนต้นทาง (source_roll_id) -> ผลงานกรอที่ออกมาจากม้วนนั้น (ไม่จำกัดช่วงวันที่ เพราะกรอข้ามวันได้)
  const [outBySrc, setOutBySrc] = useState<Record<string, { kg: number; scrapKg: number; rolls: number; last: string }>>({})
  const [focus, setFocus] = useState<Focus>('all')
  const [openWo, setOpenWo] = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [tab, setTab] = useState<Tab>('summary')
  const [openDay, setOpenDay] = useState<string | null>(null)

  const rangeDays = useMemo(() => {
    const a = new Date(dateFrom).getTime(), b = new Date(dateTo).getTime()
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) + 1 : 0
  }, [dateFrom, dateTo])

  async function load() {
    setLoading(true)
    const from = new Date(dateFrom); from.setHours(0, 0, 0, 0)
    const to   = new Date(dateTo);   to.setHours(23, 59, 59, 999)

    // ม้วนเข้ามา = ม้วนเสียที่ "ผลิตชั่งไว้" ในช่วงวันที่ (ไม่สนว่าถูกเบิกไปกรอหรือยัง)
    const inRaw = await fetchAll<InRoll>(() => supabase
      .from('production_rolls')
      .select(IN_COLS)
      .eq('roll_type', 'bad')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: false }))
    // กรอง is_legacy ออกให้ตรงกับหน้า "เบิกม้วนกรอ" (ReworkInbox กรอง !r.is_legacy เหมือนกัน)
    // แล้วเติม source_roll_id / withdrawn_by ให้ตรงกับที่ส่วนอื่นของหน้านี้ใช้อยู่
    const inData: InRoll[] = inRaw
      .filter(r => !r.is_legacy)
      .map(r => ({ ...r, source_roll_id: r.id, withdrawn_by: r.rework_received_by ?? null }))

    // ผลงานกรอ = ม้วนที่แผนกกรอชั่ง (section=rewind หรือ is_rewound=true ที่ไปชั่งต่อเครื่องเป่า)
    const outData = await fetchAll<OutRoll>(() => supabase
      .from('production_rolls')
      .select(OUT_COLS)
      .or('section.eq.rewind,is_rewound.eq.true')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: false }))

    setInRolls(inData)
    setOutRolls(outData)

    // ── ม้วนไหน "กรอแล้ว" ──────────────────────────────────────────────────
    // ผลงานกรอผูกกับม้วนต้นทางผ่าน production_rolls.rework_source_roll_id
    // ต้องถามแยกจาก outData เพราะม้วนที่เบิกวันนี้อาจกรอเสร็จวันหลัง (อยู่นอกช่วงวันที่ที่เลือก)
    const srcIds = Array.from(new Set(inData.map(r => r.source_roll_id).filter(Boolean))) as string[]
    const map: Record<string, { kg: number; scrapKg: number; rolls: number; last: string }> = {}
    for (let i = 0; i < srcIds.length; i += 200) {
      const { data } = await supabase.from('production_rolls')
        .select('rework_source_roll_id,weight,roll_type,created_at')
        .in('rework_source_roll_id', srcIds.slice(i, i + 200))
      for (const o of (data ?? []) as any[]) {
        const k = o.rework_source_roll_id as string
        const v = map[k] ?? (map[k] = { kg: 0, scrapKg: 0, rolls: 0, last: '' })
        if (isScrap(o.roll_type)) v.scrapKg += o.weight ?? 0
        else { v.kg += o.weight ?? 0; v.rolls += 1 }
        if (!v.last || o.created_at > v.last) v.last = o.created_at
      }
    }
    setOutBySrc(map)

    setLoading(false)
  }

  useEffect(() => {
    load()
    // ไม่ auto-refresh — กดปุ่ม "รีเฟรช" เมื่ออยากได้ข้อมูลล่าสุด (ลด egress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo])

  // ── ตัวเลือก dropdown ──────────────────────────────────────────────────────
  const stationOptions = useMemo(() =>
    Array.from(new Set(outRolls.map(r => r.machine_no).filter(Boolean) as string[])).sort(), [outRolls])
  const productOptions = useMemo(() => Array.from(new Set([
    ...inRolls.map(r => (r.product_name ?? '').trim()),
    ...outRolls.map(r => (r.product_name ?? '').trim()),
  ].filter(Boolean))).sort(), [inRolls, outRolls])

  // ── ตัวกรองเชิงโครงสร้าง (สินค้า/สถานี) — ใช้กับทุกแท็บสรุป ─────────────────
  // สถานีมีเฉพาะฝั่ง "ออก" (การเบิกไม่ผูกสถานี) → ถ้าเลือกสถานี ฝั่ง "เข้า" จะไม่ถูกกรองด้วยสถานี
  const scopedIn = useMemo(() => inRolls.filter(r =>
    !fProduct || (r.product_name ?? '').trim() === fProduct), [inRolls, fProduct])
  const scopedOut = useMemo(() => outRolls.filter(r => {
    if (fProduct && (r.product_name ?? '').trim() !== fProduct) return false
    if (fStation && r.machine_no !== fStation) return false
    return true
  }), [outRolls, fProduct, fStation])

  // ตัวกรองที่มีผลเฉพาะตารางรายละเอียด (ค้นหา)
  const inDetail = useMemo(() => {
    if (!q.trim()) return scopedIn
    const s = q.trim().toLowerCase()
    return scopedIn.filter(r => [r.lot_no, r.work_order, r.sale_order, r.product_name, r.item_code, r.withdrawn_by]
      .map(v => (v ?? '').toString().toLowerCase()).join(' ').includes(s))
  }, [scopedIn, q])
  const outDetail = useMemo(() => {
    if (!q.trim()) return scopedOut
    const s = q.trim().toLowerCase()
    return scopedOut.filter(r => [r.lot_no, r.work_order, r.sale_order, r.product_name, r.customer, r.inspector, r.machine_no, r.rework_source_lot]
      .map(v => (v ?? '').toString().toLowerCase()).join(' ').includes(s))
  }, [scopedOut, q])

  // ── สถิติรวม ───────────────────────────────────────────────────────────────
  const stat = useMemo(() => {
    const good  = scopedOut.filter(r => r.roll_type === 'good')
    const scrap = scopedOut.filter(r => isScrap(r.roll_type))
    const inKgTot = inKg(scopedIn), goodKg = outKg(good), scrapKg = outKg(scrap)
    const transferred = good.filter(r => r.transferred).length
    const days = new Set([
      ...scopedIn.map(r => thaiDay(r.created_at)),
      ...scopedOut.map(r => thaiDay(r.created_at)),
    ].filter(Boolean)).size
    return {
      inCount: scopedIn.length, inKg: inKgTot,
      inLots: new Set(scopedIn.map(r => (r.lot_no ?? '').trim()).filter(Boolean)).size,
      inSrcRolls: new Set(scopedIn.map(r => r.source_roll_id).filter(Boolean)).size,
      goodCount: good.length, goodKg,
      scrapCount: scrap.length, scrapKg,
      transferred, waitTransfer: good.length - transferred,
      stations: new Set(scopedOut.map(r => r.machine_no).filter(Boolean)).size,
      days,
    }
  }, [scopedIn, scopedOut])

  // ── ม้วนต้นทางที่รับจากผลิต (ไม่ซ้ำ) + สถานะกรอของแต่ละม้วน ────────────────
  // 1 ม้วนต้นทางอาจถูกเบิกหลายครั้ง (กรอต่อ/โยนคืนแล้วเบิกใหม่) -> ยุบเป็นม้วนเดียว ใช้ครั้งล่าสุด
  type SrcRow = {
    id: string; at: string; by: string
    wo: string; so: string; lot: string; product: string; item: string
    kg: number                                        // นน. ม้วนที่มาจากผลิต
    machine: string; rollNo: string; reason: string
    status: string                                    // rework_status ของม้วนต้นทาง
    outKg: number; outScrapKg: number; outRolls: number; outAt: string
    done: boolean; scrapped: boolean
  }
  const srcRows = useMemo<SrcRow[]>(() => {
    const m = new Map<string, SrcRow>()
    for (const r of scopedIn) {
      const id = r.source_roll_id || r.id
      const prev = m.get(id)
      if (prev && prev.at >= (r.created_at ?? '')) continue
      const o = outBySrc[r.source_roll_id ?? ''] ?? { kg: 0, scrapKg: 0, rolls: 0, last: '' }
      m.set(id, {
        id, at: r.created_at, by: (r.withdrawn_by ?? '').trim(),
        wo: (r.work_order ?? '').trim() || '(ไม่ระบุ WO)',
        so: (r.sale_order ?? '').trim(),
        lot: (r.lot_no ?? '').trim() || NO_LOT,
        product: (r.product_name ?? '').trim() || NO_PROD,
        item: (r.item_code ?? '').trim(),
        kg: r.weight ?? 0,
        machine: (r.machine_no ?? '').trim(),
        rollNo: r.roll_no != null ? String(r.roll_no) : '',
        reason: (r.remark ?? '').trim(),
        status: (r.rework_status ?? '').trim(),
        outKg: o.kg, outScrapKg: o.scrapKg, outRolls: o.rolls, outAt: o.last,
        // กรอแล้ว = มีม้วนกรอออกมาอ้างม้วนนี้ หรือระบบ mark ว่า reworked แล้ว
        done: o.rolls > 0 || o.scrapKg > 0 || r.rework_status === 'reworked',
        scrapped: r.rework_status === 'scrapped',
      })
    }
    return Array.from(m.values()).sort((a, b) => (a.at < b.at ? 1 : -1))
  }, [scopedIn, outBySrc])

  // ── มาจากผลิต -> กรอแล้ว / ยังไม่กรอ / เศษเสีย (คำถามหลักของหน้านี้) ────────
  const flow = useMemo(() => {
    const done = srcRows.filter(r => r.done)
    const pend = srcRows.filter(r => !r.done && !r.scrapped)
    const scrapped = srcRows.filter(r => !r.done && r.scrapped)
    const working  = pend.filter(r => r.status === 'reworking')
    const inKgAll    = srcRows.reduce((a, r) => a + r.kg, 0)
    const doneInKg   = done.reduce((a, r) => a + r.kg, 0)
    const pendKg     = pend.reduce((a, r) => a + r.kg, 0)
    const outGoodKg  = done.reduce((a, r) => a + r.outKg, 0)
    const outScrapKg = done.reduce((a, r) => a + r.outScrapKg, 0)
    // เศษเสีย = นน.ที่รับมา − นน.ที่กรอออกได้ (เฉพาะม้วนที่กรอเสร็จแล้ว)
    const lossKg = Math.max(0, doneInKg - outGoodKg)
    return {
      rolls: srcRows.length, inKg: inKgAll,
      doneRolls: done.length, doneInKg, outGoodKg,
      pendRolls: pend.length, pendKg,
      workingRolls: working.length, workingKg: working.reduce((a, r) => a + r.kg, 0),
      scrappedRolls: scrapped.length, scrappedKg: scrapped.reduce((a, r) => a + r.kg, 0),
      lossKg, outScrapKg,
      yieldPct: doneInKg > 0 ? (outGoodKg / doneInKg) * 100 : 0,
    }
  }, [srcRows])

  // จัดกลุ่มม้วนตาม WO ตามโฟกัสที่กดมาจากการ์ด KPI
  const traceRows = useMemo(() => {
    let rows = srcRows
    if (focus === 'pending') rows = rows.filter(r => !r.done && !r.scrapped)
    if (focus === 'done')    rows = rows.filter(r => r.done)
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      rows = rows.filter(r => [r.wo, r.so, r.lot, r.product, r.item, r.by].join(' ').toLowerCase().includes(t))
    }
    const m = new Map<string, { wo: string; rows: SrcRow[]; kg: number; doneKg: number; outKg: number }>()
    for (const r of rows) {
      let v = m.get(r.wo)
      if (!v) { v = { wo: r.wo, rows: [], kg: 0, doneKg: 0, outKg: 0 }; m.set(r.wo, v) }
      v.rows.push(r); v.kg += r.kg; v.outKg += r.outKg
      if (r.done) v.doneKg += r.kg
    }
    return Array.from(m.values()).sort((a, b) => b.kg - a.kg)
  }, [srcRows, focus, q])

  function openTrace(f: Focus) { setFocus(f); setTab('trace'); setOpenWo(null) }

  // ── รวมยอดรายวัน (เข้า + ออก อยู่แถวเดียวกัน) ──────────────────────────────
  type DayRow = {
    key: string
    inRolls: number; inKg: number
    goodRolls: number; goodKg: number
    scrapRolls: number; scrapKg: number
    transferred: number
  }
  const byDay = useMemo(() => {
    const m = new Map<string, DayRow>()
    const get = (k: string) => {
      let v = m.get(k)
      if (!v) { v = { key: k, inRolls: 0, inKg: 0, goodRolls: 0, goodKg: 0, scrapRolls: 0, scrapKg: 0, transferred: 0 }; m.set(k, v) }
      return v
    }
    for (const r of scopedIn) { const v = get(thaiDay(r.created_at)); v.inRolls += 1; v.inKg += r.weight ?? 0 }
    for (const r of scopedOut) {
      const v = get(thaiDay(r.created_at))
      if (r.roll_type === 'good') { v.goodRolls += 1; v.goodKg += r.weight ?? 0; if (r.transferred) v.transferred += 1 }
      else if (isScrap(r.roll_type)) { v.scrapRolls += 1; v.scrapKg += r.weight ?? 0 }
    }
    return Array.from(m.values()).sort((a, b) => (a.key < b.key ? 1 : -1))
  }, [scopedIn, scopedOut])

  // ── รวมยอดตามสินค้า (เข้า + ออก) ───────────────────────────────────────────
  type ProdRow = { key: string; inRolls: number; inKg: number; goodRolls: number; goodKg: number; scrapKg: number }
  const byProduct = useMemo(() => {
    const m = new Map<string, ProdRow>()
    const get = (k: string) => {
      let v = m.get(k)
      if (!v) { v = { key: k, inRolls: 0, inKg: 0, goodRolls: 0, goodKg: 0, scrapKg: 0 }; m.set(k, v) }
      return v
    }
    for (const r of scopedIn) { const v = get((r.product_name ?? '').trim() || NO_PROD); v.inRolls += 1; v.inKg += r.weight ?? 0 }
    for (const r of scopedOut) {
      const v = get((r.product_name ?? '').trim() || NO_PROD)
      if (r.roll_type === 'good') { v.goodRolls += 1; v.goodKg += r.weight ?? 0 }
      else if (isScrap(r.roll_type)) v.scrapKg += r.weight ?? 0
    }
    return Array.from(m.values()).sort((a, b) => (b.goodKg + b.inKg) - (a.goodKg + a.inKg))
  }, [scopedIn, scopedOut])

  // ── ผลงานกรอตามสถานี / คนกรอ (เฉพาะฝั่งออก) ───────────────────────────────
  type OutGroup = { key: string; goodRolls: number; goodKg: number; scrapKg: number; total: number }
  function groupOut(rows: OutRoll[], keyOf: (r: OutRoll) => string): OutGroup[] {
    const m = new Map<string, OutGroup>()
    for (const r of rows) {
      const k = keyOf(r); let v = m.get(k)
      if (!v) { v = { key: k, goodRolls: 0, goodKg: 0, scrapKg: 0, total: 0 }; m.set(k, v) }
      const w = r.weight ?? 0
      if (r.roll_type === 'good') { v.goodRolls += 1; v.goodKg += w }
      else if (isScrap(r.roll_type)) v.scrapKg += w
      v.total += w
    }
    return Array.from(m.values()).sort((a, b) => b.goodKg - a.goodKg)
  }
  const byStation   = useMemo(() => groupOut(scopedOut, r => r.machine_no || '(ไม่ระบุสถานี)'), [scopedOut])
  const byRewinder  = useMemo(() => groupOut(scopedOut, r => (r.inspector ?? '').trim() || '(ไม่ระบุคนกรอ)'), [scopedOut])

  // ── ข้อมูลกราฟ ─────────────────────────────────────────────────────────────
  const chartDaily = useMemo(() => byDay.slice(0, 45).slice().reverse().map(d => ({
    key: d.key.slice(5),
    'มาจากผลิต': Number(d.inKg.toFixed(1)),
    'กรอออก-ดี': Number(d.goodKg.toFixed(1)),
    'เศษ': Number(d.scrapKg.toFixed(1)),
  })), [byDay])
  const chartStation = useMemo(() => byStation.slice(0, 15).map(m => ({
    key: m.key,
    'กรอดี': Number(m.goodKg.toFixed(1)),
    'เศษ': Number(m.scrapKg.toFixed(1)),
  })), [byStation])

  function resetFilters() { setFStation(''); setFProduct(''); setQ('') }
  const detailNarrowed = q.trim() !== ''
  const selCls = 'bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40'
  const tabDesc = TABS.find(t => t.key === tab)?.desc ?? ''

  // ── สมาชิกของวันหนึ่ง ๆ (ตอนกางดูลึก) ──────────────────────────────────────
  const dayIn  = (key: string) => scopedIn.filter(r => thaiDay(r.created_at) === key)
  const dayOut = (key: string) => scopedOut.filter(r => thaiDay(r.created_at) === key)

  // คอลัมน์ export ตารางสรุปรายวัน
  const dayCols = [
    { header: 'วันที่', value: (r: DayRow) => r.key },
    { header: 'มาจากผลิต (ม้วน)', value: (r: DayRow) => r.inRolls },
    { header: 'มาจากผลิต (kg)', value: (r: DayRow) => Number(r.inKg.toFixed(2)) },
    { header: 'กรอดี (ม้วน)', value: (r: DayRow) => r.goodRolls },
    { header: 'กรอดี (kg)', value: (r: DayRow) => Number(r.goodKg.toFixed(2)) },
    { header: 'เศษ (kg)', value: (r: DayRow) => Number(r.scrapKg.toFixed(2)) },
    { header: 'โอนคลังแล้ว (ม้วน)', value: (r: DayRow) => r.transferred },
  ]
  const prodCols = [
    { header: 'สินค้า', value: (r: ProdRow) => r.key },
    { header: 'มาจากผลิต (ม้วน)', value: (r: ProdRow) => r.inRolls },
    { header: 'มาจากผลิต (kg)', value: (r: ProdRow) => Number(r.inKg.toFixed(2)) },
    { header: 'กรอดี (ม้วน)', value: (r: ProdRow) => r.goodRolls },
    { header: 'กรอดี (kg)', value: (r: ProdRow) => Number(r.goodKg.toFixed(2)) },
    { header: 'เศษ (kg)', value: (r: ProdRow) => Number(r.scrapKg.toFixed(2)) },
  ]
  const maxDay = Math.max(1, ...byDay.map(d => Math.max(d.inKg, d.goodKg)))

  return (
    <div className="p-4 space-y-4 bg-gray-50 min-h-full">

      {/* หัวเรื่อง + ตัวกรอง */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-black text-gray-800">🔁 แดชบอร์ดกรอ</h1>
            <p className="text-xs text-gray-500">เฉพาะงานแผนกกรอ — ม้วนที่มาจากผลิต เทียบกับที่กรอออกไปแล้ว</p>
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
            <span className="text-[11px] text-gray-500 font-semibold">สถานีกรอ</span>
            <select value={fStation} onChange={e => { setFStation(e.target.value); setOpenDay(null) }} className={selCls}>
              <option value="">ทุกสถานี</option>
              {stationOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-semibold">สินค้า</span>
            <select value={fProduct} onChange={e => { setFProduct(e.target.value); setOpenDay(null) }} className={selCls}>
              <option value="">ทุกสินค้า</option>
              {productOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <span className="text-[11px] text-gray-500 font-semibold">ค้นหา (Lot / WO / SO / สินค้า / คนกรอ / ผู้เบิก)</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="พิมพ์คำค้น…" className={selCls} />
          </label>
          <button onClick={resetFilters} className="bg-slate-100 hover:bg-slate-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm font-semibold">ล้างตัวกรอง</button>
        </div>

        <p className="text-xs text-gray-500">
          มาจากผลิต <b className="text-gray-700">{stat.inCount.toLocaleString('th-TH')}</b> ม้วน ·
          {' '}กรอออก <b className="text-gray-700">{(stat.goodCount + stat.scrapCount).toLocaleString('th-TH')}</b> ม้วน ·
          {' '}{stat.stations} สถานี · {stat.days} วัน · ช่วงที่เลือก {rangeDays} วัน
        </p>
        {detailNarrowed && (
          <p className="text-[11px] text-gray-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            ℹ️ ช่อง <b>ค้นหา</b> มีผลเฉพาะแท็บ <b>"ม้วนเข้ามา"</b> และ <b>"ผลงานกรอ (รายม้วน)"</b> เท่านั้น —
            แท็บสรุป/ตามวัน/สินค้า/สถานี ยังแสดงภาพรวมจริง · กรองยอดสรุปด้วย วันที่ / สถานี / สินค้า ได้
          </p>
        )}
        {rangeDays > 92 && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            ⚠️ เลือกช่วงยาว ({rangeDays} วัน) — ดึงข้อมูลเยอะ อาจใช้เวลาสักครู่และกินเน็ตมาก · เลือกช่วงสั้นลงจะเร็วกว่า
          </p>
        )}
      </div>

      {/* แท็บ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              title={t.desc}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                tab === t.key ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">{tabDesc}</p>
      </div>

      {/* ── สรุปเข้า–ออก ─────────────────────────────────────────────── */}
      {tab === 'summary' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Kpi icon="📥" tone="blue"  label="รับจากผลิต" value={num(flow.inKg, 0)} unit="kg"
              sub={`${flow.rolls.toLocaleString('th-TH')} ม้วน · ${stat.inLots} Lot`}
              onClick={() => openTrace('all')} />
            <Kpi icon="✅" tone="green" label="กรอออกไปแล้ว" value={num(flow.outGoodKg, 0)} unit="kg"
              sub={`จากม้วนที่กรอเสร็จ ${flow.doneRolls.toLocaleString('th-TH')} ม้วน · ${num(flow.doneInKg, 0)} kg (เสียไป ${num(flow.lossKg, 0)} kg)`}
              onClick={() => openTrace('done')} />
            <Kpi icon="⏳" tone="amber" label="เหลือ (ยังไม่ได้กรอ)" value={num(flow.pendKg, 0)} unit="kg"
              sub={`${flow.pendRolls.toLocaleString('th-TH')} ม้วน${flow.scrappedKg > 0 ? ` · ไม่นับที่ทำลายทิ้ง ${num(flow.scrappedKg, 0)} kg` : ''}`}
              onClick={() => openTrace('pending')} />
          </div>

          {/* แถบสรุป: มาจากผลิต -> กรอแล้ว / ยังค้าง */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <p className="font-bold text-gray-700 text-sm mb-1">🔎 ม้วนที่มาจากผลิต — กรอออกไปแล้วเท่าไหร่</p>
            <p className="text-[11px] text-gray-400 mb-3">นับที่ตัวม้วนจากผลิต (ไม่ใช่รายการเบิก) · กดแถบเพื่อไล่ดูรายม้วนแยกตาม WO</p>
            <div onClick={() => openTrace('all')} className="cursor-pointer">
              <div className="flex h-6 rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
                <div className="bg-emerald-500 flex items-center justify-center text-[10px] font-bold text-white overflow-hidden whitespace-nowrap"
                  style={{ width: `${flow.inKg ? (flow.doneInKg / flow.inKg) * 100 : 0}%` }}>
                  {flow.doneInKg > 0 && `กรอแล้ว ${num(flow.doneInKg, 0)} kg`}
                </div>
                <div className="flex items-center justify-center text-[10px] font-bold text-gray-600 overflow-hidden whitespace-nowrap"
                  style={{ width: `${flow.inKg ? (flow.pendKg / flow.inKg) * 100 : 0}%` }}>
                  {flow.pendKg > 0 && `ยังไม่กรอ ${num(flow.pendKg, 0)} kg`}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-gray-500">
                <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 mr-1" />กรอแล้ว <b className="text-gray-700">{num(flow.doneInKg, 0)}</b> kg · {flow.doneRolls} ม้วน (กรอออกได้ {num(flow.outGoodKg, 0)} kg)</span>
                <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-white border border-gray-300 mr-1" />ยังไม่ได้กรอ <b className="text-gray-700">{num(flow.pendKg, 0)}</b> kg · {flow.pendRolls} ม้วน</span>
                <span className="text-gray-400">· ผลงานกรอที่ชั่งในช่วงนี้ {num(stat.goodKg, 0)} kg ({stat.goodCount.toLocaleString('th-TH')} ม้วน) · เศษชั่งแยก {num(stat.scrapKg, 0)} kg</span>
              </div>
            </div>
          </div>

          {/* Top สินค้า และ Top สถานี */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="font-bold text-gray-700 text-sm mb-3">📦 สินค้าที่กรอออกมากสุด (10 อันดับ)</p>
              {byProduct.length === 0 && <p className="text-gray-400 text-sm">ไม่มีข้อมูล</p>}
              <div className="space-y-2">
                {byProduct.slice(0, 10).map(r => {
                  const max = Math.max(1, ...byProduct.slice(0, 10).map(x => x.goodKg))
                  return (
                    <div key={r.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-gray-700 truncate" title={r.key}>{r.key}</span>
                        <span className="text-gray-500 whitespace-nowrap">
                          เข้า <b className="text-blue-600">{num(r.inKg, 0)}</b> → ออก <b className="text-emerald-600">{num(r.goodKg, 0)}</b> kg · {r.goodRolls} ม้วน
                        </span>
                      </div>
                      <Bar pct={(r.goodKg / max) * 100} tone="bg-emerald-500" />
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="font-bold text-gray-700 text-sm mb-3">🏭 ผลงานกรอตามสถานี</p>
              {byStation.length === 0 && <p className="text-gray-400 text-sm">ไม่มีข้อมูล</p>}
              <div className="space-y-2">
                {byStation.slice(0, 10).map(r => {
                  const max = Math.max(1, ...byStation.map(x => x.goodKg))
                  return (
                    <div key={r.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-bold text-gray-700 truncate">{r.key}</span>
                        <span className="text-gray-500 whitespace-nowrap"><b className="text-emerald-600">{num(r.goodKg, 0)}</b> kg · {r.goodRolls} ม้วน</span>
                      </div>
                      <Bar pct={(r.goodKg / max) * 100} tone="bg-brand-500" />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* กราฟรายวัน เข้า vs ออก */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <p className="font-bold text-gray-700 text-sm mb-1">📅 มาจากผลิต vs กรอออก รายวัน</p>
            <p className="text-[11px] text-gray-400 mb-3">แท่งน้ำเงิน = มาจากผลิต · แท่งเขียว = กรอออก-ดี · แท่งเหลือง = เศษ (kg) · แสดงล่าสุด {Math.min(byDay.length, 45)} วัน</p>
            {byDay.length === 0 ? <p className="text-gray-400 text-sm py-8 text-center">ไม่มีข้อมูล</p> : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartDaily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="key" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtKg} />
                  <Tooltip content={<KgTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <RBar dataKey="มาจากผลิต" fill="#3b82f6" />
                  <RBar dataKey="กรอออก-ดี" fill="#10b981" />
                  <RBar dataKey="เศษ" fill="#f59e0b" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* กราฟผลงานกรอต่อสถานี */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <p className="font-bold text-gray-700 text-sm mb-1">🏭 ผลงานกรอต่อสถานี</p>
            <p className="text-[11px] text-gray-400 mb-3">น้ำหนัก (kg) แยกกรอดี / เศษ</p>
            {byStation.length === 0 ? <p className="text-gray-400 text-sm py-8 text-center">ไม่มีข้อมูล</p> : (
              <ResponsiveContainer width="100%" height={Math.max(200, byStation.length * 40)}>
                <BarChart data={chartStation} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={fmtKg} />
                  <YAxis type="category" dataKey="key" width={70} tick={{ fontSize: 11 }} />
                  <Tooltip content={<KgTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <RBar dataKey="กรอดี" stackId="a" fill="#10b981" />
                  <RBar dataKey="เศษ"  stackId="a" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ── ตามวัน ───────────────────────────────────────────────────── */}
      {tab === 'day' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
            <p className="font-bold text-gray-700 text-sm">สรุปรายวัน <span className="text-gray-400 font-normal">({byDay.length} วัน)</span>
              <span className="ml-2 text-[11px] text-blue-500 font-normal">👆 คลิกที่แถวเพื่อดูรายละเอียดของวันนั้น</span></p>
            <ExportButton rows={byDay} cols={dayCols} fileName="rewind-by-day" sheetName="ตามวัน" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
                <tr>{['วันที่', 'มาจากผลิต (ม้วน)', 'มาจากผลิต (kg)', 'กรอดี (ม้วน)', 'กรอดี (kg)', 'เศษ (kg)', 'โอนแล้ว', 'สัดส่วนผลิต/กรอ'].map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 font-semibold whitespace-nowrap border-r border-gray-100 last:border-r-0 ${i === 0 || i === 7 ? 'text-left' : 'text-right'}`}>{h}</th>))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {byDay.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">ไม่มีข้อมูลตามตัวกรองที่เลือก</td></tr>}
                {byDay.map(r => {
                  const open = openDay === r.key
                  return (
                    <Fragment key={r.key}>
                      <tr className={`cursor-pointer hover:bg-blue-50 ${open ? 'bg-blue-50/60' : 'even:bg-gray-50/60'}`}
                        onClick={() => setOpenDay(o => (o === r.key ? null : r.key))}>
                        <td className="px-3 py-2.5 font-mono text-gray-700 font-bold whitespace-nowrap border-r border-gray-100 last:border-r-0">
                          <span className="text-gray-400 mr-1">{open ? '▾' : '▸'}</span>{r.key}
                        </td>
                        <td className="px-3 py-2.5 text-right text-blue-600 font-bold border-r border-gray-100 last:border-r-0">{r.inRolls.toLocaleString('th-TH')}</td>
                        <td className="px-3 py-2.5 text-right text-blue-500 border-r border-gray-100 last:border-r-0">{num(r.inKg)}</td>
                        <td className="px-3 py-2.5 text-right text-emerald-600 font-bold border-r border-gray-100 last:border-r-0">{r.goodRolls.toLocaleString('th-TH')}</td>
                        <td className="px-3 py-2.5 text-right text-emerald-600 font-bold border-r border-gray-100 last:border-r-0">{num(r.goodKg)}</td>
                        <td className="px-3 py-2.5 text-right text-amber-600 border-r border-gray-100 last:border-r-0">{num(r.scrapKg)}</td>
                        <td className="px-3 py-2.5 text-right text-gray-500 border-r border-gray-100 last:border-r-0">{r.transferred || '—'}</td>
                        <td className="px-3 py-2.5 w-40 border-r border-gray-100 last:border-r-0">
                          <div className="flex items-center gap-1">
                            <div className="flex-1"><Bar pct={(r.inKg / maxDay) * 100} tone="bg-blue-400" /></div>
                            <div className="flex-1"><Bar pct={(r.goodKg / maxDay) * 100} tone="bg-emerald-500" /></div>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-3 py-3">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-gray-800">🔎 {r.key}</span>
                                <span className="text-[11px] bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">จากผลิต {r.inRolls} ม้วน · {num(r.inKg, 0)} kg</span>
                                <span className="text-[11px] bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">กรอดี {r.goodRolls} ม้วน · {num(r.goodKg, 0)} kg</span>
                                <span className="text-[11px] bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">เศษ {num(r.scrapKg, 0)} kg</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                                <MiniBreak title="📦 จากผลิต — ตามสินค้า" tone="bg-blue-400" rows={miniGroup(dayIn(r.key), x => (x.product_name ?? '').trim() || NO_PROD, x => x.weight ?? 0)} />
                                <MiniBreak title="🏷 จากผลิต — ตาม Lot" tone="bg-blue-400" rows={miniGroup(dayIn(r.key), x => (x.lot_no ?? '').trim() || NO_LOT, x => x.weight ?? 0)} />
                                <MiniBreak title="🏭 กรอออก — ตามสถานี" tone="bg-emerald-500" rows={miniGroup(dayOut(r.key).filter(x => x.roll_type === 'good'), x => x.machine_no || '(ไม่ระบุสถานี)', x => x.weight ?? 0)} />
                                <MiniBreak title="👷 กรอออก — ตามคนกรอ" tone="bg-emerald-500" rows={miniGroup(dayOut(r.key).filter(x => x.roll_type === 'good'), x => (x.inspector ?? '').trim() || '(ไม่ระบุ)', x => x.weight ?? 0)} />
                              </div>
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                <InTable rows={dayIn(r.key)} fileName={`rewind-in-${r.key}`} />
                                <OutTable rows={dayOut(r.key)} fileName={`rewind-out-${r.key}`} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              {byDay.length > 0 && (
                <tfoot className="bg-gray-50 border-t border-gray-200 font-bold text-gray-700">
                  <tr>
                    <td className="px-3 py-2.5 border-r border-gray-100 last:border-r-0">รวมทั้งหมด</td>
                    <td className="px-3 py-2.5 text-right text-blue-700 border-r border-gray-100 last:border-r-0">{stat.inCount.toLocaleString('th-TH')}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 border-r border-gray-100 last:border-r-0">{num(stat.inKg)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-700 border-r border-gray-100 last:border-r-0">{stat.goodCount.toLocaleString('th-TH')}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-700 border-r border-gray-100 last:border-r-0">{num(stat.goodKg)}</td>
                    <td className="px-3 py-2.5 text-right text-amber-700 border-r border-gray-100 last:border-r-0">{num(stat.scrapKg)}</td>
                    <td className="px-3 py-2.5 text-right border-r border-gray-100 last:border-r-0">{stat.transferred.toLocaleString('th-TH')}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── ตามสินค้า ─────────────────────────────────────────────────── */}
      {tab === 'product' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
            <p className="font-bold text-gray-700 text-sm">สรุปตามสินค้า <span className="text-gray-400 font-normal">({byProduct.length} รายการ)</span></p>
            <ExportButton rows={byProduct} cols={prodCols} fileName="rewind-by-product" sheetName="ตามสินค้า" />
          </div>
          <div className="overflow-x-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 border-b border-gray-200 sticky top-0">
                <tr>{['สินค้า', 'มาจากผลิต (ม้วน)', 'มาจากผลิต (kg)', 'กรอดี (ม้วน)', 'กรอดี (kg)', 'เศษ (kg)'].map((h, i) => (
                  <th key={h} className={`px-3 py-2.5 font-semibold whitespace-nowrap border-r border-gray-100 last:border-r-0 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {byProduct.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">ไม่มีข้อมูลตามตัวกรองที่เลือก</td></tr>}
                {byProduct.map(r => (
                  <tr key={r.key} className="hover:bg-blue-50 even:bg-gray-50/60">
                    <td className="px-3 py-2.5 text-gray-800 font-semibold max-w-[280px] truncate border-r border-gray-100 last:border-r-0" title={r.key}>{r.key}</td>
                    <td className="px-3 py-2.5 text-right text-blue-600 font-bold border-r border-gray-100 last:border-r-0">{r.inRolls.toLocaleString('th-TH')}</td>
                    <td className="px-3 py-2.5 text-right text-blue-500 border-r border-gray-100 last:border-r-0">{num(r.inKg)}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-600 font-bold border-r border-gray-100 last:border-r-0">{r.goodRolls.toLocaleString('th-TH')}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-600 font-bold border-r border-gray-100 last:border-r-0">{num(r.goodKg)}</td>
                    <td className="px-3 py-2.5 text-right text-amber-600 border-r border-gray-100 last:border-r-0">{num(r.scrapKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ตามสถานี / คนกรอ ──────────────────────────────────────────── */}
      {tab === 'station' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[
            { title: '🏭 ผลงานกรอตามสถานี', rows: byStation, unit: 'สถานี' },
            { title: '👷 ผลงานกรอตามคนกรอ', rows: byRewinder, unit: 'คน' },
          ].map(box => {
            const max = Math.max(1, ...box.rows.map(r => r.goodKg))
            return (
              <div key={box.title} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
                  <p className="font-bold text-gray-700 text-sm">{box.title} <span className="text-gray-400 font-normal">({box.rows.length} {box.unit})</span></p>
                  <ExportButton rows={box.rows} fileName={`rewind-${box.unit}`} sheetName={box.unit}
                    cols={[
                      { header: box.unit, value: (r: OutGroup) => r.key },
                      { header: 'กรอดี (ม้วน)', value: (r: OutGroup) => r.goodRolls },
                      { header: 'กรอดี (kg)', value: (r: OutGroup) => Number(r.goodKg.toFixed(2)) },
                      { header: 'เศษ (kg)', value: (r: OutGroup) => Number(r.scrapKg.toFixed(2)) },
                    ]} />
                </div>
                <div className="p-4 space-y-2">
                  {box.rows.length === 0 && <p className="text-gray-400 text-sm">ไม่มีข้อมูล</p>}
                  {box.rows.map(r => (
                    <div key={r.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-gray-700 truncate" title={r.key}>{r.key}</span>
                        <span className="text-gray-500 whitespace-nowrap">
                          <b className="text-emerald-600">{num(r.goodKg, 0)}</b> kg · {r.goodRolls} ม้วน{r.scrapKg > 0 && <> · เศษ <b className="text-amber-600">{num(r.scrapKg, 0)}</b></>}
                        </span>
                      </div>
                      <Bar pct={(r.goodKg / max) * 100} tone="bg-emerald-500" />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── ไล่ม้วนตาม WO (ขาว = ยังไม่กรอ · เขียว = กรอแล้ว) ──────────────── */}
      {tab === 'trace' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
            {([
              { k: 'all',     label: `ทั้งหมด ${num(flow.inKg, 0)} kg (${flow.rolls} ม้วน)`,          cls: 'bg-brand-600' },
              { k: 'pending', label: `ยังไม่ได้กรอ ${num(flow.pendKg, 0)} kg (${flow.pendRolls} ม้วน)`, cls: 'bg-slate-600' },
              { k: 'done',    label: `กรอแล้ว ${num(flow.doneInKg, 0)} kg (${flow.doneRolls} ม้วน)`,    cls: 'bg-emerald-600' },
            ] as { k: Focus; label: string; cls: string }[]).map(b => (
              <button key={b.k} onClick={() => { setFocus(b.k); setOpenWo(null) }}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold ${focus === b.k ? `${b.cls} text-white` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {b.label}
              </button>
            ))}
            <span className="text-[11px] text-gray-400 ml-auto">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-white border border-gray-300 mr-1 align-middle" />ยังไม่ได้กรอ
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-100 border border-emerald-400 ml-3 mr-1 align-middle" />กรอแล้ว
              {q.trim() && <span className="ml-3 text-brand-600">· กรองด้วยคำค้น "{q.trim()}"</span>}
            </span>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
              <p className="font-bold text-gray-700 text-sm">
                แยกตาม WO <span className="text-gray-400 font-normal">({traceRows.length} WO · {num(traceRows.reduce((a, g) => a + g.kg, 0), 0)} kg · {traceRows.reduce((a, g) => a + g.rows.length, 0)} ม้วน)</span>
                <span className="ml-2 text-[11px] text-blue-500 font-normal">👆 กด WO เพื่อกางดูม้วนทั้งหมด</span>
              </p>
              <ExportButton
                rows={traceRows.flatMap(g => g.rows)}
                cols={[
                  { header: 'WO', value: (r: SrcRow) => r.wo },
                  { header: 'SO', value: (r: SrcRow) => r.so },
                  { header: 'Lot ต้นทาง', value: (r: SrcRow) => r.lot },
                  { header: 'สินค้า', value: (r: SrcRow) => r.product },
                  { header: 'นน.จากผลิต (kg)', value: (r: SrcRow) => Number(r.kg.toFixed(2)) },
                  { header: 'เครื่องเป่า', value: (r: SrcRow) => r.machine },
                  { header: 'ม้วนที่', value: (r: SrcRow) => r.rollNo },
                  { header: 'สถานะ', value: (r: SrcRow) => (r.done ? 'กรอแล้ว' : r.scrapped ? 'ทำลายทิ้ง' : 'ยังไม่ได้กรอ') },
                  { header: 'กรอออกได้ (kg)', value: (r: SrcRow) => Number(r.outKg.toFixed(2)) },
                  { header: 'เศษชั่งแยก (kg)', value: (r: SrcRow) => Number(r.outScrapKg.toFixed(2)) },
                  { header: 'วันที่ผลิตชั่ง', value: (r: SrcRow) => thaiTime(r.at) },
                  { header: 'เหตุที่ต้องกรอ', value: (r: SrcRow) => r.reason },
                  { header: 'ผู้เบิก', value: (r: SrcRow) => r.by },
                ]}
                fileName="rewind-trace-by-wo" sheetName="ไล่ม้วนตาม WO" />
            </div>

            <div className="divide-y divide-gray-100">
              {traceRows.length === 0 && <p className="px-4 py-8 text-center text-gray-400 text-sm">ไม่มีม้วนตามเงื่อนไขที่เลือก</p>}
              {traceRows.map(g => {
                const open = openWo === g.wo
                const doneN = g.rows.filter(r => r.done).length
                return (
                  <div key={g.wo}>
                    <div onClick={() => setOpenWo(o => (o === g.wo ? null : g.wo))}
                      className={`px-4 py-2.5 flex flex-wrap items-center gap-3 cursor-pointer hover:bg-gray-50 ${open ? 'bg-blue-50/60' : ''}`}>
                      <span className="font-mono font-bold text-gray-800 text-sm">
                        <span className="text-gray-400 mr-1">{open ? '▾' : '▸'}</span>{g.wo}
                      </span>
                      <span className="text-[11px] text-gray-500"><b className="text-gray-800 text-xs">{num(g.kg, 0)}</b> kg · {g.rows.length} ม้วน</span>
                      <span className="text-[11px] bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">กรอแล้ว {num(g.doneKg, 0)} kg ({doneN})</span>
                      <span className="text-[11px] bg-slate-100 text-gray-600 rounded-full px-2 py-0.5">ยังไม่กรอ {num(g.kg - g.doneKg, 0)} kg ({g.rows.length - doneN})</span>
                      {g.outKg > 0 && <span className="text-[11px] text-gray-400">กรอออกได้ {num(g.outKg, 0)} kg</span>}
                      <div className="flex-1 min-w-[80px] max-w-[220px] ml-auto">
                        <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 border border-gray-200">
                          <div className="bg-emerald-500" style={{ width: `${g.kg ? (g.doneKg / g.kg) * 100 : 0}%` }} />
                        </div>
                      </div>
                    </div>
                    {open && (
                      <div className="px-4 pb-4 pt-1 bg-slate-50/70">
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                          {g.rows.map(r => (
                            <div key={r.id}
                              className={`rounded-lg border p-2.5 text-[11px] ${r.done ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-gray-300'}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-bold text-gray-800 truncate" title={r.lot}>{r.lot}</span>
                                <span className={`font-bold whitespace-nowrap ${r.done ? 'text-emerald-700' : r.scrapped ? 'text-red-500' : 'text-gray-500'}`}>
                                  {r.done ? '✓ กรอแล้ว'
                                    : r.scrapped ? '🗑 ทำลายทิ้ง'
                                    : r.status === 'reworking' ? '○ ยังไม่ได้กรอ (เบิกไปแล้ว)'
                                    : '○ ยังไม่ได้กรอ (ยังไม่ถูกเบิก)'}
                                </span>
                              </div>
                              <p className="text-gray-600 truncate mt-0.5" title={r.product}>{r.product}</p>
                              <p className="mt-1 text-base font-black text-gray-800 leading-none">
                                {num(r.kg, 2)} <span className="text-[10px] font-normal text-gray-400">kg จากผลิต</span>
                                {r.done && r.outKg > 0 && <span className="text-emerald-700"> → {num(r.outKg, 2)} <span className="text-[10px] font-normal text-emerald-500">kg กรอออก</span></span>}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-gray-500">
                                {r.done && r.outRolls > 0 && <span>ได้ {r.outRolls} ม้วน</span>}
                                {r.done && r.outScrapKg > 0 && <span>เศษ <b className="text-amber-600">{num(r.outScrapKg, 2)}</b> kg</span>}
                                {r.done && r.outKg > 0 && r.kg > 0 && <span className="text-gray-400">เสีย {num(Math.max(0, r.kg - r.outKg), 2)} kg</span>}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 mt-1 text-[10px] text-gray-400">
                                <span>ผลิตชั่ง {thaiTime(r.at)}{r.machine && ` · ${r.machine}`}{r.rollNo && ` #${r.rollNo}`}</span>
                                {r.by && <span>ผู้เบิก {r.by}</span>}
                                {r.reason && <span className="truncate max-w-[160px]" title={r.reason}>เหตุ: {r.reason}</span>}
                                {r.so && <span>SO {r.so}</span>}
                                {r.done && r.outAt && <span>กรอเสร็จ {thaiTime(r.outAt)}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── ม้วนเข้ามา (รายการเบิก) ────────────────────────────────────── */}
      {tab === 'incoming' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">มาจากผลิต {inDetail.length.toLocaleString('th-TH')} ม้วน · {num(inKg(inDetail), 0)} kg</span>
            <span className="text-[11px] bg-slate-100 text-gray-600 rounded-full px-2 py-0.5">Lot {new Set(inDetail.map(r => (r.lot_no ?? '').trim()).filter(Boolean)).size.toLocaleString('th-TH')}</span>
          </div>
          <InTable rows={inDetail} fileName="rewind-incoming" />
        </div>
      )}

      {/* ── ผลงานกรอ รายม้วน ──────────────────────────────────────────── */}
      {tab === 'output' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">กรอดี {outDetail.filter(r => r.roll_type === 'good').length.toLocaleString('th-TH')} ม้วน · {num(outKg(outDetail.filter(r => r.roll_type === 'good')), 0)} kg</span>
            <span className="text-[11px] bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">เศษ {outDetail.filter(r => isScrap(r.roll_type)).length.toLocaleString('th-TH')} ม้วน</span>
          </div>
          <OutTable rows={outDetail} fileName="rewind-output" />
        </div>
      )}
    </div>
  )
}
