import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { supabase, fetchAll } from '../lib/supabase'
import ExportButton from '../components/ExportButton'

// ─────────────────────────────────────────────────────────────────────────────
// รายงานเศษ — ดูยอดเศษ (scrap_clear / scrap_color / scrap_lump) ตามช่วงเวลา
// ช่วงด่วน: วันนี้ · 7 วัน · เดือนนี้ · เลือกเอง  แล้วรวมยอดเป็น ต่อวัน / ต่อสัปดาห์ / ต่อเดือน
// แยกดูได้: ผลิต(เป่า) / กรอ / ทั้งหมด · แยกตามเครื่อง
// ─────────────────────────────────────────────────────────────────────────────

type Row = {
  id: string; roll_type: string; weight: number; machine_no: string
  section?: string | null; created_at: string; lot_no?: string | null
  work_order?: string | null; customer?: string | null; remark?: string | null
}
type Preset = 'today' | '7d' | 'month' | 'custom'
type Group = 'day' | 'week' | 'month'
type Sect = 'all' | 'blow' | 'rewind'
type Split = 'type' | 'machine' | 'shift'
type Col = { key: string; label: string; color: string }

const TYPES = [
  { key: 'scrap_clear', label: 'เศษใส',  color: '#38bdf8' },
  { key: 'scrap_color', label: 'เศษสี',  color: '#f59e0b' },
  { key: 'scrap_lump',  label: 'เศษก้อน', color: '#ef4444' },
] as const
// กะ: เช้า 08:00–20:00 · ดึก 20:00–08:00 — ชั่วโมงหลังเที่ยงคืนถึง 08:00 นับเป็นกะดึกของ "วันก่อนหน้า"
const SHIFTS: Col[] = [
  { key: 'day',   label: 'กะเช้า (08–20)', color: '#f59e0b' },
  { key: 'night', label: 'กะดึก (20–08)',  color: '#6366f1' },
]
const bkkHour = (iso: string) => Number(new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false })) % 24
const shiftOf = (iso: string) => { const h = bkkHour(iso); return h >= 8 && h < 20 ? 'day' : 'night' }
const shiftDay = (iso: string) => ymd(new Date(new Date(iso).getTime() - 8 * 3600_000))
const shiftLabel = (k: string) => SHIFTS.find(x => x.key === k)?.label ?? k
const PALETTE = ['#0ea5e9', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#a855f7', '#64748b', '#eab308', '#22c55e', '#e11d48']
const typeLabel = (t: string) => TYPES.find(x => x.key === t)?.label ?? t

const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const thaiDay = (iso: string) => ymd(new Date(iso))
const num = (n: number, d = 2) => (n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
function addDays(s: string, n: number) {
  const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
// จันทร์ของสัปดาห์นั้น
function weekStart(s: string) {
  const d = new Date(s + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7
  return addDays(s, -dow)
}
function bucketOf(day: string, g: Group) {
  return g === 'day' ? day : g === 'week' ? weekStart(day) : day.slice(0, 7)
}
function bucketLabel(k: string, g: Group) {
  const fmt = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  if (g === 'day') return fmt(k)
  if (g === 'week') return `${fmt(k)} – ${fmt(addDays(k, 6))}`
  return new Date(k + '-01T00:00:00Z').toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function presetRange(p: Preset): [string, string] {
  const today = ymd(new Date())
  if (p === 'today') return [today, today]
  if (p === '7d') return [addDays(today, -6), today]
  return [today.slice(0, 7) + '-01', today]
}

type Agg = { key: string; label: string; total: number; count: number; by: Record<string, number> }
function emptyAgg(key: string, label: string): Agg {
  return { key, label, total: 0, count: 0, by: {} }
}
function add(a: Agg, r: Row, col: string) {
  const w = Number(r.weight ?? 0)
  a.total += w; a.count += 1
  a.by[col] = (a.by[col] ?? 0) + w
}
const machineKey = (r: Row) => r.machine_no || '(ไม่ระบุ)'

export default function ScrapReport() {
  const [preset, setPreset] = useState<Preset>('7d')
  const [[from, to], setRange] = useState<[string, string]>(presetRange('7d'))
  const [group, setGroup] = useState<Group>('day')
  const [sect, setSect] = useState<Sect>('all')
  const [machine, setMachine] = useState('')
  const [split, setSplit] = useState<Split>('type')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  function pickPreset(p: Preset) {
    setPreset(p)
    if (p !== 'custom') setRange(presetRange(p))
    if (p === 'today') setGroup('day')
  }

  useEffect(() => {
    if (!from || !to || from > to) return
    let alive = true
    setLoading(true); setErr('')
    // ขอบเวลาไทย (UTC+7)
    const fromIso = new Date(from + 'T00:00:00+07:00').toISOString()
    // ดึงเผื่อถึง 08:00 ของวันถัดไป — กะดึกของวันสุดท้ายจะได้ครบ (ตัดตามวันอีกทีตอนกรอง)
    const toIso = new Date(addDays(to, 1) + 'T07:59:59.999+07:00').toISOString()
    fetchAll<Row>(() => supabase
      .from('production_rolls')
      .select('id,roll_type,weight,machine_no,section,created_at,lot_no,work_order,customer,remark')
      .like('roll_type', 'scrap%')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: false }), { strict: true })
      .then(d => { if (alive) setRows(d) })
      .catch(e => { if (alive) { setRows([]); setErr(e?.message ?? 'โหลดข้อมูลไม่สำเร็จ') } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [from, to])

  // โหมดแยกกะ นับวันตาม "วันของกะ" · โหมดอื่นนับตามวันปฏิทิน
  const dayOf = (r: Row) => split === 'shift' ? shiftDay(r.created_at) : thaiDay(r.created_at)
  const scoped = useMemo(() => rows.filter(r => {
    const d = dayOf(r)
    return d >= from && d <= to
      && (sect === 'all' || (r.section ?? 'blow') === sect) && (!machine || r.machine_no === machine)
  }), [rows, sect, machine, split, from, to])

  const machines = useMemo(() =>
    [...new Set(rows.map(r => r.machine_no).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  [rows])

  const colOf = (r: Row) => split === 'type' ? r.roll_type : split === 'shift' ? shiftOf(r.created_at) : machineKey(r)
  const cols: Col[] = useMemo(() => {
    if (split === 'type') return TYPES.map(t => ({ ...t }))
    if (split === 'shift') return SHIFTS
    return [...new Set(scoped.map(machineKey))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((k, i) => ({ key: k, label: k, color: PALETTE[i % PALETTE.length] }))
  }, [split, scoped])

  const total = useMemo(() => { const a = emptyAgg('', 'รวม'); scoped.forEach(r => add(a, r, colOf(r))); return a }, [scoped, split])
  const typeTotal = useMemo(() => { const a = emptyAgg('', 'รวม'); scoped.forEach(r => add(a, r, r.roll_type)); return a }, [scoped])

  const byPeriod = useMemo(() => {
    const m = new Map<string, Agg>()
    // ใส่ช่วงว่างด้วย จะได้เห็นวันที่ไม่มีเศษ
    if (from <= to) {
      for (let d = from, i = 0; d <= to && i < 1000; d = addDays(d, 1), i++) {
        const k = bucketOf(d, group); if (!m.has(k)) m.set(k, emptyAgg(k, bucketLabel(k, group)))
      }
    }
    scoped.forEach(r => {
      const k = bucketOf(dayOf(r), group)
      if (!m.has(k)) m.set(k, emptyAgg(k, bucketLabel(k, group)))
      add(m.get(k)!, r, colOf(r))
    })
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [scoped, group, from, to, split])

  const byMachine = useMemo(() => {
    const m = new Map<string, Agg>()
    scoped.forEach(r => {
      const k = machineKey(r)
      if (!m.has(k)) m.set(k, emptyAgg(k, k))
      add(m.get(k)!, r, r.roll_type)
    })
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [scoped])

  const byShift = useMemo(() => {
    const m = new Map<string, Agg>(SHIFTS.map(x => [x.key, emptyAgg(x.key, x.label)]))
    scoped.forEach(r => add(m.get(shiftOf(r.created_at))!, r, r.roll_type))
    return [...m.values()]
  }, [scoped])

  const periodsWithData = byPeriod.filter(p => p.count > 0).length
  const avg = byPeriod.length ? total.total / byPeriod.length : 0
  const splitName = split === 'type' ? 'ชนิดเศษ' : split === 'machine' ? 'เครื่อง' : 'กะ'
  const groupName = group === 'day' ? 'วัน' : group === 'week' ? 'สัปดาห์' : 'เดือน'

  const btn = (on: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-semibold border ${on ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`

  const typeCols: Col[] = TYPES.map(t => ({ ...t }))
  const aggCols = (first: string, cs: Col[]) => [
    { header: first, value: (r: Agg) => r.label },
    ...cs.map(c => ({ header: `${c.label} (kg)`, value: (r: Agg) => Number((r.by[c.key] ?? 0).toFixed(2)) })),
    { header: 'รวม (kg)', value: (r: Agg) => Number(r.total.toFixed(2)) },
    { header: 'จำนวนครั้ง', value: (r: Agg) => r.count },
  ]

  const AggTable = ({ data, first, cs, sum }: { data: Agg[]; first: string; cs: Col[]; sum: Agg }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-gray-800">
        <thead className="bg-gray-50 text-gray-500 text-xs">
          <tr>
            <th className="px-3 py-2 text-left">{first}</th>
            {cs.map(t => <th key={t.key} className="px-3 py-2 text-right whitespace-nowrap">{t.label} (kg)</th>)}
            <th className="px-3 py-2 text-right">รวม (kg)</th>
            <th className="px-3 py-2 text-right">ครั้ง</th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.key} className={`border-t border-gray-100 ${r.count ? '' : 'text-gray-400'}`}>
              <td className="px-3 py-2 whitespace-nowrap">{r.label}</td>
              {cs.map(t => <td key={t.key} className="px-3 py-2 text-right">{num(r.by[t.key] ?? 0)}</td>)}
              <td className="px-3 py-2 text-right font-bold">{num(r.total)}</td>
              <td className="px-3 py-2 text-right">{r.count}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-gray-300 bg-amber-50 font-bold">
            <td className="px-3 py-2">รวม</td>
            {cs.map(t => <td key={t.key} className="px-3 py-2 text-right">{num(sum.by[t.key] ?? 0)}</td>)}
            <td className="px-3 py-2 text-right">{num(sum.total)}</td>
            <td className="px-3 py-2 text-right">{sum.count}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <h1 className="text-lg font-bold text-gray-800">🗑 รายงานเศษ</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 w-14">ช่วงเวลา</span>
          <button className={btn(preset === 'today')} onClick={() => pickPreset('today')}>วันนี้</button>
          <button className={btn(preset === '7d')} onClick={() => pickPreset('7d')}>7 วันล่าสุด</button>
          <button className={btn(preset === 'month')} onClick={() => pickPreset('month')}>เดือนนี้</button>
          <button className={btn(preset === 'custom')} onClick={() => pickPreset('custom')}>เลือกเอง</button>
          <input type="date" value={from} max={to}
            onChange={e => { setPreset('custom'); setRange([e.target.value, to]) }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-700 [color-scheme:light]" />
          <span className="text-gray-400">ถึง</span>
          <input type="date" value={to} min={from}
            onChange={e => { setPreset('custom'); setRange([from, e.target.value]) }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-700 [color-scheme:light]" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 w-14">รวมยอด</span>
          <button className={btn(group === 'day')} onClick={() => setGroup('day')}>ต่อวัน</button>
          <button className={btn(group === 'week')} onClick={() => setGroup('week')}>ต่อ 7 วัน (สัปดาห์)</button>
          <button className={btn(group === 'month')} onClick={() => setGroup('month')}>ต่อเดือน</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 w-14">แยกตาม</span>
          <button className={btn(split === 'type')} onClick={() => setSplit('type')}>ชนิดเศษ</button>
          <button className={btn(split === 'machine')} onClick={() => setSplit('machine')}>ต่อเครื่อง</button>
          <button className={btn(split === 'shift')} onClick={() => setSplit('shift')}>ต่อกะ</button>
          <span className="w-4" />
          <select value={sect} onChange={e => setSect(e.target.value as Sect)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-700 [color-scheme:light]">
            <option value="all">ทุกแผนก</option>
            <option value="blow">ผลิต(เป่า)</option>
            <option value="rewind">กรอ</option>
          </select>
          <select value={machine} onChange={e => setMachine(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-700 [color-scheme:light]">
            <option value="">ทุกเครื่อง</option>
            {machines.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {split === 'shift' && <p className="text-xs text-gray-400">กะเช้า 08:00–20:00 · กะดึก 20:00–08:00 — ช่วงหลังเที่ยงคืนถึง 08:00 นับเป็นกะดึกของวันก่อนหน้า</p>}
        {from > to && <p className="text-sm text-red-500">วันเริ่มต้องไม่เกินวันสิ้นสุด</p>}
        {err && <p className="text-sm text-red-500">⚠ {err}</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl shadow-sm p-3">
          <p className="text-xs text-gray-500">เศษรวม</p>
          <p className="text-2xl font-bold text-amber-600">{num(typeTotal.total)} <span className="text-sm font-normal">kg</span></p>
          <p className="text-xs text-gray-400">{typeTotal.count} ครั้ง</p>
        </div>
        {TYPES.map(t => (
          <div key={t.key} className="bg-white rounded-xl shadow-sm p-3">
            <p className="text-xs text-gray-500">{t.label}</p>
            <p className="text-2xl font-bold" style={{ color: t.color }}>{num(typeTotal.by[t.key] ?? 0)} <span className="text-sm font-normal text-gray-500">kg</span></p>
            <p className="text-xs text-gray-400">{typeTotal.total ? num((typeTotal.by[t.key] ?? 0) / typeTotal.total * 100, 2) : 0}%</p>
          </div>
        ))}
        <div className="bg-white rounded-xl shadow-sm p-3">
          <p className="text-xs text-gray-500">เฉลี่ยต่อ{groupName}</p>
          <p className="text-2xl font-bold text-gray-700">{num(avg)} <span className="text-sm font-normal">kg</span></p>
          <p className="text-xs text-gray-400">มีเศษ {periodsWithData}/{byPeriod.length} {groupName}</p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl shadow-sm p-10 text-center text-gray-400">กำลังโหลด…</div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <p className="font-semibold text-gray-700 mb-2">เศษต่อ{groupName} · แยก{splitName}</p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byPeriod.map(p => ({ name: p.label, ...Object.fromEntries(cols.map(t => [t.label, Number((p.by[t.key] ?? 0).toFixed(2))])) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => `${num(Number(v))} kg`} />
                  <Legend />
                  {cols.map(t => <Bar key={t.key} dataKey={t.label} stackId="s" fill={t.color} isAnimationActive={false} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm">
            <div className="flex items-center justify-between p-3">
              <p className="font-semibold text-gray-700">ตารางเศษต่อ{groupName} · แยก{splitName}</p>
              <ExportButton rows={byPeriod} cols={aggCols(groupName, cols)} fileName={`เศษต่อ${groupName}_แยก${splitName}_${from}_${to}`} sheetName="เศษ" />
            </div>
            <AggTable data={byPeriod} first={groupName} cs={cols} sum={total} />
          </div>

          <div className="bg-white rounded-xl shadow-sm">
            <div className="flex items-center justify-between p-3">
              <p className="font-semibold text-gray-700">แยกตามเครื่อง</p>
              <ExportButton rows={byMachine} cols={aggCols('เครื่อง', typeCols)} fileName={`เศษตามเครื่อง_${from}_${to}`} sheetName="เครื่อง" />
            </div>
            {byMachine.length ? <AggTable data={byMachine} first="เครื่อง" cs={typeCols} sum={typeTotal} /> : <p className="p-6 text-center text-gray-400 text-sm">ไม่มีเศษในช่วงนี้</p>}
          </div>

          <div className="bg-white rounded-xl shadow-sm">
            <div className="flex items-center justify-between p-3">
              <p className="font-semibold text-gray-700">แยกตามกะ</p>
              <ExportButton rows={byShift} cols={aggCols('กะ', typeCols)} fileName={`เศษตามกะ_${from}_${to}`} sheetName="กะ" />
            </div>
            <AggTable data={byShift} first="กะ" cs={typeCols} sum={typeTotal} />
          </div>

          <div className="bg-white rounded-xl shadow-sm">
            <div className="flex items-center justify-between p-3">
              <p className="font-semibold text-gray-700">รายการชั่งเศษ</p>
              <ExportButton rows={scoped} fileName={`รายการเศษ_${from}_${to}`} sheetName="รายการ" cols={[
                { header: 'เวลา', value: (r: Row) => new Date(r.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) },
                { header: 'กะ', value: (r: Row) => shiftLabel(shiftOf(r.created_at)) },
                { header: 'แผนก', value: (r: Row) => (r.section ?? 'blow') === 'rewind' ? 'กรอ' : 'ผลิต' },
                { header: 'เครื่อง', value: 'machine_no' },
                { header: 'ประเภท', value: (r: Row) => typeLabel(r.roll_type) },
                { header: 'น้ำหนัก (kg)', value: 'weight' },
                { header: 'Lot', value: 'lot_no' },
                { header: 'WO', value: 'work_order' },
                { header: 'หมายเหตุ', value: 'remark' },
              ]} />
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm text-gray-800">
                <thead className="bg-gray-50 text-gray-500 text-xs sticky top-0">
                  <tr>{['เวลา', 'กะ', 'แผนก', 'เครื่อง', 'ประเภท', 'น้ำหนัก (kg)', 'Lot', 'WO', 'หมายเหตุ'].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {scoped.map(r => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 whitespace-nowrap">{new Date(r.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{shiftOf(r.created_at) === 'day' ? 'เช้า' : 'ดึก'}</td>
                      <td className="px-3 py-1.5">{(r.section ?? 'blow') === 'rewind' ? 'กรอ' : 'ผลิต'}</td>
                      <td className="px-3 py-1.5">{r.machine_no}</td>
                      <td className="px-3 py-1.5">{typeLabel(r.roll_type)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold">{num(Number(r.weight))}</td>
                      <td className="px-3 py-1.5">{r.lot_no ?? ''}</td>
                      <td className="px-3 py-1.5">{r.work_order ?? ''}</td>
                      <td className="px-3 py-1.5 text-gray-500">{r.remark ?? ''}</td>
                    </tr>
                  ))}
                  {!scoped.length && <tr><td colSpan={9} className="p-6 text-center text-gray-400">ไม่มีเศษในช่วงนี้</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
