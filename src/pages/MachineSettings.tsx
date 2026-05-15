import { useState, useEffect } from 'react'
import { Plus, Trash2, Save, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'

// ── Full Machine Profile ──────────────────────────────────────────────────────
export interface MachineProfile {
  machine_no:  string
  // ลูกค้า
  custCode:    string
  custName:    string
  custAddress: string
  decimal:     1 | 2
  // สินค้า
  matCode:     string
  productCode: string
  productName: string
  widthCm:     string
  thickMc:     string
  lotNo:       string
  length:      string
  pcs:         string
  // เครื่อง
  coreWeight:  string
  inspector:   string
  // ล็อค
  locked:      boolean
  // ยอดสั่งผลิต
  plannedQty:  string
  // ใบปะหน้า
  labelSize:   'long' | 'short'
}

const EMPTY_PROFILE: MachineProfile = {
  machine_no:'', custCode:'', custName:'', custAddress:'', decimal:2,
  matCode:'', productCode:'', productName:'', widthCm:'', thickMc:'',
  lotNo:'', length:'', pcs:'', coreWeight:'1.25', inspector:'', locked:true,
  plannedQty:'', labelSize:'long',
}

// ── DB ↔ App type conversion ──────────────────────────────────────────────────
function dbToProfile(row: any): MachineProfile {
  return {
    machine_no:  row.machine_no,
    custCode:    row.cust_code    ?? '',
    custName:    row.cust_name    ?? '',
    custAddress: row.cust_address ?? '',
    decimal:     (row.decimal_places ?? 2) as 1|2,
    matCode:     row.mat_code     ?? '',
    productCode: row.product_code ?? '',
    productName: row.product_name ?? '',
    widthCm:     row.width_cm     ?? '',
    thickMc:     row.thick_mc     ?? '',
    lotNo:       row.lot_no       ?? '',
    length:      row.length       ?? '',
    pcs:         row.pcs          ?? '',
    coreWeight:  row.core_weight  ?? '1.25',
    inspector:   row.inspector    ?? '',
    locked:      row.locked       ?? true,
    plannedQty:  row.planned_qty  ?? '',
    labelSize:   (row.label_size  ?? 'long') as 'long'|'short',
  }
}
function profileToDb(p: MachineProfile) {
  return {
    machine_no:    p.machine_no,
    cust_code:     p.custCode,
    cust_name:     p.custName,
    cust_address:  p.custAddress,
    decimal_places: p.decimal,
    mat_code:      p.matCode,
    product_code:  p.productCode,
    product_name:  p.productName,
    width_cm:      p.widthCm,
    thick_mc:      p.thickMc,
    lot_no:        p.lotNo,
    length:        p.length,
    pcs:           p.pcs,
    core_weight:   p.coreWeight,
    inspector:     p.inspector,
    locked:        p.locked,
    planned_qty:   p.plannedQty,
    label_size:    p.labelSize,
    updated_at:    new Date().toISOString(),
  }
}

// ── เผื่อ fallback localStorage ───────────────────────────────────────────────
const STORAGE_KEY = 'bwp_machine_profiles'
export function loadProfiles(): MachineProfile[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}
export function saveProfiles(p: MachineProfile[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
}

// ─── Single Profile Card ──────────────────────────────────────────────────────
function ProfileCard({ p, i, onChange, onRemove }: {
  p: MachineProfile; i: number
  onChange: (k: keyof MachineProfile, v: any) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(!p.machine_no)

  const F = ({ label, k, ph, half }: { label: string; k: keyof MachineProfile; ph?: string; half?: boolean }) => (
    <div className={half ? '' : 'col-span-2'}>
      <label className="block text-[10px] text-slate-500 mb-1">{label}</label>
      <input value={p[k] as string} onChange={e => onChange(k, e.target.value)} placeholder={ph}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs outline-none focus:border-brand-500" />
    </div>
  )

  const ready = !!(p.machine_no && p.custName && p.productName && p.matCode && p.lotNo)

  return (
    <div className={`bg-slate-900 border rounded-2xl overflow-hidden transition-colors ${
      ready ? 'border-slate-700' : 'border-amber-500/30'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-800/40"
        onClick={() => setOpen(o => !o)}>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${
          ready ? 'bg-brand-600 text-white' : 'bg-amber-600/30 text-amber-300 border border-amber-500/30'
        }`}>
          {p.machine_no || '?'}
        </div>
        <div className="flex-1 min-w-0">
          {ready ? (
            <>
              <p className="text-white font-bold text-sm leading-tight truncate">{p.productName}</p>
              <p className="text-slate-400 text-xs truncate">{p.custName} · Lot {p.lotNo}</p>
            </>
          ) : (
            <p className="text-amber-400 text-sm">⚠️ ยังกรอกข้อมูลไม่ครบ</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {p.locked && <span className="text-[10px] bg-red-500/15 text-red-300 border border-red-500/25 px-1.5 py-0.5 rounded-full">ล็อค</span>}
          <span className="text-slate-500">{open ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</span>
        </div>
      </div>

      {/* Form */}
      {open && (
        <div className="px-4 pb-4 border-t border-slate-800 pt-3 space-y-3">
          {/* เครื่อง + ล็อค */}
          <div className="grid grid-cols-2 gap-2">
            <F label="หมายเลขเครื่อง *" k="machine_no" ph="B-01" half />
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ล็อคเครื่อง</label>
              <button onClick={() => onChange('locked', !p.locked)}
                className={`w-full py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  p.locked ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}>
                {p.locked ? '🔒 ล็อค (บล็อคถ้าผิด)' : '🔓 ไม่ล็อค (แค่เตือน)'}
              </button>
            </div>
          </div>

          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">ลูกค้า</p>
          <div className="grid grid-cols-2 gap-2">
            <F label="รหัสลูกค้า" k="custCode" ph="C-001" half />
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ทศนิยม</label>
              <div className="flex gap-1">
                {([1,2] as const).map(d => (
                  <button key={d} onClick={() => onChange('decimal', d)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${p.decimal===d ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    {d} ตำแหน่ง
                  </button>
                ))}
              </div>
            </div>
            <F label="ชื่อลูกค้า *" k="custName" ph="บริษัท ..." />
            <F label="ที่อยู่"       k="custAddress" ph="ที่อยู่..." />
          </div>

          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">สินค้า</p>
          <div className="grid grid-cols-2 gap-2">
            <F label="Mat Code *"    k="matCode"     ph="60004224"      half />
            <F label="Product Code"  k="productCode" ph="60004224"      half />
            <F label="ชื่อสินค้า *" k="productName" ph="PET 1.45L RED SHRINK" />
            <F label="กว้าง (cm)"   k="widthCm"     ph="57"            half />
            <F label="หนา (mc)"     k="thickMc"     ph="80"            half />
            <F label="Lot No *"     k="lotNo"       ph="69S0200010005" half />
            <F label="Length (Ms.)" k="length"      ph="1360"          half />
            <F label="Pcs."         k="pcs"         ph=""              half />
          </div>

          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">เครื่อง</p>
          <div className="grid grid-cols-2 gap-2">
            <F label="Core Weight (kg)"    k="coreWeight"  ph="1.25"  half />
            <F label="ผู้ตรวจสอบ"         k="inspector"   ph="เมทนี" half />
            <F label="ยอดสั่งผลิต (kg) *" k="plannedQty"  ph="5000"  half />
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ใบปะหน้า (พิมพ์อัตโนมัติ)</label>
              <div className="flex gap-1">
                {(['long','short'] as const).map(s => (
                  <button key={s} onClick={() => onChange('labelSize', s)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      p.labelSize === s ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}>
                    {s === 'long' ? '📄 ยาว 165×70' : '🏷 สั้น 76×76'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button onClick={onRemove}
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-red-400 transition-colors mt-1">
            <Trash2 size={12} /> ลบเครื่องนี้
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────
export default function MachineSettings() {
  const [profiles, setProfiles] = useState<MachineProfile[]>([])
  const [saved,    setSaved]    = useState(false)
  const [loading,  setLoading]  = useState(true)

  // โหลดจาก Supabase เมื่อเปิดหน้า
  useEffect(() => {
    supabase.from('machine_profiles').select('*').order('machine_no')
      .then(({ data }) => {
        if (data && data.length > 0) {
          const loaded = data.map(dbToProfile)
          setProfiles(loaded)
          saveProfiles(loaded) // sync localStorage
        } else {
          setProfiles(loadProfiles()) // fallback
        }
        setLoading(false)
      })
  }, [])

  function add() {
    setProfiles(p => [...p, { ...EMPTY_PROFILE }])
  }
  function remove(i: number) {
    if (!confirm('ลบเครื่องนี้?')) return
    const p = profiles[i]
    if (p.machine_no) supabase.from('machine_profiles').delete().eq('machine_no', p.machine_no)
    setProfiles(prev => prev.filter((_, idx) => idx !== i))
  }
  function update(i: number, k: keyof MachineProfile, v: any) {
    setProfiles(p => p.map((m, idx) => idx === i ? { ...m, [k]: v } : m))
  }
  async function handleSave() {
    const valid = profiles.filter(p => p.machine_no)
    for (const p of valid) {
      await supabase.from('machine_profiles')
        .upsert(profileToDb(p), { onConflict: 'machine_no' })
    }
    saveProfiles(profiles)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const ready = profiles.filter(p => p.machine_no && p.custName && p.productName && p.matCode && p.lotNo).length

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-lg">ตั้งค่า Profile เครื่อง</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            ตั้งค่าครั้งเดียว — พนักงานแค่แตะเครื่อง → ชั่งได้เลย
            <span className="ml-2 text-green-400 font-semibold">{ready}/{profiles.length} เครื่องพร้อม</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSave}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              saved ? 'bg-green-600 text-white' : 'bg-brand-600 hover:bg-brand-500 text-white'
            }`}>
            <Save size={14} /> {saved ? 'บันทึกแล้ว ✓' : 'บันทึกทั้งหมด'}
          </button>
        </div>
      </div>

      {profiles.map((p, i) => (
        <ProfileCard key={i} p={p} i={i}
          onChange={(k, v) => update(i, k, v)}
          onRemove={() => remove(i)} />
      ))}

      <button onClick={add}
        className="w-full border-2 border-dashed border-slate-700 hover:border-brand-500 text-slate-500 hover:text-brand-400 py-3 rounded-2xl text-sm flex items-center justify-center gap-2 transition-colors">
        <Plus size={16} /> เพิ่มเครื่อง
      </button>

      {loading && (
        <div className="text-center py-10 text-slate-500 flex items-center justify-center gap-2">
          <RefreshCw size={16} className="animate-spin" /> กำลังโหลดจาก Supabase...
        </div>
      )}

      {!loading && profiles.length === 0 && (
        <div className="text-center py-8 space-y-2">
          <p className="text-slate-500 text-sm">ยังไม่มีเครื่อง — กด "เพิ่มเครื่อง"</p>
          <p className="text-slate-600 text-xs">กรอกข้อมูลครบทุกเครื่องก่อน แล้วบันทึก<br/>พนักงานจะแตะเครื่องแล้วชั่งได้ทันที</p>
        </div>
      )}
    </div>
  )
}

