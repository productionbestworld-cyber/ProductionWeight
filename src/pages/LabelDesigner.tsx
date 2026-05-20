import { useState, useRef, useEffect, useCallback } from 'react'
import { Eye, EyeOff, Save, RotateCcw, Move, ChevronUp, ChevronDown, Trash2, Plus, Type, Minus, QrCode, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface FieldConfig {
  id: string
  label: string          // ชื่อที่แสดงใน designer
  sampleValue: string    // ข้อความตัวอย่างใน preview
  x: number              // mm จากซ้าย
  y: number              // mm จากบน
  w: number              // mm ความกว้าง
  h: number              // mm ความสูง
  fontSize: number       // pt
  fontWeight: string     // '400' | '700' | '900'
  align: 'left' | 'center' | 'right'
  visible: boolean
  type: 'text' | 'qr' | 'separator' | 'weight'
  border: boolean
  italic: boolean
}

export interface LabelLayout {
  labelW: number   // mm
  labelH: number   // mm
  fields: FieldConfig[]
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SCALE   = 5.0   // px per mm (for canvas display — ใหญ่ขึ้นเพื่ออ่านง่าย)
const LABEL_W = 165   // mm
const LABEL_H = 70    // mm
const LS_KEY  = 'bwp_label_layout_long'

// ── DEFAULT — map จาก longHtml เดิมแบบแม่นยำ ────────────────────────────────
// ใบ 165×70mm, wrap padding: 1.5mm บน/ล่าง, 3mm ซ้าย/ขวา
// .title  → y=1.5, h≈6.5  (11pt/800, border-bottom 2px)
// .hdr    → y=8.5, h≈5    (3 flex cols: 1 / 1.4 / 0.7, border-bottom 1px)
// .body   → y=14, h=54.5  (.L flex:1.5 w≈95mm | .R flex:1 w≈64mm)
// .L top: prodcode y=14, prodname y=19   .L bottom (space-between): machine y=55, core y=59.5, size y=64
// .R top: lotno y=14, length y=18.5, gross y=23.5, net y=28.5
// .R bottom (auto): barcode_lbl y=58, sep_bc y=61, inspector y=64.5, qr y=49.5
export const DEFAULT_LAYOUT: LabelLayout = {
  labelW: LABEL_W,
  labelH: LABEL_H,
  fields: [
    // ─ Title ──────────────────────────────────────────────────────────────
    { id:'header', label:'หัวกระดาษ (ชื่อบริษัท)',
      sampleValue:'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด',
      x:2,   y:1.5, w:161, h:6.5,
      fontSize:12, fontWeight:'800', align:'center',
      visible:true, type:'text', border:true, italic:false },

    // ─ Hdr row: 3 cols ────────────────────────────────────────────────────
    { id:'mat', label:'Mat Code',
      sampleValue:'Mat Code  P-001',
      x:3,   y:8.5, w:51, h:5,
      fontSize:9, fontWeight:'700', align:'left',
      visible:true, type:'text', border:true, italic:false },
    { id:'mfg', label:'MFG Date',
      sampleValue:'MFG Date  19/05/69',
      x:55,  y:8.5, w:72, h:5,
      fontSize:9, fontWeight:'700', align:'center',
      visible:true, type:'text', border:true, italic:false },
    { id:'rollno', label:'Roll No',
      sampleValue:'Roll No.  #5',
      x:128, y:8.5, w:34, h:5,
      fontSize:9, fontWeight:'700', align:'right',
      visible:true, type:'text', border:true, italic:false },

    // ─ LEFT column top ────────────────────────────────────────────────────
    { id:'prodcode', label:'Product Code',
      sampleValue:'Product Code  P-001-LD',
      x:3, y:14, w:92, h:5,
      fontSize:9, fontWeight:'700', align:'left',
      visible:true, type:'text', border:false, italic:false },
    { id:'prodname', label:'Product Name',
      sampleValue:'LDPE ใส',
      x:3, y:19, w:92, h:7,
      fontSize:11, fontWeight:'800', align:'left',
      visible:true, type:'text', border:false, italic:false },

    // ─ LEFT column bottom ─────────────────────────────────────────────────
    { id:'machine', label:'เครื่อง',
      sampleValue:'เครื่อง  M-01',
      x:3, y:54, w:92, h:5,
      fontSize:8.5, fontWeight:'700', align:'left',
      visible:true, type:'text', border:false, italic:false },
    { id:'core', label:'Core Weight',
      sampleValue:'Core Weight  1.50',
      x:3, y:59, w:92, h:5,
      fontSize:8.5, fontWeight:'700', align:'left',
      visible:true, type:'text', border:false, italic:false },
    { id:'size', label:'Size (กว้าง × หนา)',
      sampleValue:'Size  120 cm × 40 mc',
      x:3, y:64, w:92, h:5,
      fontSize:9.5, fontWeight:'700', align:'left',
      visible:true, type:'text', border:false, italic:false },

    // ─ Vertical separator L|R ─────────────────────────────────────────────
    { id:'vsep', label:'เส้นแบ่งซ้าย|ขวา',
      sampleValue:'',
      x:98.4, y:14, w:0.5, h:55,
      fontSize:8, fontWeight:'400', align:'left',
      visible:true, type:'separator', border:false, italic:false },

    // ─ RIGHT column top ───────────────────────────────────────────────────
    { id:'lotno', label:'Lot No',
      sampleValue:'Lot No  L240519-01',
      x:101, y:14, w:61, h:5,
      fontSize:9, fontWeight:'700', align:'left',
      visible:true, type:'text', border:false, italic:false },
    { id:'length', label:'ความยาว / Pcs',
      sampleValue:'Length  500  M.    Pcs.',
      x:101, y:19, w:61, h:5,
      fontSize:9, fontWeight:'700', align:'left',
      visible:true, type:'text', border:false, italic:false },
    { id:'gross', label:'Gross Weight',
      sampleValue:'Gross Weight  27.00 Kgs.',
      x:101, y:24.5, w:61, h:5,
      fontSize:8.5, fontWeight:'700', align:'left',
      visible:true, type:'text', border:true, italic:false },
    { id:'net', label:'Net Weight',
      sampleValue:'25.50',
      x:101, y:30, w:61, h:8,
      fontSize:15, fontWeight:'900', align:'left',
      visible:true, type:'weight', border:false, italic:false },

    // ─ RIGHT column bottom ────────────────────────────────────────────────
    { id:'barcode_lbl', label:'Barcode No. (ป้าย)',
      sampleValue:'Barcode No.',
      x:101, y:57, w:41, h:3.5,
      fontSize:8, fontWeight:'400', align:'left',
      visible:true, type:'text', border:false, italic:false },
    { id:'sep_bc', label:'เส้น Barcode (bcno)',
      sampleValue:'',
      x:101, y:61, w:24, h:0,
      fontSize:8, fontWeight:'400', align:'left',
      visible:true, type:'separator', border:false, italic:false },
    { id:'inspector', label:'ผู้ตรวจสอบ',
      sampleValue:'ผู้ตรวจสอบ  นาย ทดสอบ ระบบ',
      x:101, y:64, w:41, h:4.5,
      fontSize:9, fontWeight:'700', align:'left',
      visible:true, type:'text', border:false, italic:false },

    // ─ QR ─────────────────────────────────────────────────────────────────
    { id:'qr', label:'QR Code',
      sampleValue:'QR',
      x:143, y:49.5, w:19, h:19,
      fontSize:8, fontWeight:'400', align:'center',
      visible:true, type:'qr', border:false, italic:false },
  ],
}

// ── Persistence — Supabase ────────────────────────────────────────────────────
const LAYOUT_ID = 'long'

export async function loadLongLayout(): Promise<LabelLayout> {
  try {
    const { data } = await supabase
      .from('label_layouts')
      .select('layout')
      .eq('id', LAYOUT_ID)
      .single()
    if (data?.layout) {
      const parsed = data.layout as LabelLayout
      // merge — เพิ่ม field ใหม่ที่อาจยังไม่มีใน saved version
      const savedIds = new Set(parsed.fields.map((f: FieldConfig) => f.id))
      const missing  = DEFAULT_LAYOUT.fields.filter(f => !savedIds.has(f.id))
      return { ...parsed, fields: [...parsed.fields, ...missing] }
    }
  } catch {}
  return DEFAULT_LAYOUT
}

async function saveLayoutToDB(layout: LabelLayout) {
  await supabase
    .from('label_layouts')
    .upsert({ id: LAYOUT_ID, layout, updated_at: new Date().toISOString() })
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function LabelDesigner() {
  const [layout, setLayout]     = useState<LabelLayout>(DEFAULT_LAYOUT)
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const dragging = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const fields        = layout.fields
  const selectedField = fields.find(f => f.id === selected) ?? null

  // โหลด layout จาก Supabase ตอน mount
  useEffect(() => {
    loadLongLayout().then(l => { setLayout(l); setLoading(false) })
  }, [])

  // ── save ──────────────────────────────────────────────────────────────────
  async function doSave() {
    setSavedFlash(true)
    await saveLayoutToDB(layout)
    setTimeout(() => setSavedFlash(false), 2000)
  }

  async function doReset() {
    if (!confirm('รีเซ็ตกลับค่าเริ่มต้น? (layout ที่บันทึกไว้จะหายไป)')) return
    setLayout(DEFAULT_LAYOUT)
    setSelected(null)
    await saveLayoutToDB(DEFAULT_LAYOUT)
  }

  // ── add / delete ─────────────────────────────────────────────────────────
  const [showAddMenu, setShowAddMenu] = useState(false)

  function addField(type: FieldConfig['type']) {
    const id = `field_${Date.now()}`
    const base: FieldConfig = {
      id, label: type === 'separator' ? 'เส้นคั่น' : type === 'qr' ? 'QR Code' : 'ข้อความใหม่',
      sampleValue: type === 'separator' ? '' : type === 'qr' ? 'QR' : 'ข้อความ',
      x: 10, y: 10, w: type === 'separator' ? 100 : type === 'qr' ? 20 : 80,
      h: type === 'separator' ? 0 : type === 'qr' ? 20 : 6,
      fontSize: 8, fontWeight: '700', align: 'left',
      visible: true, type, border: false, italic: false,
    }
    setLayout(prev => ({ ...prev, fields: [...prev.fields, base] }))
    setSelected(id)
    setShowAddMenu(false)
  }

  function deleteField(id: string) {
    setLayout(prev => ({ ...prev, fields: prev.fields.filter(f => f.id !== id) }))
    setSelected(null)
  }

  // ── field update helpers ──────────────────────────────────────────────────
  const updateField = useCallback((id: string, patch: Partial<FieldConfig>) => {
    setLayout(prev => ({ ...prev, fields: prev.fields.map(f => f.id === id ? { ...f, ...patch } : f) }))
  }, [])

  function moveOrder(id: string, dir: -1 | 1) {
    setLayout(prev => {
      const arr = [...prev.fields]
      const i   = arr.findIndex(f => f.id === id)
      const j   = i + dir
      if (j < 0 || j >= arr.length) return prev
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return { ...prev, fields: arr }
    })
  }

  // ── drag & drop ───────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setSelected(id)
    const f = fields.find(f => f.id === id)!
    dragging.current = { id, sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y }
  }, [fields])

  const onFieldClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()  // กันไม่ให้ bubble ขึ้น canvas แล้ว clear selected
  }, [])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const dx = (e.clientX - dragging.current.sx) / SCALE
      const dy = (e.clientY - dragging.current.sy) / SCALE
      const f  = dragging.current
      setLayout(prev => ({
        ...prev,
        fields: prev.fields.map(field =>
          field.id !== f.id ? field : {
            ...field,
            x: Math.max(0, Math.min(LABEL_W - field.w, Math.round((f.ox + dx) * 2) / 2)),
            y: Math.max(0, Math.min(LABEL_H - (field.type === 'separator' ? 0 : field.h), Math.round((f.oy + dy) * 2) / 2)),
          }
        ),
      }))
    }
    function onUp() { dragging.current = null }
    function onClickOutside() { setShowAddMenu(false) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    document.addEventListener('click',     onClickOutside)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
      document.removeEventListener('click',     onClickOutside)
    }
  }, [])

  // ── render canvas field ───────────────────────────────────────────────────
  function renderField(f: FieldConfig) {
    if (!f.visible) return null
    const isSel   = selected === f.id
    const outline = isSel ? '2px solid #3b82f6' : '1px dashed transparent'
    const base: React.CSSProperties = {
      position: 'absolute',
      left:   f.x * SCALE,
      top:    f.y * SCALE,
      width:  f.w * SCALE,
      cursor: 'move',
      outline,
      outlineOffset: 1,
      userSelect: 'none',
    }

    if (f.type === 'separator') {
      // เส้นตั้ง (vsep) ถ้า h > w
      if (f.h > f.w) {
        return (
          <div key={f.id} onMouseDown={e => onMouseDown(e, f.id)} onClick={onFieldClick}
            style={{ ...base, width: 2, height: f.h * SCALE, background: '#000', outlineOffset: 3 }} />
        )
      }
      return (
        <div key={f.id} onMouseDown={e => onMouseDown(e, f.id)} onClick={onFieldClick}
          style={{ ...base, height: 2, background: '#000', outlineOffset: 3 }} />
      )
    }

    if (f.type === 'qr') {
      return (
        <div key={f.id} onMouseDown={e => onMouseDown(e, f.id)} onClick={onFieldClick}
          style={{ ...base, height: f.h * SCALE, background: '#f0f0f0', border: isSel ? 'none' : '1px dashed #aaa',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 10 }}>
          QR
        </div>
      )
    }

    const pxSize = f.fontSize * (SCALE / 3.78)
    const isWeight = f.type === 'weight'

    return (
      <div key={f.id} onMouseDown={e => onMouseDown(e, f.id)} onClick={onFieldClick}
        style={{
          ...base,
          height: f.h * SCALE,
          border:  f.border ? '1px solid #000' : (isSel ? 'none' : '1px dashed transparent'),
          boxSizing: 'border-box',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: isWeight ? 'column' : 'row',
          alignItems: isWeight ? 'flex-start' : 'center',
          justifyContent: f.align === 'center' ? 'center' : f.align === 'right' ? 'flex-end' : 'flex-start',
          padding: '0 1px',
          color: '#000',
          fontFamily: 'Sarabun, Arial, sans-serif',
        }}>
        {isWeight ? (
          <>
            <span style={{ fontSize: pxSize * 0.28, fontWeight: '700', lineHeight: 1.2 }}>Net Weight</span>
            <span style={{ fontSize: pxSize,        fontWeight: '900', lineHeight: 1   }}>{f.sampleValue.split(' ')[0]}</span>
            <span style={{ fontSize: pxSize * 0.35, fontWeight: '700', lineHeight: 1.2 }}>Kgs.</span>
          </>
        ) : (
          <span style={{ fontSize: pxSize, fontWeight: f.fontWeight, fontStyle: f.italic ? 'italic' : 'normal',
            textAlign: f.align, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {f.sampleValue}
          </span>
        )}
      </div>
    )
  }

  // helper สำหรับ number input ใน property panel (ต้องอยู่นอก PropPanel เพื่อกัน remount)
  const numInput = (key: keyof FieldConfig, step = 0.5, min = 0) => selectedField ? (
    <input type="number" value={(selectedField[key] as number) ?? 0} step={step} min={min}
      onChange={e => updateField(selectedField.id, { [key]: parseFloat(e.target.value) || 0 })}
      className="bg-slate-800 text-white text-xs rounded px-2 py-1 w-full border border-slate-700 focus:border-blue-500 focus:outline-none" />
  ) : null

  // ── UI ────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-full bg-[#0a0f1e] text-slate-400 gap-3">
      <Loader2 size={20} className="animate-spin" />
      <span className="text-sm">กำลังโหลด layout...</span>
    </div>
  )

  return (
    <div className="flex bg-[#0a0f1e] text-white overflow-hidden" style={{ height: 'calc(100vh - 49px)' }}>

      {/* ── Left: field list ────────────────────────────────────────────── */}
      <div className="w-48 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">ฟิลด์ทั้งหมด</p>
          <div className="relative">
            <button onClick={e => { e.stopPropagation(); setShowAddMenu(v => !v) }}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-semibold">
              <Plus size={10} />เพิ่ม
            </button>
            {showAddMenu && (
              <div className="absolute left-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl z-50 overflow-hidden w-40">
                <button onClick={e => { e.stopPropagation(); addField('text') }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-700 text-slate-200">
                  <Type size={11} className="text-blue-400" />ข้อความ (Text)
                </button>
                <button onClick={e => { e.stopPropagation(); addField('weight') }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-700 text-slate-200">
                  <Type size={11} className="text-green-400" />Net Weight (ใหญ่)
                </button>
                <button onClick={e => { e.stopPropagation(); addField('separator') }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-700 text-slate-200">
                  <Minus size={11} className="text-slate-400" />เส้นคั่น
                </button>
                <button onClick={e => { e.stopPropagation(); addField('qr') }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-700 text-slate-200">
                  <QrCode size={11} className="text-purple-400" />QR Code
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {fields.map(f => (
            <button key={f.id} onClick={() => setSelected(f.id)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                selected === f.id ? 'bg-blue-600/20 text-blue-300' : 'hover:bg-slate-800 text-slate-300'
              } ${!f.visible ? 'opacity-35' : ''}`}>
              <Move size={10} className="shrink-0 text-slate-500" />
              <span className="flex-1 truncate">{f.label}</span>
              <span onClick={e => { e.stopPropagation(); updateField(f.id, { visible: !f.visible }) }}
                className="shrink-0 opacity-50 hover:opacity-100 cursor-pointer">
                {f.visible ? <Eye size={10} /> : <EyeOff size={10} />}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Center: canvas ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-start overflow-auto bg-slate-950 p-8 gap-4" style={{ scrollBehavior: 'smooth' }}>

        {/* toolbar */}
        <div className="flex items-center gap-3 w-full max-w-max">
          <span className="text-xs text-slate-500 mr-2">ใบยาว {LABEL_W}×{LABEL_H} mm · ลากเพื่อจัดตำแหน่ง</span>
          <button onClick={doSave}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              savedFlash ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}>
            <Save size={12} />
            {savedFlash ? 'บันทึกแล้ว ✓' : 'บันทึก Layout'}
          </button>
          <button onClick={doReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300">
            <RotateCcw size={12} />รีเซ็ต
          </button>
        </div>

        {/* label canvas — ห่อด้วย overflow:visible เพื่อให้ field ที่ลากออกนอกยังเห็นได้ */}
        <div className="shrink-0" style={{ padding: '20px', background: 'transparent' }}>
          <div
            ref={canvasRef}
            className="relative bg-white shadow-2xl"
            style={{
              width: LABEL_W * SCALE,
              height: LABEL_H * SCALE,
              border: '2px solid #000',
              outline: '4px solid #1e293b',
              outlineOffset: '2px',
              overflow: 'visible',   // ← ให้ field ลากออกนอกได้โดยไม่ถูก clip
              touchAction: 'none',
            }}
            onClick={() => setSelected(null)}>

            {/* mm ruler guides แนวนอน ทุก 10mm */}
            {Array.from({ length: Math.floor(LABEL_H / 10) }, (_, i) => (
              <div key={i} style={{
                position: 'absolute', left: 0, top: (i + 1) * 10 * SCALE,
                width: '100%', height: 1, background: '#dbeafe', pointerEvents: 'none', zIndex: 0,
              }} />
            ))}

            {/* mm ruler guides แนวตั้ง ทุก 10mm */}
            {Array.from({ length: Math.floor(LABEL_W / 10) }, (_, i) => (
              <div key={i} style={{
                position: 'absolute', top: 0, left: (i + 1) * 10 * SCALE,
                height: '100%', width: 1, background: '#f1f5f9', pointerEvents: 'none', zIndex: 0,
              }} />
            ))}

            {fields.map(renderField)}
          </div>
        </div>

        <p className="text-[10px] text-slate-600 shrink-0">
          เลื่อน scroll ได้ · คลิกพื้นที่ว่างเพื่อยกเลิกการเลือก · เส้น = ทุก 10 mm
        </p>
      </div>

      {/* ── Right: property panel ────────────────────────────────────────── */}
      <div className="w-60 bg-slate-900 border-l border-slate-800 flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-slate-800">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            {selectedField ? `✏️ ${selectedField.label}` : 'คุณสมบัติ'}
          </p>
        </div>
        {/* ── Property panel (inline — ห้ามย้ายเป็น sub-component เพราะจะ remount) ── */}
        {!selectedField ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-slate-500 text-xs text-center">คลิกเลือกฟิลด์<br/>บน canvas เพื่อแก้ไข</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">

            {/* ตำแหน่ง */}
            <section>
              <p className="text-slate-400 font-semibold uppercase tracking-wider mb-2">ตำแหน่ง (mm)</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1"><span className="text-slate-500">X (ซ้าย)</span>{numInput('x')}</label>
                <label className="flex flex-col gap-1"><span className="text-slate-500">Y (บน)</span>{numInput('y')}</label>
                <label className="flex flex-col gap-1"><span className="text-slate-500">กว้าง</span>{numInput('w', 1, 1)}</label>
                {selectedField.type !== 'separator' &&
                  <label className="flex flex-col gap-1"><span className="text-slate-500">สูง</span>{numInput('h', 0.5, 1)}</label>}
              </div>
            </section>

            {/* ชื่อ label */}
            <section>
              <p className="text-slate-400 font-semibold uppercase tracking-wider mb-1">ชื่อฟิลด์</p>
              <input type="text" value={selectedField.label}
                onChange={e => updateField(selectedField.id, { label: e.target.value })}
                className="bg-slate-800 text-white text-xs rounded px-2 py-1 w-full border border-slate-700 focus:border-blue-500 focus:outline-none" />
            </section>

            {/* ตัวอักษร */}
            {selectedField.type !== 'separator' && selectedField.type !== 'qr' && (
              <section>
                <p className="text-slate-400 font-semibold uppercase tracking-wider mb-2">ตัวอักษร</p>
                <div className="space-y-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-slate-500">ขนาด (pt)</span>
                    {numInput('fontSize', 0.5, 6)}
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-slate-500">น้ำหนัก</span>
                    <select value={selectedField.fontWeight}
                      onChange={e => updateField(selectedField.id, { fontWeight: e.target.value })}
                      className="bg-slate-800 text-white text-xs rounded px-2 py-1 border border-slate-700 focus:border-blue-500 focus:outline-none">
                      <option value="400">ปกติ (400)</option>
                      <option value="700">หนา (700)</option>
                      <option value="900">หนามาก (900)</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-slate-500">การจัดวาง</span>
                    <select value={selectedField.align}
                      onChange={e => updateField(selectedField.id, { align: e.target.value as FieldConfig['align'] })}
                      className="bg-slate-800 text-white text-xs rounded px-2 py-1 border border-slate-700 focus:border-blue-500 focus:outline-none">
                      <option value="left">ซ้าย</option>
                      <option value="center">กลาง</option>
                      <option value="right">ขวา</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedField.italic}
                      onChange={e => updateField(selectedField.id, { italic: e.target.checked })} className="rounded" />
                    <span className="text-slate-300">ตัวเอียง</span>
                  </label>
                </div>
              </section>
            )}

            {/* กรอบ */}
            {selectedField.type !== 'separator' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={selectedField.border}
                  onChange={e => updateField(selectedField.id, { border: e.target.checked })} className="rounded" />
                <span className="text-slate-300">แสดงกรอบ</span>
              </label>
            )}

            {/* ตัวอย่างข้อความ */}
            {selectedField.type !== 'qr' && selectedField.type !== 'separator' && (
              <section>
                <p className="text-slate-400 font-semibold uppercase tracking-wider mb-1">ตัวอย่างข้อความ</p>
                <input type="text" value={selectedField.sampleValue}
                  onChange={e => updateField(selectedField.id, { sampleValue: e.target.value })}
                  className="bg-slate-800 text-white text-xs rounded px-2 py-1 w-full border border-slate-700 focus:border-blue-500 focus:outline-none" />
              </section>
            )}

            {/* ลำดับ */}
            <section>
              <p className="text-slate-400 font-semibold uppercase tracking-wider mb-2">ลำดับ (Z-Order)</p>
              <div className="flex gap-2">
                <button onClick={() => moveOrder(selectedField.id, -1)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">
                  <ChevronUp size={12} />ขึ้น
                </button>
                <button onClick={() => moveOrder(selectedField.id, 1)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">
                  <ChevronDown size={12} />ลง
                </button>
              </div>
            </section>

            {/* ซ่อน/แสดง */}
            <button onClick={() => updateField(selectedField.id, { visible: !selectedField.visible })}
              className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg font-semibold transition-colors ${
                selectedField.visible
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-400'
                  : 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
              }`}>
              {selectedField.visible ? <><EyeOff size={12} />ซ่อนฟิลด์นี้</> : <><Eye size={12} />แสดงฟิลด์นี้</>}
            </button>

            {/* ลบ */}
            <button onClick={() => { if (confirm(`ลบ "${selectedField.label}" ออก?`)) deleteField(selectedField.id) }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg font-semibold bg-red-900/20 hover:bg-red-900/50 text-red-400 hover:text-red-300 transition-colors">
              <Trash2 size={12} />ลบฟิลด์นี้
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
