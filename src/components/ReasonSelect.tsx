import { useState, useEffect, useRef, useMemo } from 'react'
import { Settings, X, Trash2, Search, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'

type ReasonOption = { id: string; category: string; label: string; sort_order: number }

// cache ต่อ category — กันโหลดซ้ำเมื่อสลับโหมด
const cache: Record<string, ReasonOption[]> = {}
const listeners: Record<string, Set<(o: ReasonOption[]) => void>> = {}

function notify(category: string) {
  (listeners[category] ?? new Set()).forEach(fn => fn(cache[category] ?? []))
}

async function loadOptions(category: string) {
  const { data, error } = await supabase
    .from('reason_options')
    .select('id, category, label, sort_order')
    .eq('category', category)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) { console.error('load reason_options', error); return }
  cache[category] = data ?? []
  notify(category)
}

/**
 * ดรอปดาวเลือกเหตุผล + เพิ่มหัวข้อใหม่ได้ (เก็บลง Supabase, เห็นทุกเครื่อง)
 * ใช้เป็น controlled input: value / onChange เหมือน <input>
 */
export default function ReasonSelect({
  category, value, onChange, placeholder, accent = 'orange',
}: {
  category: 'bad' | 'scrap'
  value: string
  onChange: (v: string) => void
  placeholder?: string
  accent?: 'orange' | 'red' | 'amber'
}) {
  const [options, setOptions] = useState<ReasonOption[]>(cache[category] ?? [])
  const [managing, setManaging] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy]       = useState(false)
  // ค้นหาในดรอปดาว — พิมพ์ "หล" ก็เจอ "หลุดมีด" (รายการยาว เลื่อนหาลำบากบนแท็บเล็ต)
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const [hi, setHi]       = useState(0)
  const boxRef  = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (o: ReasonOption[]) => setOptions([...o])
    ;(listeners[category] ??= new Set()).add(fn)
    if (cache[category]) setOptions(cache[category])
    else loadOptions(category)
    return () => { listeners[category]?.delete(fn) }
  }, [category])

  // ปิดดรอปดาวเมื่อคลิกนอกกล่อง
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => { setHi(0) }, [query, open])

  // เลื่อนรายการที่ไฮไลต์ให้อยู่ในจอ (ใช้ลูกศรขึ้น/ลง)
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-hi="1"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [hi, open])

  function pick(label: string) {
    onChange(label)
    setOpen(false)
    setQuery('')
  }

  const ring =
    accent === 'red'   ? 'border-red-500/40 focus:border-red-500'
    : accent === 'amber' ? 'border-amber-500/40 focus:border-amber-500'
    : 'border-orange-500/40 focus:border-orange-500'

  async function addOption() {
    const label = newLabel.trim()
    if (!label) return
    setBusy(true)
    const maxSort = options.reduce((m, o) => Math.max(m, o.sort_order), 0)
    const { error } = await supabase
      .from('reason_options')
      .insert({ category, label, sort_order: maxSort + 10 })
    setBusy(false)
    if (error) {
      if ((error as any).code === '23505') alert('มีหัวข้อนี้อยู่แล้ว')
      else alert('เพิ่มหัวข้อไม่สำเร็จ: ' + error.message)
      return
    }
    await loadOptions(category)   // รีเฟรชให้ทุกกล่องที่ใช้ category เดียวกัน
    onChange(label)               // เลือกหัวข้อที่เพิ่งเพิ่มเลย
    setNewLabel('')
  }

  async function removeOption(opt: ReasonOption) {
    if (!confirm(`ลบหัวข้อ "${opt.label}" ?`)) return
    setBusy(true)
    // soft delete — ประวัติที่บันทึกชื่อนี้ไว้แล้วไม่กระทบ (เก็บเป็นข้อความ)
    const { error } = await supabase
      .from('reason_options').update({ active: false }).eq('id', opt.id)
    setBusy(false)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    if (value === opt.label) onChange('')   // เคลียร์ถ้ากำลังเลือกอันที่ถูกลบ
    await loadOptions(category)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <div ref={boxRef} className="relative flex-1 min-w-0">
          <div className={`flex items-center gap-2 bg-slate-800 border rounded-xl px-3 py-2 ${ring}`}>
            <Search size={15} className="shrink-0 text-slate-500"/>
            <input
              value={open ? query : value}
              onChange={e => { setQuery(e.target.value); setOpen(true) }}
              onFocus={() => { setOpen(true); setQuery('') }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, filtered.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); if (open && filtered[hi]) pick(filtered[hi].label) }
                else if (e.key === 'Escape') { setOpen(false); setQuery('') }
              }}
              placeholder={value ? undefined : (placeholder ?? 'เลือกเหตุผล...')}
              className="flex-1 min-w-0 bg-transparent text-sm text-white outline-none placeholder-slate-500" />
            {value && !open && (
              <button type="button" onClick={() => onChange('')} title="ล้างเหตุผล"
                className="shrink-0 text-slate-500 hover:text-slate-300"><X size={14}/></button>
            )}
            <ChevronDown size={15} className="shrink-0 text-slate-500"/>
          </div>
          {open && (
            <div ref={listRef}
              className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-xl">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-sm text-slate-400">
                  ไม่พบหัวข้อที่ตรงกับ “{query.trim()}”
                </div>
              ) : filtered.map((o, i) => (
                <button key={o.id} type="button" data-hi={i === hi ? '1' : undefined}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(o.label)}
                  className={`block w-full text-left px-3 py-2 text-sm ${
                    o.label === value ? 'text-orange-300 font-bold' : 'text-slate-200'
                  } ${i === hi ? 'bg-slate-800' : ''}`}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => setManaging(v => !v)} title="จัดการหัวข้อ (เพิ่ม/ลบ)"
          className={`shrink-0 px-3 rounded-xl border-2 text-sm font-bold ${
            managing ? 'bg-slate-700 border-slate-600 text-slate-300'
                     : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'}`}>
          {managing ? <X size={16}/> : <Settings size={16}/>}
        </button>
      </div>
      {managing && (
        <div className="space-y-1.5 bg-slate-900 border border-slate-700 rounded-xl p-2">
          <div className="flex gap-1.5">
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
              placeholder="พิมพ์หัวข้อใหม่แล้วกด เพิ่ม..."
              className={`flex-1 min-w-0 bg-slate-800 border rounded-xl px-3 py-2 text-sm text-white outline-none placeholder-slate-500 ${ring}`} />
            <button type="button" disabled={busy || !newLabel.trim()} onClick={addOption}
              className="shrink-0 px-3 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">
              เพิ่ม
            </button>
          </div>
          {options.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {options.map(o => (
                <div key={o.id} className="flex items-center justify-between gap-2 bg-slate-800 rounded-lg px-3 py-1.5">
                  <span className="text-sm text-slate-200 truncate">{o.label}</span>
                  <button type="button" disabled={busy} onClick={() => removeOption(o)} title="ลบหัวข้อนี้"
                    className="shrink-0 text-rose-400 hover:text-rose-300 disabled:opacity-40">
                    <Trash2 size={15}/>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
