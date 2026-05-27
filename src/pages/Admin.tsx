import { useState, useEffect } from 'react'
import { Boxes, FileEdit, KeyRound, Lock, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Products from './Products'
import LabelDesigner from './LabelDesigner'

type Dept = 'blow' | 'print' | 'rewind'

const PIN_DEFAULTS = { admin_pin:'9999', pin_blow:'1111', pin_print:'2222', pin_rewind:'3333' } as const
const DEPT_KEYS    = { blow:'pin_blow', print:'pin_print', rewind:'pin_rewind' } as const
const DEPT_LABELS  = { blow:'ผลิต(เป่า)', print:'ผลิต(พิมพ์)', rewind:'กรอ(Rework)' } as const

// ─── ดึง/บันทึก PIN ─────────────────────────────────────────────────────────
export async function fetchPin(key: keyof typeof PIN_DEFAULTS): Promise<string> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
  return data?.value ?? PIN_DEFAULTS[key]
}
export async function setPin(key: keyof typeof PIN_DEFAULTS, value: string) {
  const { error } = await supabase.from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}
export const fetchAdminPin = () => fetchPin('admin_pin')
export const setAdminPin   = (v: string) => setPin('admin_pin', v)

// ─── Session unlock ─────────────────────────────────────────────────────────
const adminSess     = 'bwp_admin_unlocked'
const deptSess      = (d: Dept) => `bwp_dept_${d}_unlocked`

export function isAdminUnlocked() { return sessionStorage.getItem(adminSess) === '1' }
export function unlockAdmin()     {
  sessionStorage.setItem(adminSess, '1')
  // 🔑 Admin = master key — ปลดล็อกทุกแผนกอัตโนมัติ
  ;(['blow','print','rewind'] as const).forEach(d => sessionStorage.setItem(deptSess(d), '1'))
}
export function lockAdmin()       { sessionStorage.removeItem(adminSess) }

// Dept unlock: ถ้า admin ปลดแล้วถือว่า dept ปลดด้วย
export function isDeptUnlocked(d: Dept) {
  return sessionStorage.getItem(deptSess(d)) === '1' || isAdminUnlocked()
}
export function unlockDept(d: Dept)     { sessionStorage.setItem(deptSess(d), '1') }
export function lockDept(d: Dept)       { sessionStorage.removeItem(deptSess(d)) }
export function lockAllDepts() {
  (['blow','print','rewind'] as const).forEach(lockDept)
}

