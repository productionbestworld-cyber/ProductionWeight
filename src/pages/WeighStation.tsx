import { useState, useEffect, useRef } from 'react'
import { Save, Printer, RefreshCw, CheckCircle2, ArrowLeft, Wind, X } from 'lucide-react'
import QRCode from 'react-qr-code'
import QRCodeLib from 'qrcode'
import { supabase } from '../lib/supabase'
import { loadProfiles, saveProfiles, type MachineProfile } from './MachineSettings'

function fmt(n: number | null | undefined, d: 1|2 = 2) {
  if (n === null || n === undefined || isNaN(n as number)) return (0).toFixed(d)
  return (n as number).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function thaiDate() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`
}
function barcodeUrl(text: string, h = 10) {
  return `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(text||'0')}&scale=2&height=${h}&includetext`
}

// ── Print Label ───────────────────────────────────────────────────────────────
async function printLabel(p: MachineProfile, rollNo: number, gross: number, net: number, size: 'long'|'short' = 'long', rollType: string = 'good', reason = '', rollId?: string) {
  const dec     = p.decimal
  const mfgDate = thaiDate()
  const core    = parseFloat(p.coreWeight) || 0
  // QR encode แค่ roll ID → URL สั้น → generate เป็น data URL ฝังใน HTML ทันที
  const appUrl    = window.location.origin
  const detailUrl = rollId ? `${appUrl}/?roll=${rollId}` : `${appUrl}/`

  // generate QR เป็น PNG data URL (ไม่ต้องพึ่ง internet)
  const makeQR = async (px: number) => {
    try {
      return await QRCodeLib.toDataURL(detailUrl, { width: px, margin: 1, errorCorrectionLevel: 'M' })
    } catch { return '' }
  }
  const [qr72, qr56] = await Promise.all([makeQR(144), makeQR(112)])
  const qrUrl = (s: 72|56) => s === 72 ? qr72 : qr56

  // ═══════════════════════════════════════════════════════
  // ใบยาว 165 × 101.5 mm (landscape) — compact fit
  // ═══════════════════════════════════════════════════════
  const longHtml = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Tahoma',sans-serif;font-size:8.5pt;color:#000;background:#fff;width:165mm;height:70mm}
.wrap{width:165mm;height:70mm;padding:1.5mm 3mm;display:flex;flex-direction:column;border:1.5px solid #000;overflow:hidden}
.title{text-align:center;font-size:11pt;font-weight:800;border-bottom:2px solid #000;padding-bottom:.8mm;margin-bottom:.8mm}
.hdr{display:flex;border-bottom:1px solid #000;padding-bottom:.8mm;margin-bottom:.8mm}
.hc1{flex:1;border-right:1px solid #888;padding-right:3mm}
.hc2{flex:1.4;border-right:1px solid #888;padding:0 3mm;text-align:center}
.hc3{flex:.7;padding-left:3mm;text-align:right}
.body{display:flex;flex:1;min-height:0}
.L{flex:1.5;padding-right:3mm;border-right:1px solid #000;display:flex;flex-direction:column;gap:0}
.R{flex:1;padding-left:3mm;display:flex;flex-direction:column;gap:0}
.row{display:flex;align-items:baseline;line-height:1.5;margin-bottom:.3mm}
.k{font-size:7.5pt;min-width:22mm;display:inline-block}
.v{font-size:8pt;font-weight:700}
.v2{font-size:10pt;font-weight:800}
.sn{font-size:12pt;font-weight:900;vertical-align:middle}
.su{font-size:7pt;vertical-align:middle}
.wr{display:flex;justify-content:space-between;align-items:baseline;border-bottom:.5px solid #ccc;padding:.5mm 0}
.wk{font-size:7.5pt}
.wv{font-size:9.5pt;font-weight:700}
.wvn{font-size:13pt;font-weight:900;color:#003087}
.bcno{border-bottom:1px solid #000;height:3mm;margin-top:.3mm;width:100%}
@media print{@page{size:165mm 70mm;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
<div class="wrap">
  <div class="title">บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด
    ${rollType !== 'good' ? `<span style="font-size:8pt;font-weight:700;color:#c00;margin-left:4mm">[${
      rollType === 'bad'         ? 'ม้วนกรอ' :
      rollType === 'scrap_clear' ? 'เศษเสีย (ใส)' :
      rollType === 'scrap_color' ? 'เศษเสีย (สี)' :
      rollType === 'scrap_lump'  ? 'เศษก้อน' : ''
    }]</span>` : ''}
  </div>
  ${reason ? `<div style="font-size:7.5pt;color:#c00;text-align:center;margin-bottom:1mm">เหตุผล: ${reason}</div>` : ''}

  <!-- Header: ไม่มี barcode แค่ text -->
  <div class="hdr">
    <div class="hc1">
      <span style="font-size:8pt">Mat Code &nbsp;</span><b style="font-size:9pt">${p.matCode}</b>
    </div>
    <div class="hc2">
      <span style="font-size:8pt">MFG Date &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><b style="font-size:9pt">${mfgDate}</b>
    </div>
    <div class="hc3">
      <span style="font-size:8pt">${rollType.startsWith('scrap') ? 'ถุงเศษ' : rollType==='bad' ? 'กรอ No.' : 'Roll No.'} &nbsp;</span>
      <b style="font-size:9pt">${rollNo === 0 ? '—' : rollNo}</b>
    </div>
  </div>

  <div class="body">
    <!-- LEFT: Product top, Machine bottom-left -->
    <div class="L" style="justify-content:space-between">
      <div>
        <div class="row"><span class="k">Product Code</span><span class="v">${p.productCode||p.matCode}</span></div>
        <div class="row"><span class="k">Product Name</span><span class="v2">${p.productName}</span></div>
      </div>
      <div>
        <div class="row"><span class="k">เครื่อง</span><span class="v">${p.machine_no}</span></div>
        <div class="row"><span class="k">Core Weight</span><span class="v">${fmt(core,dec)}</span></div>
        <div class="row" style="align-items:center">
          <span class="k">Size</span>
          <span class="sn">${p.widthCm}</span><span class="su">&nbsp;cm&nbsp;x&nbsp;</span>
          <span class="sn">${p.thickMc}</span><span class="su">&nbsp;mc</span>
        </div>
      </div>
    </div>

    <!-- RIGHT -->
    <div class="R">
      <div class="row"><span class="k">Lot No</span><span class="v">${p.lotNo}</span></div>
      <div class="row">
        <span class="k">Length</span><span class="v">${p.length||'—'}</span>
        <span style="font-size:7.5pt">&nbsp;Ms.&nbsp;&nbsp;</span>
        <span class="v">${p.pcs||''}</span>
        <span style="font-size:7.5pt">&nbsp;Pcs.</span>
      </div>
      <div style="height:1mm"></div>
      <div class="wr"><span class="wk">Gross Weight</span><span class="wv">${fmt(gross,dec)} Kgs.</span></div>
      <div class="wr" style="border-bottom:none"><span class="wk">Net Weight</span><span class="wvn">${fmt(net,dec)} Kgs.</span></div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-top:auto">
        <div>
          <div style="font-size:7.5pt">Barcode No.</div>
          <div class="bcno" style="width:24mm"></div>
          <div style="margin-top:1mm;font-size:8pt">ผู้ตรวจสอบ &nbsp;<b>${p.inspector}</b></div>
        </div>
        <img src="${qrUrl(72)}" width="72" height="72" style="flex-shrink:0;image-rendering:pixelated"/>
      </div>
    </div>
  </div>
</div>`

  // ═══════════════════════════════════════════════════════
  // ใบสั้น 76.2 × 76.2 mm (square)
  // ═══════════════════════════════════════════════════════
  const shortHtml = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Tahoma',sans-serif;font-size:7pt;color:#000;background:#fff;width:76.2mm;height:76.2mm}
