// ════════════════════════════════════════════════════════════════════════
//  Owner / Executive Dashboard — โมดูลแยก (อ่านอย่างเดียว · READ-ONLY)
//  เปิดผ่าน  ?owner=1  หรือ  /owner
//  ⚠ โมดูลนี้ "ไม่แก้ไขข้อมูลใด ๆ" — ทำเฉพาะ SELECT จาก Supabase เท่านั้น
//  ทุก KPI / แท่งกราฟ / แถวตาราง "คลิกได้" → เด้งรายละเอียดม้วนที่ประกอบเป็นยอดนั้น
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAll } from '../lib/supabase'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

// ── ชนิดข้อมูลม้วน (เฉพาะคอลัมน์ที่ใช้) ──────────────────────────────
type Roll = {
  id: string; roll_no: number; roll_type: string; weight: number | null
  gross_weight: number | null; core_weight: number | null
  section: string | null; machine_no: string | null
  customer: string | null; cust_code: string | null
  product_name: string | null; item_code: string | null
  work_order: string | null; sale_order: string | null; lot_no: string | null
  created_at: string; inspector: string | null
  new_system: boolean | null; transferred: boolean | null
  // ⚠️ length/pcs เป็น text ในฐานข้อมูล ไม่ใช่ number — ต้องแปลงก่อนบวกเสมอ (ใช้ num())
  length: string | number | null; pcs: string | number | null
}
type Doc = {
  id: string; doc_no: string; transferred_at: string; transferred_by: string | null
  total_kg: number | null; total_rolls: number | null; customer: string | null
  product_name: string | null; machine_no: string | null; transfer_type: string | null
  work_order: string | null; lot_no: string | null
}

// ── helper ────────────────────────────────────────────────────────────
const TZ = 'Asia/Bangkok'
// ม้วนแรกในระบบชั่งใหม่คือ 1 มิ.ย. 2026 — ก่อนหน้านั้นข้อมูลอยู่ในระบบเก่าเท่านั้น
const DATA_START_LABEL = '1 มิ.ย. 2026'
const nf = (n: number, d = 0) =>
  (n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
const isGood  = (r: Roll) => r.roll_type === 'good'
const isWaste = (r: Roll) => r.roll_type !== 'good'   // bad / scrap_clear / scrap*
const wkg = (r: Roll) => r.weight ?? 0
// คอลัมน์ text ที่เก็บตัวเลข — บวกตรงๆ จะได้สตริงต่อกัน ("1080"+"1400"="10801400")
const num = (v: string | number | null | undefined) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return isFinite(n) ? n : 0
}

// คีย์วัน/เดือน เวลาไทย
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }) // YYYY-MM-DD
const monKey = (iso: string) => dayKey(iso).slice(0, 7) // YYYY-MM
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const SECTIONS: Record<string, { label: string; color: string }> = {
  blow:   { label: 'ผลิต(เป่า)',  color: '#3b82f6' },
  print:  { label: 'ผลิต(พิมพ์)', color: '#a855f7' },
  rewind: { label: 'กรอ(Rework)', color: '#22c55e' },
}
const secOf = (r: Roll) => (r.section ?? 'blow')
const secLabel = (s: string) => SECTIONS[s]?.label ?? s
const PIE = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#8b5cf6']

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'year' | 'all'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'วันนี้' }, { key: '7d', label: '7 วัน' }, { key: '30d', label: '30 วัน' },
  { key: 'month', label: 'เดือนนี้' }, { key: 'year', label: 'ปีนี้' }, { key: 'all', label: 'ทั้งหมด' },
]
function rangeStartISO(k: RangeKey): string | null {
  const now = new Date()
  const d = new Date(now)
  if (k === 'all') return null
  // setHours(0,0,0,0) = เที่ยงคืนตามเวลาเครื่อง ซึ่งเป็นเวลาไทยอยู่แล้ว
  // เดิมลบ 7 ชม. ซ้ำอีก ทำให้ "วันนี้" ลากข้อมูลตั้งแต่ 5 โมงเย็นของเมื่อวานมาด้วย
  if (k === 'today') { d.setHours(0, 0, 0, 0); return d.toISOString() }
  if (k === '7d')  { d.setDate(d.getDate() - 7); return d.toISOString() }
  if (k === '30d') { d.setDate(d.getDate() - 30); return d.toISOString() }
  if (k === 'month') { return new Date(now.getFullYear(), now.getMonth(), 1).toISOString() }
  if (k === 'year')  { return new Date(now.getFullYear(), 0, 1).toISOString() }
  return null
}