// ─── Generic PIN Gate ───────────────────────────────────────────────────────
function PinModal({ title, color, fetchReal, onSuccess, onClose }: {
  title: string
  color: 'amber' | 'blue'
  fetchReal: () => Promise<string>           // อาจคืน "p1|p2" — รับได้หลาย PIN
  onSuccess: (enteredPin?: string) => void
  onClose: () => void
}) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const colorClass = color === 'amber' ? 'text-amber-400' : 'text-brand-400'

  async function submit() {
    if (!pin.trim()) return
    setLoading(true)
    const real = await fetchReal()
    setLoading(false)
    // รองรับหลาย PIN (separated by |) — match ตัวใดตัวหนึ่งก็พอ
    const valid = real.split('|').map(s => s.trim()).filter(Boolean)
    if (valid.includes(pin)) onSuccess(pin)
    else { setErr('PIN ไม่ถูกต้อง'); setPin('') }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xs shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-2">
          <Lock size={16} className={colorClass}/>
          <p className="text-white font-bold">{title}</p>
        </div>
        <div className="px-5 py-5 space-y-3">
          <input
            type="password" inputMode="numeric" autoFocus maxLength={10}
            value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setErr('') }}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="••••"
            className="w-full bg-slate-800 border-2 border-slate-700 focus:border-brand-500 rounded-xl px-4 py-3 text-white text-center text-2xl font-bold tracking-widest outline-none"
          />
          {err && <p className="text-red-400 text-xs text-center">{err}</p>}
          <button onClick={submit} disabled={loading || !pin}
            className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-2.5 rounded-xl font-bold text-sm">
            {loading ? 'ตรวจสอบ...' : 'เข้าสู่ระบบ'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Admin PIN Gate ─────────────────────────────────────────────────────────
export function PinGate({ onUnlock, onClose }: { onUnlock: () => void; onClose: () => void }) {
  return (
    <PinModal
      title="ใส่ PIN เพื่อเข้า Admin"
      color="amber"
      fetchReal={fetchAdminPin}
      onSuccess={() => { unlockAdmin(); onUnlock() }}
      onClose={onClose}
    />
  )
}

// ─── Department PIN Gate ────────────────────────────────────────────────────
// รองรับ admin PIN ด้วย — ถ้าใส่ admin PIN จะปลดทุกแผนกพร้อมกัน
export function DeptPinGate({ dept, onUnlock, onClose }: {
  dept: Dept; onUnlock: () => void; onClose: () => void
}) {
  return (
    <PinModal
      title={`ใส่ PIN — ${DEPT_LABELS[dept]}`}
      color="blue"
      fetchReal={async () => {
        // คืน PIN ทั้งของแผนก และ admin (ใช้คั่นด้วย | เพื่อให้ PinModal match แบบ OR)
        const [deptPin, adminPin] = await Promise.all([fetchPin(DEPT_KEYS[dept]), fetchAdminPin()])
        return `${deptPin}|${adminPin}`
      }}
      onSuccess={(entered) => {
        // ถ้าใส่ admin PIN → ปลดทุกแผนก
        // ถ้าใส่ dept PIN → ปลดแค่แผนกนี้
        // (ไม่รู้จากที่นี่ว่าใส่ตัวไหน — แต่ unlockAdmin จะปลดทุก dept อยู่แล้ว → safe)
        fetchAdminPin().then(adminPin => {
          if (entered === adminPin) unlockAdmin()
          else unlockDept(dept)
          onUnlock()
        })
      }}
      onClose={onClose}
    />
  )
}

// ─── Main Admin Page ─────────────────────────────────────────────────────────
type Tab = 'products' | 'labels' | 'pin'

export default function Admin({ dept: _dept }: { dept?: 'blow'|'print'|'rewind' }) {
  const [tab, setTab] = useState<Tab>('products')

  return (
    <div className="flex flex-col h-full">
      {/* Admin nav */}
      <div className="flex items-center gap-1 px-4 py-2 bg-slate-900 border-b border-slate-800">
        <Lock size={14} className="text-amber-400 mr-2"/>
        <span className="text-amber-400 text-xs font-bold uppercase tracking-wider mr-3">Admin</span>
        <button onClick={() => setTab('products')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab==='products' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}>
          <Boxes size={13}/> คลัง Item Code
        </button>
        <button onClick={() => setTab('labels')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab==='labels' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}>
          <FileEdit size={13}/> ออกแบบใบปะหน้า
        </button>
        <button onClick={() => setTab('pin')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab==='pin' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}>
          <KeyRound size={13}/> เปลี่ยน PIN
        </button>
        <button onClick={() => { lockAdmin(); location.reload() }}
          className="ml-auto text-slate-500 hover:text-red-400 text-xs flex items-center gap-1">
          <Lock size={12}/> ล็อก
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === 'products' && <Products/>}
        {tab === 'labels'   && <LabelDesigner/>}
        {tab === 'pin'      && <PinManager/>}
      </div>
    </div>
  )
}