.page{width:76.2mm;height:76.2mm;padding:2mm;display:flex;flex-direction:column;border:1px solid #000}
.lbl{font-size:5pt;color:#555}
@media print{@page{size:76.2mm 76.2mm;margin:0}body{-webkit-print-color-adjust:exact}}
</style>
<div class="page">
  <div style="text-align:center;font-size:7.5pt;font-weight:800;border-bottom:1px solid #000;padding-bottom:1mm;margin-bottom:1mm">
    บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:1mm;font-size:6.5pt">
    <span><b>Mat Code</b> ${p.matCode} &nbsp;|&nbsp; MFG ${mfgDate} &nbsp;|&nbsp; Roll <b>#${rollNo}</b></span>
  </div>
  <img src="${barcodeUrl(p.matCode,7)}" style="height:18px;margin-bottom:1mm;max-width:100%"/>
  <div style="font-size:6pt;font-weight:600;margin-bottom:1mm;border-bottom:.5px solid #ccc;padding-bottom:1mm">
    ${p.productName} · ${p.widthCm}cm×${p.thickMc}mc · Lot ${p.lotNo}
  </div>
  <div style="display:flex;gap:2mm;flex:1;align-items:center">
    <div style="flex:1">
      <div class="lbl">เครื่อง: <b style="font-size:7pt">${p.machine_no}</b></div>
      <div style="margin-top:1mm"><div class="lbl">Net Weight</div>
        <div style="font-weight:900;font-size:18pt;line-height:1;color:#003087">${fmt(net,dec)}</div>
        <div style="font-size:5.5pt;color:#003087;font-weight:700">Kgs. &nbsp;<span style="color:#666">Gross ${fmt(gross,dec)}</span></div>
      </div>
      <div style="margin-top:1mm;font-size:6pt">ผู้ตรวจ: <b>${p.inspector}</b></div>
    </div>
    <img src="${qrUrl(56)}" width="56" height="56" style="image-rendering:pixelated"/>
  </div>
</div>`

  const W   = size === 'long' ? 165  : 76.2
  const H   = size === 'long' ? 70   : 76.2
  const win = window.open('', '_blank', `width=${Math.round(W*3.78)},height=${Math.round(H*3.78)},menubar=no,toolbar=no`)
  if (!win) return

  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
  ${size === 'long' ? longHtml : shortHtml}
  </head><body><script>
    var imgs=document.images,n=0
    function ok(){n++;if(n>=imgs.length)setTimeout(function(){window.print();window.close()},400)}
    if(!imgs.length){setTimeout(function(){window.print();window.close()},400)}
    else{for(var i=0;i<imgs.length;i++){if(imgs[i].complete)ok();else{imgs[i].onload=ok;imgs[i].onerror=ok}}}
  <\/script></body></html>`)
  win.document.close()
}