export default function OwnerDashboard() {
  const [rolls, setRolls] = useState<Roll[]>([])
  const [docs, setDocs]   = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeKey>('30d')
  const [sec, setSec]     = useState<'all' | 'blow' | 'print' | 'rewind'>('all')
  const [drill, setDrill] = useState<{ title: string; rolls: Roll[] } | null>(null)
  const [docDrill, setDocDrill] = useState<{ title: string; docs: Doc[] } | null>(null)
  const [updated, setUpdated] = useState<Date | null>(null)

  async function load() {
    setLoading(true)
    const since = rangeStartISO(range)
    const cols = 'id,roll_no,roll_type,weight,gross_weight,core_weight,section,machine_no,customer,cust_code,product_name,item_code,work_order,sale_order,lot_no,created_at,inspector,new_system,transferred,length,pcs'
    const rs = await fetchAll<Roll>(() => {
      let q = supabase.from('production_rolls').select(cols).order('created_at', { ascending: false })
      if (since) q = q.gte('created_at', since)
      return q
    })
    const ds = await fetchAll<Doc>(() => {
      let q = supabase.from('transfer_documents')
        .select('id,doc_no,transferred_at,transferred_by,total_kg,total_rolls,customer,product_name,machine_no,transfer_type,work_order,lot_no')
        .order('transferred_at', { ascending: false })
      if (since) q = q.gte('transferred_at', since)
      return q
    })
    setRolls(rs); setDocs(ds); setUpdated(new Date()); setLoading(false)
  }
  useEffect(() => { load() }, [range]) // eslint-disable-line react-hooks/exhaustive-deps

  // กรองตามแผนก (client-side)
  const R = useMemo(() => sec === 'all' ? rolls : rolls.filter(r => secOf(r) === sec), [rolls, sec])

  // ── KPI ───────────────────────────────────────────────────────────────
  const k = useMemo(() => {
    const good = R.filter(isGood), waste = R.filter(isWaste)
    const goodKg = good.reduce((s, r) => s + wkg(r), 0)
    const wasteKg = waste.reduce((s, r) => s + wkg(r), 0)
    const total = goodKg + wasteKg
    const lenM = good.reduce((s, r) => s + num(r.length), 0)
    const pcs  = good.reduce((s, r) => s + num(r.pcs), 0)
    // แยก "เศษทิ้งจริง" (scrap_*) ออกจาก "ม้วนส่งกรอ" (bad) ซึ่งกู้กลับเป็น FG ได้
    const scrapKg = R.filter(r => String(r.roll_type).startsWith('scrap')).reduce((s, r) => s + wkg(r), 0)
    const badKg   = R.filter(r => r.roll_type === 'bad').reduce((s, r) => s + wkg(r), 0)
    return {
      good, waste, goodKg, wasteKg, total, scrapKg, badKg,
      yieldPct: total > 0 ? (goodKg / total) * 100 : 0,
      wastePct: total > 0 ? (wasteKg / total) * 100 : 0,
      lenM, pcs,
      customers: new Set(R.map(r => r.customer || r.cust_code).filter(Boolean)).size,
      wos: new Set(R.map(r => r.work_order).filter(Boolean)).size,
      items: new Set(R.map(r => r.item_code).filter(Boolean)).size,
      shipKg: docs.reduce((s, d) => s + (d.total_kg ?? 0), 0),
    }
  }, [R, docs])

  // ── trend รายวัน/เดือน ──────────────────────────────────────────────
  const useMonthly = range === 'year' || range === 'all'
  const trend = useMemo(() => {
    const m = new Map<string, { good: number; waste: number }>()
    for (const r of R) {
      const key = useMonthly ? monKey(r.created_at) : dayKey(r.created_at)
      const e = m.get(key) ?? { good: 0, waste: 0 }
      if (isGood(r)) e.good += wkg(r); else e.waste += wkg(r)
      m.set(key, e)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, v]) => ({ d, label: useMonthly ? d : d.slice(5), good: +v.good.toFixed(1), waste: +v.waste.toFixed(1) }))
  }, [R, useMonthly])

  // ── แยกตามแผนก ──────────────────────────────────────────────────────
  const bySection = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of R.filter(isGood)) m.set(secOf(r), (m.get(secOf(r)) ?? 0) + wkg(r))
    return [...m.entries()].map(([s, kg]) => ({ s, name: secLabel(s), kg: +kg.toFixed(1) })).sort((a, b) => b.kg - a.kg)
  }, [R])

  // ── Top ลูกค้า / สินค้า / เครื่อง / ผู้ชั่ง ────────────────────────────
  const topBy = (keyFn: (r: Roll) => string | null, n = 10) => {
    const m = new Map<string, { kg: number; rolls: number }>()
    for (const r of R.filter(isGood)) {
      const key = keyFn(r) || '(ไม่ระบุ)'
      const e = m.get(key) ?? { kg: 0, rolls: 0 }; e.kg += wkg(r); e.rolls++; m.set(key, e)
    }
    return [...m.entries()].map(([name, v]) => ({ name, kg: +v.kg.toFixed(1), rolls: v.rolls }))
      .sort((a, b) => b.kg - a.kg).slice(0, n)
  }
  const topCust = useMemo(() => topBy(r => r.customer), [R])
  const topProd = useMemo(() => topBy(r => r.product_name), [R])

  const byMachine = useMemo(() => {
    const m = new Map<string, { good: number; waste: number; rolls: number }>()
    for (const r of R) {
      const key = r.machine_no || '(ไม่ระบุ)'
      const e = m.get(key) ?? { good: 0, waste: 0, rolls: 0 }
      if (isGood(r)) { e.good += wkg(r); e.rolls++ } else e.waste += wkg(r)
      m.set(key, e)
    }
    return [...m.entries()].map(([machine, v]) => {
      const tot = v.good + v.waste
      return { machine, good: +v.good.toFixed(1), waste: +v.waste.toFixed(1), rolls: v.rolls,
        yield: tot > 0 ? Math.round(v.good / tot * 100) : 0 }
    }).sort((a, b) => b.good - a.good)
  }, [R])

  const byInspector = useMemo(() => {
    const m = new Map<string, { kg: number; rolls: number }>()
    for (const r of R.filter(isGood)) {
      const key = r.inspector || '(ไม่ระบุ)'
      const e = m.get(key) ?? { kg: 0, rolls: 0 }; e.kg += wkg(r); e.rolls++; m.set(key, e)
    }
    return [...m.entries()].map(([name, v]) => ({ name, kg: +v.kg.toFixed(1), rolls: v.rolls }))
      .sort((a, b) => b.rolls - a.rolls)
  }, [R])

  // ── ตัวช่วยเปิด drill ──────────────────────────────────────────────
  const open = (title: string, subset: Roll[]) => setDrill({ title, rolls: subset })

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-200">
      {/* ── Header / Filters ── */}
      <div className="sticky top-0 z-30 bg-[#0a0f1e]/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📊</span>
            <div>
              <h1 className="text-white font-black text-lg leading-tight">แดชบอร์ดผู้บริหาร</h1>
              <p className="text-slate-500 text-[11px]">ภาพรวมทั้งบริษัท · อ่านอย่างเดียว · คลิกตัวเลข/กราฟเพื่อดูรายละเอียด</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* แผนก */}
            <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800">
              {(['all', 'blow', 'print', 'rewind'] as const).map(s => (
                <button key={s} onClick={() => setSec(s)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors ${sec === s ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                  {s === 'all' ? 'ทุกแผนก' : secLabel(s)}
                </button>
              ))}
            </div>
            {/* ช่วงเวลา */}
            <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800">
              {RANGES.map(r => (
                <button key={r.key} onClick={() => setRange(r.key)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors ${range === r.key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                  {r.label}
                </button>
              ))}
            </div>
            <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700">⟳ รีเฟรช</button>
          </div>
        </div>
        {updated && <p className="text-slate-600 text-[10px] mt-1">อัปเดตล่าสุด {updated.toLocaleString('th-TH', { timeZone: TZ })} · {nf(R.length)} ม้วนในช่วงที่เลือก</p>}
        {/* หน้านี้อ่านเฉพาะระบบชั่งใหม่ ข้อมูลก่อนหน้านั้นอยู่ในระบบเก่า (ดูที่ /combined) */}
        {(range === 'year' || range === 'all') && rolls.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            ℹ️ หน้านี้นับเฉพาะข้อมูลจาก<b>ระบบชั่งใหม่</b> ซึ่งเริ่มบันทึก {DATA_START_LABEL} เป็นต้นไป —
            ไม่ใช่ยอดทั้งปี · ยอดรวมทั้งปี (เก่า + ใหม่) ดูที่หน้า <b>รวมเทียบทั้งปี</b>
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 text-slate-500">
          <div className="w-10 h-10 border-4 border-brand-500/30 border-t-brand-500 rounded-full animate-spin mb-3" />
          กำลังโหลดข้อมูลทั้งหมด...
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* ── KPI cards (คลิกได้) ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard label="ผลิตดี (FG)" value={`${nf(k.goodKg, 0)}`} unit="kg" sub={`${nf(k.good.length)} ม้วน`} color="text-green-400" emoji="✅"
              onClick={() => open(`ม้วนดีทั้งหมด (${nf(k.good.length)} ม้วน)`, k.good)} />
            <KpiCard label="เศษทิ้ง + ส่งกรอ" value={`${nf(k.wasteKg, 0)}`} unit="kg"
              sub={`เศษทิ้ง ${nf(k.scrapKg, 0)} · ส่งกรอ ${nf(k.badKg, 0)}`} color="text-red-400" emoji="⚠️"
              onClick={() => open(`เศษทิ้ง + ส่งกรอ (${nf(k.waste.length)} ม้วน)`, k.waste)} />
            <KpiCard label="Yield เฉลี่ย" value={`${nf(k.yieldPct, 1)}`} unit="%" sub={`ดี/ผลิตรวม`} color="text-brand-300" emoji="🎯"
              onClick={() => open(`ม้วนทั้งหมด (${nf(R.length)} ม้วน)`, R)} />
            {/* pcs ยังไม่มีการบันทึกจริง — โชว์ "0 ชิ้น" จะอ่านเป็นผลิตได้ 0 ชิ้น */}
            <KpiCard label="ความยาวรวม" value={`${nf(k.lenM, 0)}`} unit="m" sub={k.pcs > 0 ? `${nf(k.pcs)} ชิ้น` : 'ยังไม่บันทึกจำนวนชิ้น'} color="text-cyan-300" emoji="📏"
              onClick={() => open(`ม้วนดี (ความยาว/ชิ้น)`, k.good)} />
            <KpiCard label="โอนเข้าคลัง" value={`${nf(k.shipKg, 0)}`} unit="kg" sub={`${nf(docs.length)} ใบโอน`} color="text-amber-300" emoji="📦"
              onClick={() => setDocDrill({ title: `ใบโอนเข้าคลัง (${nf(docs.length)} ใบ)`, docs })} />
            <KpiCard label="ลูกค้า / WO / สินค้า" value={`${nf(k.customers)}`} unit="ราย" sub={`${nf(k.wos)} WO · ${nf(k.items)} สินค้า`} color="text-purple-300" emoji="🧾"
              onClick={() => open(`ม้วนทั้งหมด (${nf(R.length)} ม้วน)`, R)} />
          </div>

          {/* ── Trend ── */}
          <Panel title={`แนวโน้มการผลิต (${useMonthly ? 'รายเดือน' : 'รายวัน'}) — คลิกแท่งเพื่อดูม้วนของวันนั้น`}>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trend} onClick={(e: any) => {
                const key = e?.activePayload?.[0]?.payload?.d
                if (!key) return
                const subset = R.filter(r => (useMonthly ? monKey(r.created_at) : dayKey(r.created_at)) === key)
                open(`ผลิตวันที่ ${key} (${nf(subset.length)} ม้วน)`, subset)
              }}>
                <defs>
                  <linearGradient id="gGood" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.5} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gWaste" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} /><stop offset="100%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => `${nf(v, 1)} kg`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="good" name="ผลิตดี" stroke="#22c55e" fill="url(#gGood)" strokeWidth={2} />
                <Area type="monotone" dataKey="waste" name="ของเสีย" stroke="#ef4444" fill="url(#gWaste)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ── แยกตามแผนก ── */}
            <Panel title="ผลิตดีแยกตามแผนก — คลิกเพื่อดูม้วน">
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={220}>
                  <PieChart>
                    <Pie data={bySection} dataKey="kg" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45}
                      onClick={(e: any) => { const s = e?.s; if (s) open(`${secLabel(s)} (ดี)`, R.filter(rr => isGood(rr) && secOf(rr) === s)) }}>
                      {bySection.map((e, i) => <Cell key={i} fill={SECTIONS[e.s]?.color ?? PIE[i % PIE.length]} cursor="pointer" />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => `${nf(v, 1)} kg`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {bySection.map((e, i) => (
                    <button key={e.s} onClick={() => open(`${e.name} (ดี)`, R.filter(rr => isGood(rr) && secOf(rr) === e.s))}
                      className="w-full flex items-center gap-2 text-sm hover:bg-slate-800 rounded-lg px-2 py-1.5 transition-colors">
                      <span className="w-3 h-3 rounded-sm" style={{ background: SECTIONS[e.s]?.color ?? PIE[i] }} />
                      <span className="text-slate-300 flex-1 text-left">{e.name}</span>
                      <span className="text-white font-bold">{nf(e.kg, 0)} kg</span>
                      <span className="text-slate-500 text-xs">{k.goodKg > 0 ? nf(e.kg / k.goodKg * 100, 0) : 0}%</span>
                    </button>
                  ))}
                </div>
              </div>
            </Panel>

            {/* ── Top ลูกค้า ── */}
            <Panel title="Top 10 ลูกค้า (ผลิตดี) — คลิกแท่ง">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topCust} layout="vertical" margin={{ left: 20 }}
                  onClick={(e: any) => { const name = e?.activePayload?.[0]?.payload?.name; if (name) open(`ลูกค้า: ${name}`, R.filter(r => isGood(r) && (r.customer || '(ไม่ระบุ)') === name)) }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" fontSize={10} />
                  <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={10} width={110} tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + '…' : v} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => `${nf(v, 0)} kg`} />
                  <Bar dataKey="kg" radius={[0, 4, 4, 0]} cursor="pointer">
                    {topCust.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ── Top สินค้า ── */}
            <Panel title="Top 10 สินค้า (ผลิตดี) — คลิกแท่ง">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topProd} layout="vertical" margin={{ left: 20 }}
                  onClick={(e: any) => { const name = e?.activePayload?.[0]?.payload?.name; if (name) open(`สินค้า: ${name}`, R.filter(r => isGood(r) && (r.product_name || '(ไม่ระบุ)') === name)) }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" fontSize={10} />
                  <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={10} width={110} tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + '…' : v} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => `${nf(v, 0)} kg`} />
                  <Bar dataKey="kg" radius={[0, 4, 4, 0]} cursor="pointer">
                    {topProd.map((_, i) => <Cell key={i} fill={PIE[(i + 3) % PIE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            {/* ── ผู้ชั่ง ── */}
            <Panel title="ผลงานผู้ชั่ง — คลิกแถวเพื่อดูม้วน">
              <div className="max-h-[240px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900 text-slate-500 text-xs">
                    <tr><th className="text-left px-2 py-1.5">ผู้ชั่ง</th><th className="text-right px-2">ม้วน</th><th className="text-right px-2">ผลิตดี (kg)</th></tr>
                  </thead>
                  <tbody>
                    {byInspector.map(e => (
                      <tr key={e.name} onClick={() => open(`ผู้ชั่ง: ${e.name}`, R.filter(r => isGood(r) && (r.inspector || '(ไม่ระบุ)') === e.name))}
                        className="border-t border-slate-800 hover:bg-slate-800/50 cursor-pointer">
                        <td className="px-2 py-1.5 text-slate-200">{e.name}</td>
                        <td className="px-2 text-right text-slate-300">{nf(e.rolls)}</td>
                        <td className="px-2 text-right text-green-400 font-bold">{nf(e.kg, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          {/* ── ผลงานรายเครื่อง ── */}
          <Panel title="ผลงานรายเครื่อง — คลิกแถวเพื่อดูม้วน">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">เครื่อง</th>
                    <th className="text-right px-3">ม้วนดี</th>
                    <th className="text-right px-3">ผลิตดี (kg)</th>
                    <th className="text-right px-3">ของเสีย (kg)</th>
                    <th className="text-right px-3">Yield</th>
                    <th className="px-3 w-40">สัดส่วน</th>
                  </tr>
                </thead>
                <tbody>
                  {byMachine.map(m => (
                    <tr key={m.machine} onClick={() => open(`เครื่อง ${m.machine}`, R.filter(r => (r.machine_no || '(ไม่ระบุ)') === m.machine))}
                      className="border-t border-slate-800 hover:bg-slate-800/50 cursor-pointer">
                      <td className="px-3 py-2"><span className="font-bold text-brand-300">{m.machine}</span></td>
                      <td className="px-3 text-right text-slate-300">{nf(m.rolls)}</td>
                      <td className="px-3 text-right text-green-400 font-bold">{nf(m.good, 0)}</td>
                      <td className="px-3 text-right text-red-400">{nf(m.waste, 0)}</td>
                      <td className="px-3 text-right font-bold" style={{ color: m.yield >= 95 ? '#22c55e' : m.yield >= 85 ? '#f59e0b' : '#ef4444' }}>{m.yield}%</td>
                      <td className="px-3">
                        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400" style={{ width: `${m.yield}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── ใบโอนล่าสุด ── */}
          <Panel title="ใบโอนเข้าคลังล่าสุด — คลิกเพื่อดูรายละเอียด">
            <div className="max-h-[320px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900 text-slate-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">วันที่</th><th className="text-left px-3">เลขใบ</th>
                    <th className="text-left px-3">ลูกค้า</th><th className="text-left px-3">สินค้า</th>
                    <th className="text-right px-3">ม้วน</th><th className="text-right px-3">น้ำหนัก</th><th className="text-left px-3">โดย</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.slice(0, 100).map(d => (
                    <tr key={d.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                      <td className="px-3 py-2 text-slate-400 text-xs">{fmtDay(d.transferred_at)}</td>
                      <td className="px-3 font-mono text-brand-300 text-xs">{d.doc_no}</td>
                      <td className="px-3 text-slate-200">{d.customer || '—'}</td>
                      <td className="px-3 text-slate-400 text-xs max-w-[200px] truncate">{d.product_name || '—'}</td>
                      <td className="px-3 text-right text-slate-300">{nf(d.total_rolls ?? 0)}</td>
                      <td className="px-3 text-right text-green-400 font-bold">{nf(d.total_kg ?? 0, 1)}</td>
                      <td className="px-3 text-slate-400 text-xs">{d.transferred_by || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {drill && <DrillModal title={drill.title} rolls={drill.rolls} onClose={() => setDrill(null)} onSub={open} />}
      {docDrill && <DocModal title={docDrill.title} docs={docDrill.docs} onClose={() => setDocDrill(null)} />}
    </div>
  )
}

// ── KPI card ──────────────────────────────────────────────────────────
function KpiCard({ label, value, unit, sub, color, emoji, onClick }:
  { label: string; value: string; unit: string; sub: string; color: string; emoji: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="text-left bg-slate-900 border border-slate-800 hover:border-brand-500/60 rounded-2xl p-4 transition-all hover:shadow-lg hover:shadow-brand-500/10 group">
      <div className="flex items-center justify-between">
        <span className="text-slate-500 text-xs font-semibold">{label}</span>
        <span className="text-lg opacity-70 group-hover:scale-110 transition-transform">{emoji}</span>
      </div>
      <p className={`mt-1.5 font-black text-2xl ${color}`}>{value}<span className="text-sm font-bold ml-1 opacity-70">{unit}</span></p>
      <p className="text-slate-500 text-[11px] mt-0.5">{sub}</p>
      <p className="text-brand-400/0 group-hover:text-brand-400/80 text-[10px] mt-1 transition-colors">คลิกดูรายละเอียด →</p>
    </button>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <h3 className="text-slate-300 font-bold text-sm mb-3">{title}</h3>
      {children}
    </div>
  )
}

// ── Drill modal: รายการม้วนจริง + สรุป + จัดกลุ่มย่อย ──────────────────
function DrillModal({ title, rolls, onClose, onSub }:
  { title: string; rolls: Roll[]; onClose: () => void; onSub: (t: string, r: Roll[]) => void }) {
  const [tab, setTab] = useState<'list' | 'wo' | 'cust'>('list')
  const good = rolls.filter(isGood), waste = rolls.filter(isWaste)
  const goodKg = good.reduce((s, r) => s + wkg(r), 0), wasteKg = waste.reduce((s, r) => s + wkg(r), 0)
  const tot = goodKg + wasteKg

  const groupBy = (fn: (r: Roll) => string | null) => {
    const m = new Map<string, { kg: number; rolls: Roll[] }>()
    for (const r of rolls) { const key = fn(r) || '(ไม่ระบุ)'; const e = m.get(key) ?? { kg: 0, rolls: [] }; e.kg += wkg(r); e.rolls.push(r); m.set(key, e) }
    return [...m.entries()].map(([name, v]) => ({ name, kg: +v.kg.toFixed(1), rolls: v.rolls })).sort((a, b) => b.kg - a.kg)
  }
  const byWo = useMemo(() => groupBy(r => r.work_order), [rolls])
  const byCust = useMemo(() => groupBy(r => r.customer), [rolls])

  const exportCsv = () => {
    const head = ['วันที่', 'แผนก', 'เครื่อง', 'Lot', 'WO', 'SO', 'ลูกค้า', 'สินค้า', 'item', 'ม้วน', 'ชนิด', 'นน.สุทธิ', 'นน.เต็ม', 'ผู้ชั่ง']
    const lines = rolls.map(r => [fmtDay(r.created_at), secLabel(secOf(r)), r.machine_no, r.lot_no, r.work_order, r.sale_order,
      r.customer, r.product_name, r.item_code, r.roll_no, r.roll_type, r.weight, r.gross_weight, r.inspector]
      .map(x => `"${(x ?? '').toString().replace(/"/g, '""')}"`).join(','))
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `รายละเอียด_${title.replace(/[^\wก-๙]+/g, '_')}.csv`; a.click()
  }

  return (
    <div className="fixed inset-0 bg-black/75 z-[80] flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold truncate">{title}</p>
            <p className="text-slate-500 text-xs">{nf(rolls.length)} ม้วน · ดี {nf(goodKg, 1)} kg · เสีย {nf(wasteKg, 1)} kg · Yield {tot > 0 ? nf(goodKg / tot * 100, 1) : 0}%</p>
          </div>
          <button onClick={exportCsv} className="text-xs font-bold bg-green-600/20 text-green-300 border border-green-600/40 rounded-lg px-3 py-1.5 hover:bg-green-600/30">⬇ Excel/CSV</button>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* tabs */}
        <div className="flex gap-1 px-5 pt-3">
          {([['list', 'รายม้วน'], ['wo', `จัดกลุ่ม WO (${byWo.length})`], ['cust', `ลูกค้า (${byCust.length})`]] as const).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${tab === t ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>{l}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {tab === 'list' && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900 text-slate-500">
                <tr>
                  <th className="text-left px-2 py-1.5">วันที่</th><th className="text-left px-2">แผนก</th><th className="text-left px-2">เครื่อง</th>
                  <th className="text-left px-2">Lot</th><th className="text-left px-2">WO</th><th className="text-left px-2">ลูกค้า</th>
                  <th className="text-left px-2">สินค้า</th><th className="text-left px-2">ม้วน</th><th className="text-left px-2">ชนิด</th>
                  <th className="text-right px-2">นน.สุทธิ</th><th className="text-left px-2">ผู้ชั่ง</th>
                </tr>
              </thead>
              <tbody>
                {rolls.slice(0, 1500).map(r => (
                  <tr key={r.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{fmtDay(r.created_at)}</td>
                    <td className="px-2 text-slate-400">{secLabel(secOf(r))}</td>
                    <td className="px-2 text-brand-300 font-bold">{r.machine_no || '—'}</td>
                    <td className="px-2 text-slate-500">{r.lot_no || '—'}</td>
                    <td className="px-2 text-amber-300">{r.work_order || '—'}</td>
                    <td className="px-2 text-slate-300 max-w-[140px] truncate">{r.customer || '—'}</td>
                    <td className="px-2 text-slate-400 max-w-[160px] truncate">{r.product_name || '—'}</td>
                    <td className="px-2 text-white font-mono">{String(r.roll_type).startsWith('scrap') ? 'เศษ' : `#${r.roll_no}`}</td>
                    <td className="px-2">{isGood(r) ? <span className="text-green-400">ดี</span> : <span className="text-red-400">เสีย</span>}</td>
                    <td className="px-2 text-right font-bold text-slate-100">{nf(r.weight ?? 0, 2)}</td>
                    <td className="px-2 text-slate-400">{r.inspector || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rolls.length > 1500 && tab === 'list' && <p className="text-center text-slate-500 text-xs py-3">แสดง 1,500 ม้วนแรก · กด Excel/CSV เพื่อดูครบ {nf(rolls.length)} ม้วน</p>}

          {(tab === 'wo' || tab === 'cust') && (
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-xs"><tr><th className="text-left px-3 py-2">{tab === 'wo' ? 'WO' : 'ลูกค้า'}</th><th className="text-right px-3">ม้วน</th><th className="text-right px-3">น้ำหนัก (kg)</th><th className="px-3"></th></tr></thead>
              <tbody>
                {(tab === 'wo' ? byWo : byCust).map(g => (
                  <tr key={g.name} className="border-t border-slate-800 hover:bg-slate-800/40 cursor-pointer" onClick={() => onSub(`${tab === 'wo' ? 'WO' : 'ลูกค้า'}: ${g.name}`, g.rolls)}>
                    <td className="px-3 py-2 text-slate-200">{g.name}</td>
                    <td className="px-3 text-right text-slate-300">{nf(g.rolls.length)}</td>
                    <td className="px-3 text-right text-green-400 font-bold">{nf(g.kg, 1)}</td>
                    <td className="px-3 text-right text-brand-400 text-xs">ดูม้วน →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Doc modal: ใบโอน ──────────────────────────────────────────────────
function DocModal({ title, docs, onClose }: { title: string; docs: Doc[]; onClose: () => void }) {
  const totKg = docs.reduce((s, d) => s + (d.total_kg ?? 0), 0)
  return (
    <div className="fixed inset-0 bg-black/75 z-[80] flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center gap-3">
          <div className="flex-1"><p className="text-white font-bold">{title}</p><p className="text-slate-500 text-xs">{nf(docs.length)} ใบ · รวม {nf(totKg, 1)} kg</p></div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-900 text-slate-500">
              <tr><th className="text-left px-2 py-1.5">วันที่</th><th className="text-left px-2">เลขใบ</th><th className="text-left px-2">ลูกค้า</th><th className="text-left px-2">สินค้า</th><th className="text-left px-2">WO</th><th className="text-right px-2">ม้วน</th><th className="text-right px-2">น้ำหนัก</th><th className="text-left px-2">โดย</th></tr>
            </thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                  <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{fmtDay(d.transferred_at)}</td>
                  <td className="px-2 font-mono text-brand-300">{d.doc_no}</td>
                  <td className="px-2 text-slate-200">{d.customer || '—'}</td>
                  <td className="px-2 text-slate-400 max-w-[180px] truncate">{d.product_name || '—'}</td>
                  <td className="px-2 text-amber-300">{d.work_order || '—'}</td>
                  <td className="px-2 text-right text-slate-300">{nf(d.total_rolls ?? 0)}</td>
                  <td className="px-2 text-right text-green-400 font-bold">{nf(d.total_kg ?? 0, 1)}</td>
                  <td className="px-2 text-slate-400">{d.transferred_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