// ─── PIN Manager — จัดการ Admin + 3 แผนก ─────────────────────────────────────
function PinManager() {
  const [show, setShow] = useState(false)

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-white font-bold text-xl mb-1">🔑 จัดการ PIN</h1>
      <p className="text-slate-500 text-xs mb-4">เปลี่ยน PIN เก็บใน Supabase — ผลทุกเครื่องทันที</p>

      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none mb-3">
        <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)}
          className="accent-brand-500"/>
        {show ? <Eye size={12}/> : <EyeOff size={12}/>} แสดง PIN
      </label>

      <div className="space-y-3">
        <PinChangeCard pinKey="admin_pin" label="🔒 Admin PIN"           color="amber" show={show}/>
        <PinChangeCard pinKey="pin_blow"  label="🌬 ผลิต(เป่า) — PIN"   color="blue"  show={show}/>
        <PinChangeCard pinKey="pin_print" label="🖨 ผลิต(พิมพ์) — PIN" color="purple" show={show}/>
        <PinChangeCard pinKey="pin_rewind" label="🔁 กรอ(Rework) — PIN" color="green" show={show}/>
      </div>

      <div className="mt-4 text-xs text-slate-500 space-y-0.5">
        <p>💡 PIN เริ่มต้น: Admin <span className="font-mono text-amber-400">9999</span> · เป่า <span className="font-mono text-blue-400">1111</span> · พิมพ์ <span className="font-mono text-purple-400">2222</span> · กรอ <span className="font-mono text-green-400">3333</span></p>
        <p>💡 ผู้ใช้กรอก PIN ครั้งเดียวต่อ session (ปิด tab = ต้องใส่ใหม่)</p>
      </div>
    </div>
  )
}

function PinChangeCard({ pinKey, label, color, show }: {
  pinKey: 'admin_pin' | 'pin_blow' | 'pin_print' | 'pin_rewind'
  label: string
  color: 'amber' | 'blue' | 'purple' | 'green'
  show: boolean
}) {
  const [current,  setCurrent]  = useState('')
  const [newPin,   setNewPin]   = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [savedPin, setSavedPin] = useState('')
  const [msg,      setMsg]      = useState('')
  const [err,      setErr]      = useState('')
  const [saving,   setSaving]   = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => { fetchPin(pinKey).then(setSavedPin) }, [pinKey])

  const colorClasses = {
    amber:  'border-amber-500/30 bg-amber-500/5',
    blue:   'border-blue-500/30 bg-blue-500/5',
    purple: 'border-purple-500/30 bg-purple-500/5',
    green:  'border-green-500/30 bg-green-500/5',
  }[color]

  async function save() {
    setErr(''); setMsg('')
    if (current !== savedPin) { setErr('PIN ปัจจุบันไม่ถูกต้อง'); return }
    if (!newPin || newPin.length < 4) { setErr('PIN ใหม่ต้องอย่างน้อย 4 หลัก'); return }
    if (newPin !== confirm) { setErr('ยืนยัน PIN ไม่ตรงกัน'); return }
    setSaving(true)
    try {
      await setPin(pinKey, newPin)
      setSavedPin(newPin)
      setMsg('✓ บันทึกเรียบร้อย')
      setCurrent(''); setNewPin(''); setConfirm('')
      setTimeout(() => { setMsg(''); setExpanded(false) }, 1500)
    } catch (e: any) {
      setErr('บันทึกไม่สำเร็จ: ' + e.message)
    } finally { setSaving(false) }
  }

  return (
    <div className={`border rounded-xl ${colorClasses}`}>
      <button onClick={() => setExpanded(v => !v)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-sm">{label}</span>
          <span className="font-mono text-slate-500 text-sm">
            {show ? savedPin : '••••'}
          </span>
        </div>
        <span className="text-xs text-slate-400">{expanded ? '▲' : 'เปลี่ยน ▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t border-slate-700/50 pt-3">
          <PinField label="PIN ปัจจุบัน"    value={current} onChange={setCurrent} show={show}/>
          <PinField label="PIN ใหม่"         value={newPin}  onChange={setNewPin}  show={show}/>
          <PinField label="ยืนยัน PIN ใหม่"  value={confirm} onChange={setConfirm} show={show}/>
          {err && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded p-2">{err}</p>}
          {msg && <p className="text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded p-2">{msg}</p>}
          <button onClick={save} disabled={saving}
            className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-2 rounded-lg font-bold text-sm">
            {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      )}
    </div>
  )
}

function PinField({ label, value, onChange, show }: {
  label: string; value: string; onChange: (v: string) => void; show: boolean
}) {
  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-1">{label}</label>
      <input
        type={show ? 'text' : 'password'}
        inputMode="numeric"
        maxLength={10}
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-lg font-mono tracking-widest text-center outline-none focus:border-brand-500"
      />
    </div>
  )
}