// ── Machine Picker ────────────────────────────────────────────────────────────
function MachinePicker({ profiles, onSelect, onProfileUpdated, dept }: {
  profiles: MachineProfile[]
  onSelect: (p: MachineProfile) => void
  onProfileUpdated: () => void
  dept?: 'blow' | 'print'
}) {
  const [editing, setEditing] = useState<MachineProfile | null>(null)
  // เรียงตามชื่อเครื่อง
  const sorted = [...profiles].sort((a,b) => (a.machine_no||'').localeCompare(b.machine_no||'', undefined, { numeric: true }))

  function isReady(p: MachineProfile) {
    return !!(p.machine_no && p.custName && p.productName && p.matCode && p.lotNo)
  }

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[#0a0f1e] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <Wind size={20} className="text-brand-400" />
            เลือกเครื่อง
            {dept && (
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${dept==='blow' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'}`}>
                {dept === 'blow' ? '🌬 ฝั่งเป่า' : '🖨 ฝั่งพิม'}
              </span>
            )}
          </h1>
          <p className="text-slate-400 text-sm mt-1">เครื่องว่าง → คลิกเพื่อกรอกข้อมูลงาน · เครื่องพร้อม → คลิกเพื่อเริ่มชั่ง</p>
        </div>

        {/* Grid — แสดงทุกเครื่อง, size เท่ากันหมด */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {sorted.map((p, i) => {
            const ready = isReady(p)
            return (
              <button key={i}
                onClick={() => ready ? onSelect(p) : setEditing(p)}
                className={`h-48 rounded-2xl p-4 text-left transition-all active:scale-95 group flex flex-col ${
                  ready
                    ? 'bg-slate-900 border border-slate-700 hover:border-brand-500 hover:bg-brand-500/8'
                    : 'bg-slate-900/40 border-2 border-dashed border-slate-700 hover:border-brand-500 hover:bg-slate-900'
                }`}>
                {/* Header */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center font-black text-lg ${
                    ready
                      ? 'bg-brand-600 text-white group-hover:bg-brand-500'
                      : 'bg-slate-800 text-slate-500 border border-slate-700'
                  }`}>
                    {p.machine_no || '?'}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {ready ? (
                      <span className="text-[10px] bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full font-semibold">● พร้อมใช้</span>
                    ) : (
                      <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full font-semibold">○ ว่าง</span>
                    )}
                  </div>
                </div>

                {/* Content */}
                {ready ? (
                  <div className="flex-1 min-h-0">
                    <p className="text-white font-semibold text-sm leading-tight line-clamp-2 mb-1">{p.productName}</p>
                    <p className="text-slate-400 text-xs truncate">{p.custName}</p>
                    <div className="flex gap-1 flex-wrap mt-2">
                      <span className="text-[9px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">Lot {p.lotNo.slice(-6)}</span>
                      {p.widthCm && <span className="text-[9px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">{p.widthCm}×{p.thickMc}mc</span>}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center">
                    <p className="text-slate-500 text-xs">เครื่องว่าง</p>
                    <p className="text-slate-600 text-[10px] mt-1">คลิกเพื่อกรอกข้อมูลงาน</p>
                    <span className="mt-2 text-[10px] bg-brand-500/15 text-brand-300 border border-brand-500/30 px-3 py-1 rounded-full">+ กรอกข้อมูล</span>
                  </div>
                )}
              </button>
            )
          })}

          {sorted.length === 0 && (
            <div className="col-span-full text-center py-16 bg-slate-900 border border-slate-800 rounded-2xl">
              <Wind size={40} className="text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 font-semibold">ยังไม่มีเครื่อง</p>
              <p className="text-slate-600 text-sm mt-1">ไปตั้งค่าเพิ่มเครื่องที่ Tab "ตั้งค่าเครื่อง"</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick edit modal */}
      {editing && (
        <QuickEditModal profile={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onProfileUpdated() }} />
      )}
    </div>
  )
}

// ── Quick Edit Modal (กรอกข้อมูลงานใหม่) ─────────────────────────────────────
function QuickEditModal({ profile, onClose, onSaved }: {
  profile: MachineProfile; onClose: () => void; onSaved: () => void
}) {
  const [p, setP] = useState({ ...profile })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof MachineProfile, v: any) => setP(prev => ({ ...prev, [k]: v }))

  const ok = p.machine_no && p.custName && p.productName && p.matCode && p.lotNo && p.plannedQty

  async function save() {
    if (!ok) return
    setSaving(true)
    try {
      await supabase.from('machine_profiles').upsert({
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
      }, { onConflict: 'machine_no' })
      onSaved()
    } catch (e: any) {
      alert('บันทึกไม่สำเร็จ: ' + (e?.message ?? e))
    } finally { setSaving(false) }
  }

  const Field = ({ label, k, ph, half }: { label: string; k: keyof MachineProfile; ph?: string; half?: boolean }) => (
    <div className={half ? '' : 'col-span-2'}>
      <label className="block text-[10px] text-slate-500 mb-1">{label}</label>
      <input value={(p[k] as string) ?? ''} onChange={e => set(k, e.target.value)} placeholder={ph}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500" />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
          <div>
            <p className="text-white font-bold">กรอกข้อมูลงานใหม่ — เครื่อง {p.machine_no}</p>
            <p className="text-slate-400 text-xs">เครื่องนี้ว่าง — กรอกข้อมูลงานก่อนเริ่มชั่ง</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-3">
          <p className="text-brand-400 text-[10px] font-bold uppercase tracking-wider">ลูกค้า</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="รหัสลูกค้า" k="custCode" ph="C-001" half />
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ทศนิยม</label>
              <div className="flex gap-1">
                {([1,2] as const).map(d => (
                  <button key={d} onClick={() => set('decimal', d)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${p.decimal===d ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    {d} ตำแหน่ง
                  </button>
                ))}
              </div>
            </div>
            <Field label="ชื่อลูกค้า *" k="custName" ph="บริษัท ..." />
            <Field label="ที่อยู่"      k="custAddress" ph="" />
          </div>

          <p className="text-brand-400 text-[10px] font-bold uppercase tracking-wider pt-2">สินค้า</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mat Code *"      k="matCode"     ph="60004224"      half />
            <Field label="Product Code"    k="productCode" ph="60004224"      half />
            <Field label="ชื่อสินค้า *"   k="productName" ph="PE Shrink Film" />
            <Field label="กว้าง (cm)"     k="widthCm"     ph="45"             half />
            <Field label="หนา (mc)"       k="thickMc"     ph="25"             half />
            <Field label="Lot No *"       k="lotNo"       ph="69S0100010001"  half />
            <Field label="Length (Ms.)"   k="length"      ph="4800"           half />
          </div>

          <p className="text-brand-400 text-[10px] font-bold uppercase tracking-wider pt-2">เครื่อง</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Core Weight (kg)"  k="coreWeight" ph="1.25" half />
            <Field label="ผู้ตรวจสอบ"        k="inspector"  ph="" half />
            <Field label="ยอดสั่งผลิต (kg) *" k="plannedQty" ph="5000" half />
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ใบปะหน้า</label>
              <div className="flex gap-1">
                {(['long','short'] as const).map(s => (
                  <button key={s} onClick={() => set('labelSize', s)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold ${p.labelSize===s ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    {s === 'long' ? 'ยาว 165×70' : 'สั้น 76×76'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-slate-800 shrink-0">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-400 py-2.5 rounded-xl text-sm">ยกเลิก</button>
          <button onClick={save} disabled={!ok || saving}
            className="flex-[2] bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white py-2.5 rounded-xl font-bold">
            {saving ? 'บันทึก...' : '✓ บันทึก + พร้อมใช้งาน'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Weigh Page ────────────────────────────────────────────────────────────────
function WeighPage({ profile, onBack }: { profile: MachineProfile; onBack: () => void }) {
  const [gross,        setGross]        = useState(0)
  const [rollNo,       setRollNo]       = useState(1)
  const [saving,       setSaving]       = useState(false)
  const [lastRoll,     setLastRoll]     = useState<any>(null)
  const [weighedKg,    setWeighedKg]    = useState(0)
  const [weighedRolls, setWeighedRolls] = useState<any[]>([])
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closing,        setClosing]        = useState(false)
  const [inspector,    setInspector]    = useState('')
  const [inspectorSetAt, setInspectorSetAt] = useState<number>(0)
  const [showInspectorPrompt, setShowInspectorPrompt] = useState(true)
  const [inspectorInput, setInspectorInput] = useState(profile.inspector || '')

  function confirmInspector(name: string) {
    if (!name.trim()) return
    setInspector(name.trim())
    setInspectorSetAt(Date.now())
    setShowInspectorPrompt(false)
  }

  // เตือนทุก 4 ชั่วโมง
  const hoursSinceSet = inspectorSetAt ? (Date.now() - inspectorSetAt) / 3600000 : 999
  const isStale = inspector && hoursSinceSet >= 4
  const [weighType,    setWeighType]    = useState<'good'|'bad'|'scrap'>('good')
  const [scrapSub,     setScrapSub]     = useState<'scrap_clear'|'scrap_color'|'scrap_lump'>('scrap_clear')
  const [badReason,    setBadReason]    = useState('')
  const [badRollNo,    setBadRollNo]    = useState(1)  // ม้วนกรอเริ่มที่ 1 ของงานนี้
  const [stable,       setStable]       = useState(true)
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const core      = parseFloat(profile.coreWeight) || 0
  const dec       = profile.decimal
  const planned   = parseFloat(profile.plannedQty) || 0
  const net       = parseFloat(Math.max(0, gross - core).toFixed(dec))
  const remaining = Math.max(0, planned - weighedKg)
  const pct       = planned > 0 ? Math.min(100, Math.round((weighedKg / planned) * 100)) : 0
  const done      = planned > 0 && weighedKg >= planned

  useEffect(() => {
    const today = new Date(); today.setHours(0,0,0,0)
    supabase.from('production_rolls')
      .select('*')
      .eq('machine_no', profile.machine_no)
      .eq('lot_no', profile.lotNo)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) { console.warn('load rolls error:', error.message); return }
        if (!data?.length) return
        const goodRolls = (data as any[]).filter(r => r.roll_type === 'good')
        const total = goodRolls.reduce((s: number, r: any) => s + (r.weight ?? 0), 0)
        setWeighedKg(parseFloat(total.toFixed(dec)))
        setWeighedRolls(data as any[])
        const lastRollNo    = Math.max(0, ...goodRolls.map((r:any) => r.roll_no ?? 0))
        const badRolls      = (data as any[]).filter(r => r.roll_type === 'bad')
        const lastBadRollNo = Math.max(0, ...badRolls.map((r:any) => r.roll_no ?? 0))
        setRollNo(lastRollNo + 1)
        setBadRollNo(lastBadRollNo + 1)
      })
    setStable(true)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  function startIdle() {
    if (timerRef.current) clearInterval(timerRef.current)
    setStable(true)   // idle = พร้อมกด
    setGross(0)
    timerRef.current = setInterval(() => {
      const noise = (Math.random() - 0.5) * 0.03
      setGross(parseFloat(Math.max(0, noise).toFixed(dec)))
    }, 200)
  }

  function readScale() {
    if (timerRef.current) clearInterval(timerRef.current)
    const target = parseFloat((22 + Math.random() * 6).toFixed(dec))
    setGross(target)
    setStable(true)
    // jitter เบาๆ ให้เหมือนเครื่องชั่งจริง
    timerRef.current = setInterval(() => {
      const n = (Math.random() - 0.5) * 0.02
      setGross(parseFloat((target + n).toFixed(dec)))
    }, 250)
  }

  // คำนวณสรุปยอด
  const goodRolls = weighedRolls.filter((r:any)=>r?.roll_type==='good')
  const badRolls  = weighedRolls.filter((r:any)=>r?.roll_type==='bad')
  const scrapRolls= weighedRolls.filter((r:any)=>r?.roll_type?.startsWith?.('scrap'))
  const transferredKg = goodRolls.filter((r:any)=>r.transferred).reduce((s:number,r:any)=>s+(r.weight??0),0)
  const goodKg    = goodRolls.reduce((s:number,r:any)=>s+(r.weight??0),0)
  const badKg     = badRolls.reduce((s:number,r:any)=>s+(r.weight??0),0)
  const scrapKg   = scrapRolls.reduce((s:number,r:any)=>s+(r.weight??0),0)
  const totalProduced = goodKg + badKg + scrapKg
  const yieldPct  = totalProduced > 0 ? Math.round(goodKg / totalProduced * 100) : 0

  function printJobSummary() {
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) return
    const date  = new Date().toLocaleDateString('th-TH')
    const time  = new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun','Tahoma',sans-serif;font-size:11pt;color:#000;padding:10mm}
.head{text-align:center;border-bottom:2px solid #000;padding-bottom:3mm;margin-bottom:4mm}
.head h1{font-size:14pt;font-weight:800}
.head h2{font-size:18pt;font-weight:900;margin-top:2mm}
.box{border:1px solid #aaa;padding:3mm 4mm;margin-bottom:3mm}
.box h3{font-size:11pt;font-weight:700;border-bottom:1px solid #ddd;padding-bottom:1.5mm;margin-bottom:2mm}
.row{display:flex;justify-content:space-between;padding:1mm 0;font-size:10pt}
.kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;margin-bottom:3mm}
.kpi-box{border:1px solid #aaa;padding:3mm;text-align:center}
.kpi-box .lbl{font-size:8pt;color:#666;text-transform:uppercase}
.kpi-box .val{font-size:18pt;font-weight:800;color:#003087;margin-top:1mm}
.sign{display:flex;justify-content:space-around;margin-top:15mm;gap:10mm}
.sign-box{flex:1;text-align:center}
.sign-line{border-top:1px solid #000;margin-top:18mm;padding-top:1mm;font-size:9pt}
@media print{@page{size:A4;margin:10mm}}
</style></head><body>
<div class="head">
  <h1>บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด</h1>
  <h2>สรุปการผลิต — Production Report</h2>
  <p style="font-size:9pt;color:#555">วันที่ปิดงาน ${date} ${time}</p>
</div>
<div class="box">
  <h3>ข้อมูลงาน</h3>
  <div class="row"><span>ลูกค้า</span><b>${profile.custName}</b></div>
  <div class="row"><span>สินค้า</span><b>${profile.productName}</b></div>
  <div class="row"><span>Mat Code</span><b>${profile.matCode}</b></div>
  <div class="row"><span>Lot No</span><b>${profile.lotNo}</b></div>
  <div class="row"><span>เครื่อง</span><b>${profile.machine_no}</b></div>
  <div class="row"><span>ขนาด</span><b>${profile.widthCm} cm × ${profile.thickMc} mc</b></div>
</div>
<div class="kpi">
  <div class="kpi-box"><div class="lbl">ยอดสั่ง</div><div class="val">${planned.toLocaleString('th-TH')}</div><div style="font-size:8pt">Kgs.</div></div>
  <div class="kpi-box" style="background:#e8f5e9"><div class="lbl">ผลิตดี</div><div class="val">${goodKg.toLocaleString('th-TH',{minimumFractionDigits:2})}</div><div style="font-size:8pt">${goodRolls.length} ม้วน</div></div>
  <div class="kpi-box" style="background:#fff3e0"><div class="lbl">Yield</div><div class="val">${yieldPct}%</div></div>
</div>
<div class="box">
  <h3>รายละเอียดการผลิต</h3>
  <div class="row"><span>ม้วนดี</span><b style="color:#1976d2">${goodKg.toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs. (${goodRolls.length} ม้วน)</b></div>
  <div class="row"><span>ม้วนกรอ</span><b style="color:#f57c00">${badKg.toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs. (${badRolls.length} ม้วน)</b></div>
  <div class="row"><span>เศษเสีย</span><b style="color:#d32f2f">${scrapKg.toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs. (${scrapRolls.length} ถุง)</b></div>
  <div class="row" style="border-top:1px solid #000;padding-top:2mm;margin-top:1mm;font-size:12pt">
    <span><b>รวมทั้งหมด</b></span><b>${totalProduced.toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs.</b>
  </div>
</div>
<div class="box">
  <h3>การโอนเข้าคลัง</h3>
  <div class="row"><span>โอนไปแล้ว</span><b style="color:#2e7d32">${transferredKg.toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs.</b></div>
  <div class="row"><span>ยังไม่โอน</span><b>${(goodKg-transferredKg).toLocaleString('th-TH',{minimumFractionDigits:2})} Kgs.</b></div>
</div>
<div class="sign">
  <div class="sign-box"><div class="sign-line"></div><div><b>${inspector||'—'}</b></div><div style="font-size:9pt;color:#555">ผู้ตรวจสอบ</div></div>
  <div class="sign-box"><div class="sign-line"></div><div>...........................</div><div style="font-size:9pt;color:#555">หัวหน้างาน</div></div>
  <div class="sign-box"><div class="sign-line"></div><div>...........................</div><div style="font-size:9pt;color:#555">ผู้อนุมัติ</div></div>
</div>
<script>window.onload=()=>{setTimeout(()=>window.print(),400)}<\/script>
</body></html>`)
    win.document.close()
  }

  async function handleCloseJob() {
    setClosing(true)
    try {
      await supabase.from('job_summaries').insert({
        machine_no:     profile.machine_no,
        lot_no:         profile.lotNo,
        product_name:   profile.productName,
        customer:       profile.custName,
        mat_code:       profile.matCode,
        planned_qty:    planned,
        good_kg:        parseFloat(goodKg.toFixed(2)),
        good_rolls:     goodRolls.length,
        bad_kg:         parseFloat(badKg.toFixed(2)),
        bad_rolls:      badRolls.length,
        scrap_kg:       parseFloat(scrapKg.toFixed(2)),
        transferred_kg: parseFloat(transferredKg.toFixed(2)),
        yield_pct:      yieldPct,
        closed_at:      new Date().toISOString(),
        closed_by:      inspector || null,
        inspector:      inspector || null,
      })
      printJobSummary()
      // เคลียร์ข้อมูลงาน (เก็บแต่ machine_no, core_weight, label_size, locked)
      await supabase.from('machine_profiles').update({
        cust_code: '', cust_name: '', cust_address: '',
        mat_code: '', product_code: '', product_name: '',
        width_cm: '', thick_mc: '',
        lot_no: '', length: '', pcs: '',
        planned_qty: '',
        inspector: '',
      }).eq('machine_no', profile.machine_no)
      alert('✓ ปิดงานสำเร็จ — เครื่อง ' + profile.machine_no + ' พร้อมรับงานใหม่ (กรอกข้อมูลที่หน้าตั้งค่า)')
      onBack()
    } catch (e: any) {
      alert('ปิดงานไม่สำเร็จ: ' + (e?.message ?? e))
    } finally {
      setClosing(false)
      setShowCloseModal(false)
    }
  }

  const isScrap = weighType === 'scrap'
  const isGood  = weighType === 'good'
  const isBad   = weighType === 'bad'
  // เศษใช้ gross โดยตรง (มาเป็นถุง ไม่หักแกน), ม้วนดี/กรอใช้ net
  const saveWeight = isScrap ? gross : net

  async function handleSave() {
    if (saveWeight <= 0 || !stable) return
    if (!inspector.trim()) { setShowInspectorPrompt(true); return }
    if (isBad && !badReason.trim()) { alert('กรุณาระบุเหตุผลม้วนกรอ'); return }
    setSaving(true)
    try {
      const actualType = isScrap ? scrapSub : weighType
      const useRollNo  = isBad ? badRollNo : isGood ? rollNo : 0

      const { data, error: insertErr } = await supabase.from('production_rolls').insert({
        job_id:       null,
        roll_no:      useRollNo,
        roll_type:    actualType,
        weight:       parseFloat(saveWeight.toFixed(dec)),
        gross_weight: gross,
        core_weight:  isScrap ? 0 : core,
        remark:       isBad ? badReason : null,
        inspector:    inspector || null,
        machine_no:   profile.machine_no,
        lot_no:       profile.lotNo,
        product_name: profile.productName,
        customer:     profile.custName,
        section:      profile.section ?? 'blow',
      }).select().single()

      if (insertErr) throw new Error(insertErr.message)
      if (!data) throw new Error('insert returned null')
      setLastRoll({ ...data, weighType: actualType })
      setWeighedRolls(prev => [...prev, data].filter(Boolean))

      // บันทึก log ทุกการชั่ง
      supabase.from('weigh_logs').insert({
        machine_no:   profile.machine_no,
        lot_no:       profile.lotNo,
        mat_code:     profile.matCode,
        product_name: profile.productName,
        customer:     profile.custName,
        roll_no:      useRollNo,
        roll_type:    actualType,
        gross_weight: gross,
        core_weight:  isScrap ? 0 : core,
        net_weight:   parseFloat(saveWeight.toFixed(dec)),
        remark:       isBad ? badReason : null,
        inspector:    inspector || null,
      }).then(({ error }) => { if (error) console.warn('log error:', error.message) })

      if (isGood) {
        setWeighedKg(prev => parseFloat((prev + saveWeight).toFixed(dec)))
        setRollNo(r => r + 1)
        await printLabel({...profile, inspector}, rollNo, gross, saveWeight, profile.labelSize ?? 'long', 'good', '', data.id)
      } else if (isBad) {
        setBadRollNo(r => r + 1)
        await printLabel({...profile, inspector}, badRollNo, gross, saveWeight, profile.labelSize ?? 'long', 'bad', badReason, data.id)
        setBadReason('')
      } else {
        // เศษ — ไม่มี roll_no ไม่นับม้วน พิมพ์ label แยก
        await printLabel({...profile, inspector}, 0, gross, gross, profile.labelSize ?? 'long', actualType, '', data.id)
      }
      setGross(0)
    } catch (e: any) {
      alert('บันทึกไม่สำเร็จ: ' + (e?.message ?? JSON.stringify(e)))
    }
    finally { setSaving(false) }
  }

  const progressColor = done ? 'bg-green-500' : pct >= 80 ? 'bg-amber-400' : 'bg-brand-500'

  const [selectedRoll, setSelectedRoll] = useState<any>(null)

  // สร้าง URL สำหรับม้วนที่เลือก — ใช้ ID สั้นๆ เท่านั้น
  function makeRollUrl(r: any) {
    return `${window.location.origin}/?roll=${r.id}`
  }

  return (
    <div className="h-[calc(100vh-48px)] bg-[#0a0f1e] flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-brand-600 text-white font-black text-base w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
            {profile.machine_no}
          </div>
          <div>
            <p className="text-white font-bold text-sm">{profile.productName}</p>
            <p className="text-slate-400 text-xs">{profile.custName} · Lot {profile.lotNo}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Progress mini */}
          {planned > 0 && (
            <div className="text-right hidden sm:block">
              <p className="text-xs text-slate-500">{fmt(weighedKg,dec)} / {fmt(planned,dec)} Kgs.</p>
              <div className="h-1.5 bg-slate-800 rounded-full w-32 mt-1">
                <div className={`h-full rounded-full ${progressColor}`} style={{width:`${pct}%`}}/>
              </div>
            </div>
          )}
          <button onClick={() => setShowCloseModal(true)}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors font-semibold ${
              done ? 'bg-green-600 hover:bg-green-500 text-white animate-pulse' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
            }`}>
            🏁 ปิดงาน
          </button>
          <button onClick={onBack}
            className="flex items-center gap-1 text-slate-500 hover:text-white text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors">
            <ArrowLeft size={12}/> เปลี่ยนเครื่อง
          </button>
        </div>
      </div>

      {/* Body: 2 column */}
      <div className="flex flex-1 min-h-0">

        {/* ── LEFT: เครื่องชั่ง ─────────────────────────────── */}
        <div className="w-[380px] shrink-0 flex flex-col gap-2.5 p-4 border-r border-slate-800 overflow-y-auto">

          {/* Type selector */}
          {/* ผู้ตรวจสอบ — แสดง badge + เตือนเมื่อนาน */}
          <button onClick={() => { setInspectorInput(inspector); setShowInspectorPrompt(true) }}
            className={`w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 border transition-colors ${
              !inspector  ? 'bg-red-500/10 border-red-500/30 hover:bg-red-500/15' :
              isStale     ? 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15' :
                            'bg-slate-800 border-slate-700 hover:bg-slate-700/50'
            }`}>
            <div className="flex items-center gap-2 text-left">
              <span className="text-slate-500 text-xs">ผู้ตรวจสอบ:</span>
              <span className={`font-bold text-sm ${!inspector ? 'text-red-400' : isStale ? 'text-amber-300' : 'text-white'}`}>
                {inspector || '⚠️ ยังไม่ได้กรอก!'}
              </span>
              {isStale && inspector && (
                <span className="text-[10px] text-amber-400">· ผ่านมา {Math.floor(hoursSinceSet)} ชม. — กดยืนยันใหม่</span>
              )}
            </div>
            <span className="text-slate-500 text-[10px]">เปลี่ยน ▸</span>
          </button>

          <div className="grid grid-cols-3 gap-1.5">
            {([
              { key:'good',  label:'ม้วนดี',  color:'bg-brand-600 text-white',   inactive:'bg-slate-800 text-slate-400 hover:text-white' },
              { key:'bad',   label:'ม้วนกรอ', color:'bg-orange-600 text-white',  inactive:'bg-slate-800 text-slate-400 hover:text-white' },
              { key:'scrap', label:'เศษเสีย', color:'bg-amber-600 text-white',   inactive:'bg-slate-800 text-slate-400 hover:text-white' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setWeighType(t.key)}
                className={`py-2.5 rounded-xl text-sm font-bold transition-colors text-center ${weighType===t.key ? t.color : t.inactive}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* เศษ sub-select */}
          {isScrap && (
            <div className="grid grid-cols-3 gap-1">
              {([
                { key:'scrap_clear', label:'เศษใส',   color:'bg-slate-600' },
                { key:'scrap_color', label:'เศษสี',   color:'bg-purple-700' },
                { key:'scrap_lump',  label:'เศษก้อน', color:'bg-amber-700' },
              ] as const).map(s => (
                <button key={s.key} onClick={() => setScrapSub(s.key)}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${scrapSub===s.key ? s.color+' text-white' : 'bg-slate-800 text-slate-500 hover:text-white'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Bad reason */}
          {isBad && (
            <input value={badReason} onChange={e => setBadReason(e.target.value)}
              placeholder="เหตุผลม้วนกรอ (จำเป็น)..."
              className="w-full bg-slate-800 border border-orange-500/40 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-orange-500 placeholder-slate-500" />
          )}

          {/* Scale display */}
          <div className={`border-2 rounded-2xl px-5 py-6 text-center shadow-xl ${
            weighType==='good' ? 'bg-slate-900 border-slate-700' :
            weighType==='bad'  ? 'bg-orange-500/5 border-orange-500/30' :
            'bg-slate-900 border-slate-700'
          }`}>
            <p className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">Gross Weight (พิมพ์ได้)</p>
            <input
              type="number" step="0.01" inputMode="decimal"
              value={gross || ''}
              onChange={e => { setGross(parseFloat(e.target.value)||0); setStable(true) }}
              placeholder="0.00"
              className="w-full font-mono text-[72px] font-black tracking-tight leading-none mb-1 text-white bg-transparent text-center outline-none placeholder-slate-700 focus:bg-slate-800/50 rounded-xl"
            />
            <p className="text-slate-500 text-xs font-semibold mb-4">Kgs.</p>

            {!isScrap && (
              <div className="flex items-center justify-center gap-5 mb-4">
                <div className="text-center bg-slate-800 rounded-xl px-4 py-2">
                  <p className="text-slate-500 text-[9px]">Core</p>
                  <p className="text-slate-300 font-bold">{fmt(core, dec)} Kgs.</p>
                </div>
                <span className="text-slate-700 text-xl">−</span>
                <div className="text-center">
                  <p className="text-slate-500 text-[9px]">Net</p>
                  <p className="text-brand-400 font-black text-3xl">{fmt(net, dec)}</p>
                  <p className="text-brand-400/60 text-xs">Kgs.</p>
                </div>
              </div>
            )}
            {isScrap && (
              <div className="text-center mb-4">
                <p className="text-slate-500 text-xs">น้ำหนักเศษ (Gross)</p>
                <p className="text-amber-400 font-black text-3xl">{fmt(gross, dec)} Kgs.</p>
              </div>
            )}

            <button onClick={readScale}
              className="w-full py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-500 hover:text-white transition-colors">
              <RefreshCw size={11}/> สุ่มค่าทดสอบ
            </button>
          </div>

          {/* Roll No + Save */}
          <div className="flex items-center gap-2">
            {(isGood || isBad) && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 flex items-center gap-2 shrink-0">
                <span className="text-slate-500 text-xs">{isBad ? 'กรอ' : 'Roll'}</span>
                <span className="text-white font-black w-7 text-center">
                  {isBad ? badRollNo : rollNo}
                </span>
              </div>
            )}
            <button onClick={handleSave} disabled={saving || saveWeight <= 0 || !stable || (isBad && !badReason.trim())}
              className={`flex-1 py-3 rounded-xl text-white font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40 ${
                !stable ? 'bg-slate-700 cursor-not-allowed' :
                isGood  ? 'bg-brand-600 hover:bg-brand-500' :
                isBad   ? 'bg-orange-600 hover:bg-orange-500' :
                          'bg-amber-600 hover:bg-amber-500'
              }`}>
              <Save size={17}/>
              {saving ? 'บันทึก...' : !stable ? 'รอค่านิ่ง...' :
                isScrap ? `บันทึกเศษ ${fmt(gross,dec)} Kgs.` :
                isBad   ? `กรอ #${badRollNo} · ${fmt(saveWeight,dec)} Kgs.` :
                          `Roll #${rollNo} · ${fmt(saveWeight,dec)} Kgs.`}
            </button>
          </div>

          {/* hint ทำไมกดไม่ได้ */}
          {(saveWeight <= 0 || !stable || (isBad && !badReason.trim())) && (
            <p className="text-center text-slate-600 text-xs">
              {!stable ? '⟳ รอค่าชั่งนิ่งก่อน' :
               saveWeight <= 0 ? '▲ พิมพ์น้ำหนักหรือกดสุ่มค่าก่อน' :
               isBad && !badReason.trim() ? '▲ กรอกเหตุผลม้วนกรอก่อน' : ''}
            </p>
          )}

          {/* Last saved */}
          {lastRoll && (
            <div className={`rounded-xl px-4 py-2.5 flex items-center gap-2 border ${
              (lastRoll.weighType||lastRoll.roll_type)==='good' ? 'bg-green-500/10 border-green-500/25' :
              (lastRoll.weighType||lastRoll.roll_type)==='bad'  ? 'bg-orange-500/10 border-orange-500/25' :
              'bg-slate-800 border-slate-700'
            }`}>
              <CheckCircle2 size={14} className="text-green-400 shrink-0"/>
              <p className="text-green-300 text-sm font-semibold truncate">
                {(lastRoll.weighType||lastRoll.roll_type)==='good' ? `Roll ${lastRoll.roll_no} · ${fmt(lastRoll.weight,dec)} Kgs. ✓` :
                 (lastRoll.weighType||lastRoll.roll_type)==='bad'  ? `กรอ Roll ${lastRoll.roll_no} · ${fmt(lastRoll.weight,dec)} Kgs.` :
                 `เศษ · ${fmt(lastRoll.weight||lastRoll.gross_weight,dec)} Kgs.`}
              </p>
            </div>
          )}

          {/* Progress */}
          {planned > 0 && (
            <div className={`rounded-xl p-3 border ${done ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-900 border-slate-800'}`}>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-400">ชั่งแล้ว <b className={done?'text-green-300':'text-white'}>{fmt(weighedKg,dec)}</b></span>
                <span className={done ? 'text-green-400 font-bold' : 'text-brand-300'}>{done ? '✓ ครบ' : `เหลือ ${fmt(remaining,dec)}`}</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${progressColor}`} style={{width:`${pct}%`}}/>
              </div>
              <p className="text-slate-600 text-[10px] mt-1">{weighedRolls.filter((r:any)=>r?.roll_type==='good').length} ม้วนดี · {pct}% · เป้า {fmt(planned,dec)} Kgs.</p>
            </div>
          )}
        </div>

        {/* ── RIGHT: ตารางแยก ──────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Summary bar */}
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900 flex gap-4 shrink-0 text-xs">
            <span className="text-slate-500">ม้วนดี <b className="text-brand-300">{weighedRolls.filter((r:any)=>r?.roll_type==='good').length} ม้วน · {fmt(weighedKg,dec)} Kgs.</b></span>
            <span className="text-slate-700">|</span>
            <span className="text-slate-500">ม้วนกรอ <b className="text-orange-300">{weighedRolls.filter((r:any)=>r?.roll_type==='bad').length} ม้วน · {fmt(weighedRolls.filter((r:any)=>r?.roll_type==='bad').reduce((s:number,r:any)=>s+(r.weight??0),0),dec)} Kgs.</b></span>
            <span className="text-slate-700">|</span>
            {(() => {
              const clear = weighedRolls.filter((r:any)=>r?.roll_type==='scrap_clear')
              const color = weighedRolls.filter((r:any)=>r?.roll_type==='scrap_color')
              const lump  = weighedRolls.filter((r:any)=>r?.roll_type==='scrap_lump')
              const sum   = (a:any[]) => a.reduce((s:number,r:any)=>s+(r.weight??0),0)
              const total = sum(clear)+sum(color)+sum(lump)
              return (
                <span className="relative group">
                  <span className="text-slate-500 cursor-help">เศษรวม <b className="text-amber-300 underline decoration-dotted">{fmt(total,dec)} Kgs.</b></span>
                  <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-20 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 shadow-2xl whitespace-nowrap">
                    <p className="text-amber-400 text-[10px] font-bold uppercase mb-1.5">แยกตามประเภท</p>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between gap-6">
                        <span className="text-slate-400">เศษใส <span className="text-slate-600">({clear.length})</span></span>
                        <b className="text-slate-200">{fmt(sum(clear),dec)} Kgs.</b>
                      </div>
                      <div className="flex justify-between gap-6">
                        <span className="text-slate-400">เศษสี <span className="text-slate-600">({color.length})</span></span>
                        <b className="text-purple-300">{fmt(sum(color),dec)} Kgs.</b>
                      </div>
                      <div className="flex justify-between gap-6">
                        <span className="text-slate-400">เศษก้อน <span className="text-slate-600">({lump.length})</span></span>
                        <b className="text-amber-300">{fmt(sum(lump),dec)} Kgs.</b>
                      </div>
                      <div className="flex justify-between gap-6 border-t border-slate-700 pt-1 mt-1">
                        <span className="text-slate-300 font-semibold">รวม</span>
                        <b className="text-amber-300">{fmt(total,dec)} Kgs.</b>
                      </div>
                    </div>
                  </div>
                </span>
              )
            })()}
          </div>

          {/* 2 tables side by side */}
          <div className="flex flex-1 min-h-0 divide-x divide-slate-800">

            {/* ── ม้วนดี ─────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-3 py-2 bg-brand-500/10 border-b border-brand-500/20 shrink-0">
                <span className="text-brand-300 text-xs font-bold">● ม้วนดี</span>
              </div>
              <div className="grid grid-cols-4 border-b border-slate-800 bg-slate-800/20 shrink-0">
                {['เวลา','ม้วน','นน.เต็ม','นน.สุทธิ'].map(h=>(
                  <div key={h} className="px-3 py-1.5 text-slate-500 text-[9px] font-semibold uppercase">{h}</div>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
                {[...weighedRolls].filter((r:any)=>r.roll_type==='good').reverse().map((r:any) => {
                  const isNew  = lastRoll?.id === r.id
                  const isDone = r.transferred
                  const time   = new Date(r.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
                  return (
                    <div key={r.id} onClick={()=>setSelectedRoll(r)}
                      className={`grid grid-cols-4 hover:bg-slate-800/40 cursor-pointer transition-colors ${isNew?'bg-green-500/5':''} ${isDone?'opacity-60':''}`}>
                      <div className={`px-3 py-2.5 text-xs ${isDone?'text-slate-600 line-through':'text-slate-500'}`}>{time}</div>
                      <div className="px-3 py-2.5">
                        <span className={`font-bold font-mono ${isDone?'text-slate-500 line-through':'text-white'}`}>#{r.roll_no}</span>
                        {isNew && <span className="ml-1 text-[9px] text-green-400">NEW</span>}
                        {isDone && <span className="ml-1 text-[9px] text-green-400">📦</span>}
                      </div>
                      <div className={`px-3 py-2.5 text-xs ${isDone?'text-slate-600 line-through':'text-slate-400'}`}>{fmt((r.weight??0)+(r.core_weight??0),dec)}</div>
                      <div className={`px-3 py-2.5 font-black ${isDone?'text-slate-600 line-through':'text-brand-300'}`}>{fmt(r.weight??0,dec)}</div>
                    </div>
                  )
                })}
                {weighedRolls.filter((r:any)=>r?.roll_type==='good').length===0 && (
                  <div className="py-8 text-center text-slate-600 text-xs">ยังไม่มีม้วนดี</div>
                )}
              </div>
              {/* good footer */}
              <div className="border-t border-slate-800 px-3 py-1.5 bg-slate-900 flex justify-between text-xs shrink-0">
                <span className="text-slate-500">{weighedRolls.filter((r:any)=>r?.roll_type==='good').length} ม้วน</span>
                <span className="text-brand-300 font-black">{fmt(weighedKg,dec)} Kgs.</span>
              </div>
            </div>

            {/* ── ม้วนกรอ ────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-3 py-2 bg-orange-500/10 border-b border-orange-500/20 shrink-0">
                <span className="text-orange-300 text-xs font-bold">● ม้วนกรอ</span>
              </div>
              <div className="grid grid-cols-4 border-b border-slate-800 bg-slate-800/20 shrink-0">
                {['เวลา','ม้วน','นน.กรอ','เหตุผล'].map(h=>(
                  <div key={h} className="px-3 py-1.5 text-slate-500 text-[9px] font-semibold uppercase">{h}</div>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
                {[...weighedRolls].filter((r:any)=>r.roll_type==='bad').reverse().map((r:any) => {
                  const isNew = lastRoll?.id === r.id
                  const time  = new Date(r.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
                  return (
                    <div key={r.id} onClick={()=>setSelectedRoll(r)}
                      className={`grid grid-cols-4 hover:bg-slate-800/40 cursor-pointer transition-colors ${isNew?'bg-orange-500/5':''}`}>
                      <div className="px-3 py-2.5 text-slate-500 text-xs">{time}</div>
                      <div className="px-3 py-2.5">
                        <span className="text-orange-200 font-bold font-mono">#{r.roll_no}</span>
                        {isNew && <span className="ml-1 text-[9px] text-orange-400">NEW</span>}
                      </div>
                      <div className="px-3 py-2.5 text-orange-300 font-black">{fmt(r.weight??0,dec)}</div>
                      <div className="px-3 py-2.5 text-slate-400 text-xs truncate">{r.remark||'—'}</div>
                    </div>
                  )
                })}
                {weighedRolls.filter((r:any)=>r?.roll_type==='bad').length===0 && (
                  <div className="py-8 text-center text-slate-600 text-xs">ยังไม่มีม้วนกรอ</div>
                )}
              </div>
              {/* bad footer + scrap summary */}
              <div className="border-t border-slate-800 px-3 py-1.5 bg-slate-900 flex justify-between text-xs shrink-0">
                <span className="text-slate-500">{weighedRolls.filter((r:any)=>r?.roll_type==='bad').length} ม้วน</span>
                <span className="text-orange-300 font-black">{fmt(weighedRolls.filter((r:any)=>r?.roll_type==='bad').reduce((s:number,r:any)=>s+(r.weight??0),0),dec)} Kgs.</span>
              </div>
              {/* เศษ summary */}
              {weighedRolls.some((r:any)=>r.roll_type?.startsWith('scrap')) && (
                <div className="border-t border-slate-700 bg-slate-800/30 px-3 py-2 space-y-1 shrink-0">
                  <p className="text-amber-400 text-[9px] font-bold uppercase">เศษเสีย</p>
                  {(['scrap_clear','scrap_color','scrap_lump'] as const).map(t => {
                    const rows = weighedRolls.filter((r:any)=>r.roll_type===t)
                    if (!rows.length) return null
                    const label = t==='scrap_clear'?'ใส':t==='scrap_color'?'สี':'ก้อน'
                    const total = rows.reduce((s:number,r:any)=>s+(r.weight??0),0)
                    return (
                      <div key={t} className="flex justify-between text-xs">
                        <span className="text-slate-500">เศษ{label} ({rows.length})</span>
                        <span className="text-amber-300 font-semibold">{fmt(total,dec)} Kgs.</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* ── Modal: ประวัติม้วน ─────────────────────────────── */}
      {/* ── Modal ปิดงาน ─────────────────────────────────── */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border-2 border-green-500/40 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800">
              <p className="text-white font-bold text-lg flex items-center gap-2">🏁 ปิดงาน · พิมพ์สรุปการผลิต</p>
              <p className="text-slate-400 text-xs mt-1">{profile.productName} · Lot {profile.lotNo}</p>
            </div>

            <div className="px-6 py-4 space-y-3">
              {/* KPI */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-800 rounded-xl p-3 text-center">
                  <p className="text-slate-500 text-[10px]">ยอดสั่ง</p>
                  <p className="text-white font-black text-xl">{fmt(planned,dec)}</p>
                  <p className="text-slate-600 text-[9px]">Kgs.</p>
                </div>
                <div className="bg-green-500/10 border border-green-500/25 rounded-xl p-3 text-center">
                  <p className="text-green-400 text-[10px]">ผลิตดี</p>
                  <p className="text-green-300 font-black text-xl">{fmt(goodKg,dec)}</p>
                  <p className="text-slate-500 text-[9px]">{goodRolls.length} ม้วน</p>
                </div>
                <div className="bg-brand-500/10 border border-brand-500/25 rounded-xl p-3 text-center">
                  <p className="text-brand-400 text-[10px]">Yield</p>
                  <p className="text-brand-300 font-black text-xl">{yieldPct}%</p>
                  <p className="text-slate-500 text-[9px]">เทียบผลิตรวม</p>
                </div>
              </div>

              {/* Details */}
              <div className="bg-slate-800 rounded-xl p-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">ม้วนกรอ</span><b className="text-orange-300">{fmt(badKg,dec)} Kgs. ({badRolls.length})</b></div>
                <div className="flex justify-between"><span className="text-slate-400">เศษเสีย</span><b className="text-amber-300">{fmt(scrapKg,dec)} Kgs. ({scrapRolls.length})</b></div>
                <div className="flex justify-between border-t border-slate-700 pt-1.5"><span className="text-slate-400">โอนเข้าคลัง</span><b className="text-green-300">{fmt(transferredKg,dec)} Kgs.</b></div>
                <div className="flex justify-between"><span className="text-slate-400">ยังไม่โอน</span><b className="text-amber-300">{fmt(goodKg-transferredKg,dec)} Kgs.</b></div>
              </div>

              {goodKg-transferredKg > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2 text-xs text-amber-300">
                  ⚠️ ยังมี <b>{fmt(goodKg-transferredKg)} Kgs.</b> ที่ยังไม่ได้โอนเข้าคลัง
                </div>
              )}
              <p className="text-slate-500 text-xs text-center">เลือกการดำเนินการ:</p>
            </div>

            <div className="flex gap-2 px-6 py-4 border-t border-slate-800">
              <button onClick={() => setShowCloseModal(false)} disabled={closing}
                className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-400 py-3 rounded-xl text-sm transition-colors">
                ยกเลิก
              </button>
              <button onClick={handleCloseJob} disabled={closing}
                className="flex-[2] bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-3 rounded-xl font-bold transition-colors">
                {closing ? 'กำลังปิด...' : '🏁 ปิดงาน + เริ่มงานใหม่'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal บังคับกรอกผู้ตรวจสอบ ─────────────────── */}
      {showInspectorPrompt && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
          <div className="bg-slate-900 border-2 border-brand-500/40 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-5 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-brand-500/20 flex items-center justify-center mb-3">
                <span className="text-3xl">👤</span>
              </div>
              <p className="text-white font-bold text-lg">ผู้ตรวจสอบกะนี้คือใคร?</p>
              <p className="text-slate-400 text-sm mt-1">{profile.machine_no} · {profile.productName}</p>
              {isStale && inspector && (
                <p className="text-amber-400 text-xs mt-2">⚠️ ผ่านมา {Math.floor(hoursSinceSet)} ชั่วโมง — เปลี่ยนกะหรือยัง?</p>
              )}

              <input value={inspectorInput} onChange={e => setInspectorInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmInspector(inspectorInput) }}
                placeholder="ชื่อผู้ตรวจสอบ..."
                autoFocus
                className="w-full mt-4 bg-slate-800 border-2 border-slate-700 rounded-xl px-4 py-3 text-white text-lg text-center outline-none focus:border-brand-500" />
            </div>
            <div className="flex gap-2 px-6 py-4 border-t border-slate-800">
              {inspector && (
                <button onClick={() => setShowInspectorPrompt(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-400 py-2.5 rounded-xl text-sm">
                  ยังเป็นคนเดิม ({inspector})
                </button>
              )}
              <button onClick={() => confirmInspector(inspectorInput)}
                disabled={!inspectorInput.trim()}
                className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white py-2.5 rounded-xl font-bold transition-colors">
                ✓ ยืนยัน
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRoll && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedRoll(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div>
                <p className="text-white font-bold">Roll #{selectedRoll.roll_no}</p>
                <p className="text-slate-400 text-xs">{profile.machine_no} · {profile.lotNo}</p>
              </div>
              <button onClick={() => setSelectedRoll(null)}>
                <X size={18} className="text-slate-400 hover:text-white"/>
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {/* น้ำหนัก 3 ค่า */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label:'นน.เต็ม',  val: fmt((selectedRoll.weight??0)+(selectedRoll.core_weight??0), dec), cls:'text-slate-300 text-lg' },
                  { label:'นน.แกน',   val: fmt(selectedRoll.core_weight??0, dec),  cls:'text-slate-500 text-lg' },
                  { label:'นน.สุทธิ', val: fmt(selectedRoll.weight??0, dec),       cls:'text-brand-400 font-black text-2xl' },
                ].map(item => (
                  <div key={item.label} className="bg-slate-800 rounded-xl py-3">
                    <p className="text-slate-500 text-[9px] mb-1">{item.label}</p>
                    <p className={`font-bold ${item.cls}`}>{item.val}</p>
                    <p className="text-slate-600 text-[9px]">Kgs.</p>
                  </div>
                ))}
              </div>

              {/* รายละเอียด */}
              <div className="bg-slate-800 rounded-xl px-4 py-3 space-y-2">
                {[
                  { k:'ลูกค้า',      v: profile.custName },
                  { k:'สินค้า',      v: profile.productName },
                  { k:'Mat Code',    v: profile.matCode,    mono:true },
                  { k:'Lot No',      v: profile.lotNo,      mono:true },
                  { k:'ขนาด',        v: profile.widthCm && profile.thickMc ? `${profile.widthCm} cm × ${profile.thickMc} mc` : '—' },
                  { k:'ความยาว',     v: profile.length ? `${profile.length} Ms.` : '—' },
                  { k:'เครื่อง',     v: profile.machine_no },
                  { k:'ผู้ตรวจสอบ', v: selectedRoll.inspector || profile.inspector || '—' },
                  { k:'วันที่ชั่ง',  v: `${new Date(selectedRoll.created_at).toLocaleDateString('th-TH')} ${new Date(selectedRoll.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}` },
                ].map(row => (
                  <div key={row.k} className="flex justify-between items-baseline gap-2">
                    <span className="text-slate-500 text-xs shrink-0">{row.k}</span>
                    <span className={`text-right text-sm font-semibold text-slate-200 truncate ${(row as any).mono ? 'font-mono' : ''}`}>{row.v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Reprint */}
            <div className="flex gap-2 px-5 py-4 border-t border-slate-800">
              <button onClick={() => printLabel({...profile, inspector: selectedRoll.inspector || profile.inspector}, selectedRoll.roll_no, selectedRoll.gross_weight??0, selectedRoll.weight??0, 'short', selectedRoll.roll_type, selectedRoll.remark??'', selectedRoll.id)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-sm py-2.5 rounded-xl transition-colors">
                <Printer size={14}/> ใบสั้น
              </button>
              <button onClick={() => printLabel({...profile, inspector: selectedRoll.inspector || profile.inspector}, selectedRoll.roll_no, selectedRoll.gross_weight??0, selectedRoll.weight??0, 'long', selectedRoll.roll_type, selectedRoll.remark??'', selectedRoll.id)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm py-2.5 rounded-xl transition-colors font-semibold">
                <Printer size={14}/> ใบยาว
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WeighStation({ dept }: { dept?: 'blow' | 'print' }) {
  const [selected, setSelected] = useState<MachineProfile | null>(null)
  const [profiles, setProfiles] = useState<MachineProfile[]>(loadProfiles())

  function reload() {
    supabase.from('machine_profiles').select('*').order('machine_no')
      .then(({ data }) => {
        if (!data) return
        const list = data.map((r: any) => ({
          machine_no:  r.machine_no,
          custCode:    r.cust_code    ?? '',
          custName:    r.cust_name    ?? '',
          custAddress: r.cust_address ?? '',
          decimal:    (r.decimal_places ?? 2) as 1|2,
          matCode:     r.mat_code     ?? '',
          productCode: r.product_code ?? '',
          productName: r.product_name ?? '',
          widthCm:     r.width_cm     ?? '',
          thickMc:     r.thick_mc     ?? '',
          lotNo:       r.lot_no       ?? '',
          length:      r.length       ?? '',
          pcs:         r.pcs          ?? '',
          coreWeight:  r.core_weight  ?? '1.25',
          inspector:   r.inspector    ?? '',
          locked:      r.locked       ?? false,
          plannedQty:  r.planned_qty  ?? '',
          labelSize:  (r.label_size   ?? 'long') as 'long'|'short',
          section:    (r.section      ?? 'blow') as 'blow'|'print',
        }))
        setProfiles(list)
        saveProfiles(list)
      })
  }

  useEffect(() => { reload() }, [])

  // filter เครื่องตาม dept
  const filtered = dept ? profiles.filter(p => (p.section ?? 'blow') === dept) : profiles

  if (!selected) return <MachinePicker profiles={filtered} onSelect={setSelected} onProfileUpdated={reload} dept={dept} />
  return <WeighPage profile={selected} onBack={() => { setSelected(null); reload() }} />
}
