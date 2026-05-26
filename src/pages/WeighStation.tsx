import { useState, useEffect, useRef } from 'react'
import { Save, Printer, RefreshCw, CheckCircle2, ArrowLeft, Wind, X, Settings } from 'lucide-react'
import QRCode from 'react-qr-code'
import QRCodeLib from 'qrcode'
import { supabase } from '../lib/supabase'
import { loadProfiles, saveProfiles, type MachineProfile } from './MachineSettings'
import { loadLongLayout, type FieldConfig } from './LabelDesigner'
import { fetchProducts, type Product } from './Products'

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
  // ใบยาว — สร้างจาก LabelDesigner layout (หรือ fallback default)
  // ═══════════════════════════════════════════════════════
  const savedLayout = await loadLongLayout()
  const rollTypeLabelLong =
    rollType === 'bad'         ? 'ม้วนกรอ' :
    rollType === 'scrap_clear' ? 'เศษเสีย (ใส)' :
    rollType === 'scrap_color' ? 'เศษเสีย (สี)' :
    rollType === 'scrap_lump'  ? 'เศษก้อน' : ''

  // ค่าจริงของแต่ละ field id → map จาก MachineProfile + น้ำหนัก
  const rollLabel = rollType.startsWith('scrap') ? 'ถุงเศษ' : rollType === 'bad' ? 'กรอ No.' : 'Roll No.'
  const longFieldData: Record<string, string> = {
    header:      (p.headerText?.trim() || 'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด') +
                 (rollTypeLabelLong ? `&nbsp;&nbsp;[${rollTypeLabelLong}]` : ''),
    // 3-column header
    mat:         `Mat Code&nbsp;&nbsp;<b style="font-size:1.15em">${p.matCode}</b>`,
    mfg:         `MFG Date&nbsp;&nbsp;<b style="font-size:1.15em">${mfgDate}</b>`,
    rollno:      `${rollLabel}&nbsp;&nbsp;<b style="font-size:1.15em">${rollNo === 0 ? '—' : rollNo}</b>`,
    // left column
    prodcode:    `Product Code&nbsp;&nbsp;<b>${p.productCode || p.matCode}</b>`,
    prodname:    p.productName,
    machine:     `เครื่อง&nbsp;&nbsp;<b>${p.machine_no}</b>`,
    core:        `Core Weight&nbsp;&nbsp;<b>${fmt(core, dec)}</b>`,
    size:        `Size&nbsp;&nbsp;<b style="font-size:1.2em">${p.widthCm}</b>&nbsp;cm&nbsp;×&nbsp;<b style="font-size:1.2em">${p.thickMc}</b>&nbsp;mc`,
    // right column
    lotno:       `Lot No&nbsp;&nbsp;<b>${p.lotNo}</b>`,
    length:      `Length&nbsp;&nbsp;<b>${p.length || '—'}</b>&nbsp;M.${p.pcs ? `&nbsp;&nbsp;<b>${p.pcs}</b>&nbsp;Pcs.` : ''}`,
    gross:       `Gross Weight&nbsp;&nbsp;<b>${fmt(gross, dec)} Kgs.</b>`,
    net:         fmt(net, dec),
    barcode_lbl: 'Barcode No.',
    inspector:   `ผู้ตรวจสอบ&nbsp;&nbsp;<b>${p.inspector || '—'}</b>`,
    // old compat keys
    meta:        `Mat&nbsp;<b>${p.matCode}</b>&nbsp;&nbsp;&nbsp;MFG&nbsp;<b>${mfgDate}</b>&nbsp;&nbsp;&nbsp;Roll&nbsp;<b>${rollNo === 0 ? '—' : rollNo}</b>`,
  }

  function renderLongField(f: FieldConfig): string {
    if (!f.visible) return ''

    // separator: ถ้า h > w → เส้นตั้ง (vsep), ถ้า h ≈ 0 → เส้นนอน
    if (f.type === 'separator') {
      if (f.h > f.w) {
        // เส้นตั้ง
        return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:0;height:${f.h}mm;border-left:1px solid #000;box-sizing:border-box"></div>`
      }
      return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:0;border-top:1px solid #000;box-sizing:border-box"></div>`
    }

    if (f.type === 'qr') {
      const px = Math.round(f.h * 3.78)
      return `<img src="${qrUrl(72)}" width="${px}" height="${px}" style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;image-rendering:pixelated"/>`
    }

    const value   = longFieldData[f.id] ?? f.sampleValue
    const border  = f.border ? 'border:1px solid #000;' : ''
    const justify = f.align === 'center' ? 'justify-content:center;' : f.align === 'right' ? 'justify-content:flex-end;' : ''
    const italic  = f.italic ? 'font-style:italic;' : ''

    if (f.type === 'weight') {
      return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;${border}box-sizing:border-box;overflow:hidden;padding:0 1mm">
        <div style="font-size:7.5pt;font-weight:700;line-height:1.4">Net Weight</div>
        <div style="font-size:${f.fontSize}pt;font-weight:900;line-height:1;color:#003087">${value}</div>
        <div style="font-size:8pt;font-weight:700;line-height:1.3">Kgs.</div>
      </div>`
    }

    return `<div style="position:absolute;left:${f.x}mm;top:${f.y}mm;width:${f.w}mm;height:${f.h}mm;font-size:${f.fontSize}pt;font-weight:${f.fontWeight};text-align:${f.align};${italic}${border}box-sizing:border-box;overflow:hidden;display:flex;align-items:center;${justify}padding:0 0.5mm">${value}</div>`
  }

  const longHtmlFromLayout = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#fff;width:${savedLayout.labelW}mm;height:${savedLayout.labelH}mm}
@media print{@page{size:${savedLayout.labelW}mm ${savedLayout.labelH}mm;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
<div style="position:relative;width:${savedLayout.labelW}mm;height:${savedLayout.labelH}mm;border:1.5px solid #000;overflow:hidden">
${savedLayout.fields.map(renderLongField).join('\n')}
</div>`

  // ═══════════════════════════════════════════════════════
  // ใบยาว 165 × 70 mm (fallback default — ไม่ถูกใช้แล้ว เก็บไว้เผื่อ)
  // ═══════════════════════════════════════════════════════
  const longHtml = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#fff;width:165mm;height:70mm}
.wrap{width:165mm;height:70mm;padding:.8mm 2mm;display:flex;flex-direction:column;border:2px solid #000;overflow:hidden}

/* ── Row 1: หัวกระดาษ ── */
.title{text-align:center;font-size:11pt;font-weight:700;border-bottom:2px solid #000;padding-bottom:.5mm;margin-bottom:.5mm;line-height:1.25;letter-spacing:.2px}

/* ── Row 2: Mat / MFG / Roll ── */
.hdr{display:flex;border-bottom:1px solid #000;padding-bottom:.4mm;margin-bottom:.4mm;align-items:center}
.hc{flex:1;font-size:7pt;color:#444}
.hc b{font-size:9.5pt;font-weight:700;color:#000;margin-left:.5mm}
.hc.mid{text-align:center;border-left:1px solid #bbb;border-right:1px solid #bbb;padding:0 2mm}
.hc.right{text-align:right}

/* ── Row 3: Product name + Size + Lot ── */
.prod-row{display:flex;align-items:baseline;border-bottom:1px solid #ddd;padding-bottom:.4mm;margin-bottom:.4mm;gap:1.5mm;flex-wrap:nowrap;overflow:hidden}
.pname{font-size:11pt;font-weight:800;white-space:nowrap;flex-shrink:0}
.pdot{color:#bbb;font-size:9pt;flex-shrink:0}
.psize{font-size:8.5pt;font-weight:700;white-space:nowrap;flex-shrink:0}
.plot{margin-left:auto;font-size:7.5pt;font-weight:700;white-space:nowrap;flex-shrink:0;color:#333}

/* ── Row 4-5: info rows ── */
.irow{display:flex;justify-content:space-between;font-size:7.5pt;padding:.25mm 0;border-bottom:.5px solid #eee}
.il{color:#444}
.il b{color:#000;font-weight:700}
.ir{color:#444;text-align:right}
.ir b{color:#000;font-weight:700}

/* ── Row 6: Weight + QR ── */
.wsec{flex:1;display:flex;border-top:2px solid #000;margin-top:.3mm;min-height:0;overflow:hidden}
.wleft{flex:1;display:flex;flex-direction:column;padding-right:1.5mm;padding-top:.3mm;overflow:hidden}
.wlbl{font-size:6pt;font-weight:600;color:#555;letter-spacing:.3px;text-transform:uppercase;line-height:1.2}
.wnum{font-size:17pt;font-weight:800;line-height:1;color:#001a5c;letter-spacing:-1px}
.wunit{font-size:7.5pt;font-weight:700;margin-top:.1mm;line-height:1.2}
.wgross{font-size:7pt;font-weight:600;color:#333;margin-top:.3mm;border-top:.5px solid #ccc;padding-top:.2mm;line-height:1.2}
.wbc{margin-top:auto}
.wbclbl{font-size:6pt;color:#666;margin-bottom:.2mm;line-height:1.2}
.wbcline{border-bottom:1px solid #000;width:24mm;height:2mm}
.winsp{font-size:8pt;font-weight:700;margin-top:.8mm}
.qrbox{width:22mm;display:flex;align-items:center;justify-content:center;border-left:1px solid #ddd;padding-left:1.5mm;flex-shrink:0}

@media print{@page{size:165mm 70mm;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>

<div class="wrap">

  <!-- Row 1: หัวกระดาษ -->
  <div class="title">
    ${p.blankHeader ? '' : (p.headerText?.trim() || 'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด')}
    ${rollType !== 'good' ? `<span style="font-size:8pt;font-weight:700;margin-left:3mm">[${rollTypeLabelLong}]</span>` : ''}
  </div>
  ${reason ? `<div style="font-size:7pt;color:#c00;text-align:center;line-height:1.2;margin-bottom:.3mm">เหตุผล: ${reason}</div>` : ''}

  <!-- Row 2: Mat / MFG / Roll -->
  <div class="hdr">
    <div class="hc"><span>Mat</span><b>${p.matCode}</b></div>
    <div class="hc mid"><span>MFG</span><b>${mfgDate}</b></div>
    <div class="hc right"><span>${rollType.startsWith('scrap') ? 'ถุง' : rollType==='bad' ? 'กรอ' : 'Roll'}</span><b>${rollNo===0?'—':rollNo}</b></div>
  </div>

  <!-- Row 3: Product + Size + Lot -->
  <div class="prod-row">
    <span class="pname">${p.productName}</span>
    <span class="pdot">·</span>
    <span class="psize">${p.widthCm} cm × ${p.thickMc} mc</span>
    <span class="plot">Lot: ${p.lotNo}</span>
  </div>

  <!-- Row 4: Code + Length -->
  <div class="irow">
    <span class="il">Code&nbsp;<b>${p.productCode||p.matCode}</b></span>
    <span class="ir">Length&nbsp;<b>${p.length||'—'} M.</b>${p.pcs ? `&nbsp;&nbsp;Pcs.&nbsp;<b>${p.pcs}</b>` : ''}</span>
  </div>

  <!-- Row 5: Machine + Core -->
  <div class="irow" style="border-bottom:none">
    <span class="il">เครื่อง&nbsp;<b>${p.machine_no}</b></span>
    <span class="ir">Core&nbsp;<b>${fmt(core,dec)} Kg</b></span>
  </div>

  <!-- Row 6: Weight + QR -->
  <div class="wsec">
    <div class="wleft">
      <div class="wlbl">Net Weight</div>
      <div class="wnum">${fmt(net,dec)}</div>
      <div class="wunit">Kgs.</div>
      <div class="wgross">Gross&nbsp;&nbsp;${fmt(gross,dec)} Kgs.</div>
      <div class="wbc">
        <div class="wbclbl">Barcode No.</div>
        <div class="wbcline"></div>
        <div class="winsp">ผู้ตรวจสอบ&nbsp;&nbsp;${p.inspector||'—'}</div>
      </div>
    </div>
    <div class="qrbox">
      <img src="${qrUrl(72)}" width="76" height="76" style="image-rendering:pixelated;display:block"/>
    </div>
  </div>

</div>`

  // ═══════════════════════════════════════════════════════
  // ใบสั้น 76.2 × 76.2 mm (square) — รายละเอียดครบเหมือนใบยาว
  // หัวกระดาษ: ใช้ p.headerText (ว่าง = เว้น)
  // ═══════════════════════════════════════════════════════
  const hdr = p.blankHeader ? '' : ((p.headerText || '').trim() || 'บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด')
  const rollTypeLabel = rollType === 'bad' ? 'กรอ' : rollType === 'scrap_clear' ? 'เศษใส' : rollType === 'scrap_color' ? 'เศษสี' : rollType === 'scrap_lump' ? 'เศษก้อน' : ''
  const shortHtml = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800;900&display=swap');
/* 203 DPI thermal */
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Sarabun','Arial',sans-serif;color:#000;background:#fff;width:76.2mm;height:76.2mm}
.page{width:76.2mm;height:76.2mm;display:flex;flex-direction:column;border:2px solid #000;overflow:hidden}
.hdr{text-align:center;font-size:10.5pt;font-weight:900;padding:.7mm 2mm;border-bottom:2px solid #000;letter-spacing:.3px;line-height:1.2}
.meta{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding:.5mm 2mm;font-size:8pt;font-weight:700}
.meta b{font-size:9.5pt;font-weight:900}
.body{flex:1;padding:.3mm 2mm;display:flex;flex-direction:column;overflow:hidden}
.r{display:flex;justify-content:space-between;align-items:baseline;font-size:8.5pt;font-weight:700;line-height:1.35}
.r .k{flex-shrink:0;min-width:16mm}
.r .v{font-weight:900;text-align:right;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.r .v.xl{font-size:10pt;font-weight:900}
.sep{border-top:2px solid #000;margin:.2mm 0}
.wrow{display:flex;justify-content:space-between;align-items:center;border-top:2px solid #000;border-bottom:2px solid #000;padding:.7mm 2mm;flex-shrink:0}
.wlbl{font-size:7.5pt;font-weight:800}
.wval{font-size:24pt;font-weight:900;line-height:1}
.wunit{font-size:8.5pt;font-weight:900}
.wgross{font-size:7pt;font-weight:700;margin-top:.1mm}
.foot{padding:.6mm 2mm;border-top:2px solid #000;flex-shrink:0}
.inspector{font-size:9pt;font-weight:900}
@media print{@page{size:76.2mm 76.2mm;margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
<div class="page">

  <div class="hdr">${hdr}${rollTypeLabel ? (hdr ? ' · ' : '') + rollTypeLabel : ''}&nbsp;</div>

  <div class="meta">
    <span>Mat&nbsp;<b>${p.matCode}</b></span>
    <span>MFG&nbsp;<b>${mfgDate}</b></span>
    <span>${rollType.startsWith('scrap') ? 'ถุง' : rollType==='bad' ? 'กรอ' : 'Roll'}&nbsp;<b>${rollNo === 0 ? '—' : rollNo}</b></span>
  </div>

  <div class="body">
    <div class="r"><span class="k">Product</span><span class="v xl">${p.productName}</span></div>
    <div class="r"><span class="k">Code</span><span class="v">${p.productCode || p.matCode}</span></div>
    <div class="r"><span class="k">Size</span><span class="v">${p.widthCm} cm × ${p.thickMc} mc</span></div>
    <div class="r"><span class="k">Lot No</span><span class="v">${p.lotNo}</span></div>
    <div class="r"><span class="k">Length</span><span class="v">${p.length || '—'} M.${p.pcs ? ' · '+p.pcs+' Pcs.' : ''}</span></div>
    <div class="sep"></div>
    <div class="r">
      <span class="k">เครื่อง</span><span class="v">${p.machine_no}</span>
      <span style="margin:0 2mm;color:#ccc">|</span>
      <span class="k" style="min-width:0">Core</span><span class="v">${fmt(core,dec)} Kg</span>
    </div>

    <div class="wrow">
      <div>
        <div class="wlbl">Net Weight</div>
        <div class="wval">${fmt(net,dec)}</div>
        <div class="wunit">Kgs.</div>
        <div class="wgross">Gross ${fmt(gross,dec)} Kgs.</div>
      </div>
      <img src="${qrUrl(56)}" width="56" height="56" style="image-rendering:pixelated"/>
    </div>
  </div>

  <div class="foot">
    <span class="inspector">ผู้ตรวจ: ${p.inspector || '—'}</span>
  </div>

</div>`

  const W   = size === 'long' ? 165  : 76.2
  const H   = size === 'long' ? 70   : 76.2
  const win = window.open('', '_blank', `width=${Math.round(W*3.78)},height=${Math.round(H*3.78)},menubar=no,toolbar=no`)
  if (!win) return

  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
  ${size === 'long' ? longHtmlFromLayout : shortHtml}
  </head><body><script>
    var imgs=document.images,n=0
    function doPrint(){
      if(document.fonts && document.fonts.ready){
        document.fonts.ready.then(function(){setTimeout(function(){window.print();window.close()},300)})
      } else {
        setTimeout(function(){window.print();window.close()},600)
      }
    }
    function ok(){n++;if(n>=imgs.length)doPrint()}
    if(!imgs.length){doPrint()}
    else{for(var i=0;i<imgs.length;i++){if(imgs[i].complete)ok();else{imgs[i].onload=ok;imgs[i].onerror=ok}}}
  <\/script></body></html>`)
  win.document.close()
}

// ── Machine Picker ────────────────────────────────────────────────────────────
function MachinePicker({ profiles, onSelect, onProfileUpdated, dept }: {
  profiles: MachineProfile[]
  onSelect: (p: MachineProfile) => void
  onProfileUpdated: () => void
  dept?: 'blow' | 'print' | 'rewind'
}) {
  const [editing, setEditing]   = useState<MachineProfile | null>(null)
  const [progress, setProgress] = useState<Record<string, { done: number; rolls: number }>>({})
  const [parked,   setParked]   = useState<Record<string, any>>({}) // machine_no → parked_job row

  // โหลด parked jobs
  async function loadParked() {
    const { data } = await supabase.from('parked_jobs').select('*')
    if (!data) return
    const map: Record<string, any> = {}
    data.forEach(r => { map[r.machine_no] = r })
    setParked(map)
  }

  // คืนงานที่จอด
  async function restoreParked(machineNo: string) {
    const job = parked[machineNo]
    if (!job) return
    if (!confirm(`คืนงาน "${job.profile_snapshot?.productName}" ให้เครื่อง ${machineNo}?\nงานที่รันอยู่จะถูกแทนที่`)) return
    const snap = job.profile_snapshot as MachineProfile
    await supabase.from('machine_profiles').upsert({
      machine_no: machineNo,
      cust_code: snap.custCode, cust_name: snap.custName, cust_address: snap.custAddress,
      decimal_places: snap.decimal, item_code: snap.itemCode, mat_code: snap.matCode, product_code: snap.productCode,
      product_name: snap.productName, width_cm: snap.widthCm, thick_mc: snap.thickMc,
      lot_no: snap.lotNo, length: snap.length, pcs: snap.pcs, core_weight: snap.coreWeight,
      inspector: snap.inspector, locked: snap.locked, planned_qty: snap.plannedQty,
      label_size: snap.labelSize, header_text: snap.headerText ?? '',
      blank_header: snap.blankHeader ?? false, section: snap.section ?? 'blow',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'machine_no' })
    await supabase.from('parked_jobs').delete().eq('id', job.id)
    setParked(prev => { const n = { ...prev }; delete n[machineNo]; return n })
    onProfileUpdated()
  }

  useEffect(() => { loadParked() }, [])

  // โหลดยอดผลิตต่อเครื่อง — ดึงตาม machine_no + lot_no ปัจจุบัน
  useEffect(() => {
    if (profiles.length === 0) return
    const machineNos = profiles.map(p => p.machine_no).filter(Boolean)
    if (machineNos.length === 0) return

    supabase.from('production_rolls')
      .select('machine_no, lot_no, weight, roll_type')
      .eq('roll_type', 'good')
      .in('machine_no', machineNos)
      .then(({ data }) => {
        if (!data) return
        // สร้าง map lot_no ปัจจุบันต่อเครื่อง
        const lotMap: Record<string, string> = {}
        profiles.forEach(p => { if (p.machine_no && p.lotNo) lotMap[p.machine_no] = p.lotNo })

        const map: Record<string, { done: number; rolls: number }> = {}
        data.forEach(r => {
          const key = r.machine_no ?? ''
          const curLot = lotMap[key]
          // ถ้ามี lot ปัจจุบัน ให้นับเฉพาะ lot นั้น
          if (curLot && r.lot_no !== curLot) return
          if (!map[key]) map[key] = { done: 0, rolls: 0 }
          map[key].done  += r.weight ?? 0
          map[key].rolls += 1
        })
        setProgress(map)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length, profiles.map(p=>p.machine_no+p.lotNo).join(',')])

  const sorted = [...profiles].sort((a,b) => (a.machine_no||'').localeCompare(b.machine_no||'', undefined, { numeric: true }))

  function isReady(p: MachineProfile) {
    return !!(p.machine_no && p.custName && p.productName && (p.itemCode || p.matCode) && p.lotNo)
  }

  return (
    <div className="h-[calc(100vh-48px)] bg-[#0a0f1e] p-3 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0">
        <div className="mb-2">
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <Wind size={20} className="text-brand-400" />
            เลือกเครื่อง
            {dept && (
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                dept==='blow'   ? 'bg-blue-500/20 text-blue-300' :
                dept==='print'  ? 'bg-purple-500/20 text-purple-300' :
                                  'bg-green-500/20 text-green-300'
              }`}>
                {dept==='blow' ? '🌬 ผลิต(เป่า)' : dept==='print' ? '🖨 ผลิต(พิมพ์)' : '🔁 กรอ(Rework)'}
              </span>
            )}
          </h1>
          <p className="text-slate-400 text-sm mt-1">เครื่องว่าง → คลิกเพื่อกรอกข้อมูลงาน · เครื่องพร้อม → คลิกเพื่อเริ่มชั่ง</p>
        </div>

        {/* Grid — แสดงทุกเครื่อง, size เท่ากันหมด */}
        <div className="grid grid-cols-3 2xl:grid-cols-4 gap-2 flex-1 overflow-hidden" style={{gridTemplateRows:'repeat(3, 1fr)'}}>
          {sorted.map((p, i) => {
            const ready    = isReady(p)
            const prog     = progress[p.machine_no] ?? { done: 0, rolls: 0 }
            const planned  = parseFloat(p.plannedQty) || 0
            const pct      = planned > 0 ? Math.min((prog.done / planned) * 100, 100) : 0
            const remaining = Math.max(planned - prog.done, 0)
            return (
              <div key={i} className={`rounded-2xl text-left transition-all group flex flex-col relative overflow-hidden ${
                ready
                  ? 'bg-slate-900 border border-slate-700 hover:border-brand-500'
                  : 'bg-slate-900/40 border-2 border-dashed border-slate-700 hover:border-brand-500'
              }`}>
                {/* คลิกทั้ง card เพื่อชั่ง/กรอก */}
                <button className="absolute inset-0 z-0" onClick={() => ready ? onSelect(p) : setEditing(p)}/>

                {/* ปุ่ม ⚙ */}
                <button onClick={e => { e.stopPropagation(); setEditing(p) }}
                  className="absolute top-2 right-2 z-10 w-6 h-6 rounded-lg bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
                  <Settings size={11}/>
                </button>

                <div className="flex flex-col h-full relative z-0 pointer-events-none overflow-hidden">

                  {/* ── Top bar: machine badge + status ── */}
                  <div className={`flex items-center justify-between px-3 py-2.5 ${ready ? 'bg-brand-600/20 border-b border-brand-500/20' : 'bg-slate-800/40 border-b border-slate-700/40'}`}>
                    <span className={`font-black text-lg tracking-wide ${ready ? 'text-brand-300' : 'text-slate-500'}`}>{p.machine_no}</span>
                    <div className="flex items-center gap-1.5">
                      {parked[p.machine_no] && (
                        <button className="pointer-events-auto z-10 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/40 transition-colors"
                          onClick={e => { e.stopPropagation(); restoreParked(p.machine_no) }}>
                          🅿 มีงานจอด ↩
                        </button>
                      )}
                      {ready
                        ? <span className="text-xs text-green-400 font-semibold flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block animate-pulse"/>พร้อม</span>
                        : <span className="text-xs text-slate-500 font-semibold">ว่าง</span>}
                    </div>
                  </div>

                  {/* ── Content ── */}
                  {ready ? (
                    <div className="flex-1 px-3 py-2 flex flex-col gap-1.5 overflow-hidden">

                      {/* สินค้า + ลูกค้า */}
                      <div>
                        <p className="text-white font-bold text-sm leading-tight line-clamp-1">{p.productName}</p>
                        <p className="text-slate-400 text-xs truncate mt-0.5">{p.custName}</p>
                      </div>

                      {/* SO + Lot + Size */}
                      <div className="flex gap-1.5 flex-wrap">
                        {p.soNo && <span className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/25 px-2 py-0.5 rounded font-bold">SO {p.soNo}</span>}
                        <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono border border-slate-700">Lot {p.lotNo.slice(-8)}</span>
                        {p.widthCm && <span className="text-[10px] bg-brand-500/15 text-brand-300 border border-brand-500/25 px-2 py-0.5 rounded font-bold">{p.widthCm}×{p.thickMc}mc</span>}
                      </div>

                      {/* Mat + Inspector */}
                      <div className="grid grid-cols-2 gap-x-2 text-xs bg-slate-800/40 rounded-lg px-2 py-1.5">
                        <span className="text-slate-500">Mat</span><span className="text-slate-200 font-mono text-right">{p.matCode}</span>
                        <span className="text-slate-500">ผู้ตรวจ</span><span className="text-slate-200 font-semibold text-right truncate">{p.inspector || '—'}</span>
                      </div>

                      {/* Progress — แสดงเสมอ */}
                      <div className="mt-auto">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-green-400 font-bold">
                            {prog.rolls} ม้วน · {prog.done.toFixed(1)} Kgs.
                          </span>
                          {planned > 0 && (
                            <span className={remaining <= 0 ? 'text-green-400 font-bold' : 'text-amber-400 font-bold'}>
                              {remaining <= 0 ? '✓ ครบแล้ว' : `เหลือ ${remaining.toFixed(0)} Kgs.`}
                            </span>
                          )}
                        </div>
                        {planned > 0 && (
                          <>
                            <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-400' : 'bg-brand-500'}`}
                                style={{ width: `${pct}%` }}/>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-0.5 text-right">เป้า {planned.toLocaleString()} Kgs. ({pct.toFixed(0)}%)</p>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-3 py-4">
                      {parked[p.machine_no] ? (
                        <>
                          <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mb-2">
                            <span className="text-amber-400 text-base">🅿</span>
                          </div>
                          <p className="text-amber-300 text-xs font-bold">มีงานจอดอยู่</p>
                          <p className="text-amber-400/70 text-[10px] mt-0.5 truncate max-w-full px-2">{parked[p.machine_no]?.profile_snapshot?.productName}</p>
                          <button className="pointer-events-auto z-10 mt-2 text-xs font-bold px-3 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/40 transition-colors"
                            onClick={e => { e.stopPropagation(); restoreParked(p.machine_no) }}>
                            ↩ คืนงานนี้
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="w-8 h-8 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center mb-2">
                            <span className="text-slate-600 text-lg">+</span>
                          </div>
                          <p className="text-slate-500 text-xs font-medium">เครื่องว่าง</p>
                          <p className="text-slate-600 text-[10px] mt-0.5">คลิกเพื่อกรอกข้อมูลงาน</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
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
          onSaved={() => { setEditing(null); onProfileUpdated(); loadParked() }}
          onParked={() => { setEditing(null); onProfileUpdated(); loadParked() }} />
      )}
    </div>
  )
}

// ── Suggestion store (จำค่าที่เคยกรอก ใน localStorage) ───────────────────────
const SUG_KEY = 'bwp_field_suggestions'
function loadSuggestions(field: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(SUG_KEY) ?? '{}') as Record<string,string[]>
    return all[field] ?? []
  } catch { return [] }
}
function saveSuggestion(field: string, value: string) {
  if (!value || !value.trim()) return
  try {
    const all = JSON.parse(localStorage.getItem(SUG_KEY) ?? '{}') as Record<string,string[]>
    const list = all[field] ?? []
    const filtered = list.filter(v => v !== value.trim())
    all[field] = [value.trim(), ...filtered].slice(0, 20) // เก็บ 20 อันล่าสุด
    localStorage.setItem(SUG_KEY, JSON.stringify(all))
  } catch {}
}
function saveAllSuggestions(p: MachineProfile) {
  const fields: (keyof MachineProfile)[] = [
    'custCode','custName','custAddress','matCode','productCode','productName',
    'widthCm','thickMc','length','pcs','coreWeight','inspector','plannedQty','headerText'
  ]
  fields.forEach(k => saveSuggestion(k, (p[k] as string) ?? ''))
}

// ── Item Code Picker (dropdown ดึงจาก products table) ────────────────────────
function ItemCodePicker({ value, products, onChange, onPick }: {
  value: string
  products: Product[]
  onChange: (v: string) => void
  onPick: (s: Product) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = (() => {
    const v = value.trim().toLowerCase()
    return products
      .filter(s => s.item_code && (!v || s.item_code.toLowerCase().includes(v) ||
        s.product_name?.toLowerCase().includes(v) ||
        s.cust_name?.toLowerCase().includes(v)))
      .slice(0, 10)
  })()

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        placeholder="คลิกเพื่อเลือก Item Code จากคลัง..."
        className="w-full bg-slate-800 border-2 border-brand-500/40 hover:border-brand-500 focus:border-brand-500 rounded-lg px-2.5 py-2 text-white text-sm outline-none cursor-pointer"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-slate-800 border border-brand-500/40 rounded-lg shadow-2xl max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400 text-center">
              <p>ยังไม่มี Item Code</p>
              <p className="text-brand-400 mt-1">ไปเพิ่มที่เมนู "คลัง Item Code"</p>
            </div>
          ) : filtered.map((s, i) => (
            <button key={s.id ?? s.item_code + i} type="button"
              onMouseDown={e => { e.preventDefault(); onPick(s); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-slate-700 border-b border-slate-700/50 last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-brand-400 font-mono font-bold text-xs">{s.item_code}</span>
                {s.width_cm && (
                  <span className="text-[10px] bg-brand-500/15 text-brand-300 px-1.5 py-0.5 rounded">
                    {s.width_cm}×{s.thick_mc}mc
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-300 mt-0.5 truncate">{s.product_name || '—'}</div>
              <div className="text-[10px] text-slate-500 truncate">👤 {s.cust_name || '—'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Quick Edit Modal (กรอกข้อมูลงานใหม่) ─────────────────────────────────────
function QuickEditModal({ profile, onClose, onSaved, onParked }: {
  profile: MachineProfile; onClose: () => void; onSaved: () => void; onParked?: () => void
}) {
  const [p, setP]         = useState({ ...profile })
  const [products, setProducts] = useState<Product[]>([])
  const [saving, setSaving]   = useState(false)
  const [parking, setParking] = useState(false)
  const [parkBy,  setParkBy]  = useState('')
  const [showPark, setShowPark] = useState(false)
  const set = (k: keyof MachineProfile, v: any) => setP(prev => ({ ...prev, [k]: v }))
  const setMany = (patch: Partial<MachineProfile>) => setP(prev => ({ ...prev, ...patch }))

  useEffect(() => { fetchProducts().then(setProducts) }, [])

  const hasJob = !!(profile.lotNo && profile.productName) // มีงานอยู่แล้ว

  async function parkJob() {
    if (!parkBy.trim()) { alert('กรุณากรอกชื่อผู้จอดงาน'); return }
    setParking(true)
    try {
      // บันทึก snapshot ลง parked_jobs
      await supabase.from('parked_jobs').upsert(
        { machine_no: profile.machine_no, profile_snapshot: profile, parked_by: parkBy.trim(), parked_at: new Date().toISOString() },
        { onConflict: 'machine_no' }
      )
      // เคลียร์งานออกจากเครื่อง (เหลือแค่ machine_no + section)
      await supabase.from('machine_profiles').upsert({
        machine_no: profile.machine_no, section: profile.section ?? 'blow',
        decimal_places: profile.decimal, core_weight: profile.coreWeight,
        cust_code:'', cust_name:'', cust_address:'', mat_code:'', product_code:'',
        product_name:'', width_cm:'', thick_mc:'', lot_no:'', length:'', pcs:'',
        inspector:'', planned_qty:'', label_size: profile.labelSize ?? 'long',
        header_text:'', blank_header: false, locked: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'machine_no' })
      onParked?.()
    } catch (e: any) {
      alert('จอดงานไม่สำเร็จ: ' + e?.message)
    } finally { setParking(false) }
  }

  const ok = p.machine_no && p.custName && p.productName && (p.itemCode || p.matCode) && p.lotNo && p.plannedQty
  // เตือนถ้า Lot ซ้ำกับงานเก่าที่จอดไว้
  const lotSameAsParked = hasJob && p.lotNo && profile.lotNo && p.lotNo === profile.lotNo

  async function save() {
    if (!ok) {
      const missing = [
        !p.machine_no  && 'หมายเลขเครื่อง',
        !p.custName    && 'ชื่อลูกค้า',
        !p.productName && 'ชื่อสินค้า',
        !p.itemCode && !p.matCode && 'Item Code หรือ Mat Code',
        !p.lotNo       && 'Lot No',
        !p.plannedQty  && 'ยอดสั่งผลิต',
      ].filter(Boolean).join(', ')
      alert('กรอกข้อมูลให้ครบก่อน: ' + missing)
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('machine_profiles').upsert({
        machine_no:    p.machine_no,
        cust_code:     p.custCode,
        cust_name:     p.custName,
        cust_address:  p.custAddress,
        decimal_places: p.decimal,
        item_code:     p.itemCode,
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
        header_text:   p.headerText ?? '',
        blank_header:  p.blankHeader ?? false,
        section:       p.section ?? 'blow',
        sale_order:    p.soNo ?? '',
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'machine_no' })
      if (error) throw new Error(error.message)
      saveAllSuggestions(p)
      onSaved()
    } catch (e: any) {
      alert('บันทึกไม่สำเร็จ: ' + (e?.message ?? JSON.stringify(e)))
    } finally { setSaving(false) }
  }

  // helper inline เพื่อไม่ให้ re-mount input
  const inp = (label: string, k: keyof MachineProfile, ph = '', half = false) => {
    const listId = `bwp-list-${k}`
    const sugs = loadSuggestions(k)
    return (
      <div className={half ? '' : 'col-span-2'}>
        <label className="block text-[10px] text-slate-500 mb-1" htmlFor={`bwp-${k}`}>{label}</label>
        <input
          id={`bwp-${k}`}
          name={`bwp_${k}`}
          autoComplete="on"
          list={sugs.length > 0 ? listId : undefined}
          value={(p[k] as string) ?? ''}
          onChange={e => setP(prev => ({ ...prev, [k]: e.target.value }))}
          placeholder={ph}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500"
        />
        {sugs.length > 0 && (
          <datalist id={listId}>
            {sugs.map(s => <option key={s} value={s}/>)}
          </datalist>
        )}
      </div>
    )
  }

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
          {/* ── งานครั้งนี้ — SO + Item Code อยู่แถวเดียวกัน ───── */}
          <p className="text-brand-400 text-[10px] font-bold uppercase tracking-wider">
            งานครั้งนี้ <span className="text-emerald-400 normal-case">(เลือก Item Code → เติมสินค้า+ลูกค้าให้อัตโนมัติ)</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {inp('Sale Order (SO)', 'soNo', '', true)}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Item Code *</label>
              <ItemCodePicker
                value={p.itemCode}
                products={products}
                onChange={v => {
                  const match = products.find(x => x.item_code === v.trim())
                  if (match) {
                    setMany({
                      itemCode:    match.item_code,
                      productCode: match.product_code,
                      productName: match.product_name,
                      widthCm:     match.width_cm,
                      thickMc:     match.thick_mc,
                      custCode:    match.cust_code,
                      custName:    match.cust_name ?? '',
                      custAddress: match.cust_address ?? '',
                    })
                  } else {
                    setMany({
                      itemCode: v,
                      productCode:'', productName:'',
                      widthCm:'', thickMc:'',
                      custCode:'', custName:'', custAddress:'',
                    })
                  }
                }}
                onPick={s => setMany({
                  itemCode:    s.item_code,
                  productCode: s.product_code,
                  productName: s.product_name,
                  widthCm:     s.width_cm,
                  thickMc:     s.thick_mc,
                  custCode:    s.cust_code,
                  custName:    s.cust_name ?? '',
                  custAddress: s.cust_address ?? '',
                })}
              />
            </div>
            {inp('Mat Code',     'matCode', '',      true)}
            {/* Lot No พร้อมปุ่มสร้างอัตโนมัติ */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-slate-500">Lot No *</label>
                <button type="button"
                  onClick={() => {
                    const yy = String((new Date().getFullYear() + 543) % 100).padStart(2, '0')
                    const mm = String(new Date().getMonth() + 1).padStart(2, '0')
                    const mc = (p.machine_no ?? '').toUpperCase()
                    const cc = (p.custCode ?? '').replace(/\D/g, '').padStart(4, '0').slice(-4)
                    if (!mc) { alert('ใส่หมายเลขเครื่องก่อน'); return }
                    if (!cc || cc === '0000') { alert('เลือก Item Code ที่มีรหัสลูกค้าก่อน'); return }
                    setP(prev => ({ ...prev, lotNo: `${yy}${mc}${cc}${mm}` }))
                  }}
                  className="text-[10px] bg-brand-600/20 hover:bg-brand-600/40 text-brand-300 px-2 py-0.5 rounded font-bold border border-brand-500/40">
                  🎲 สร้างอัตโนมัติ
                </button>
              </div>
              <input
                value={p.lotNo ?? ''}
                onChange={e => setP(prev => ({ ...prev, lotNo: e.target.value }))}
                placeholder="69SL01000101"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500 font-mono"
              />
            </div>
            {inp('Length (M.)',  'length',  '',          true)}
            {inp('Pcs.',         'pcs',     '',              true)}
            {inp('ยอดสั่งผลิต (kg) *','plannedQty', '', true)}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">ทศนิยม</label>
              <div className="flex gap-1">
                {([1,2] as const).map(d => (
                  <button key={d} onMouseDown={e => { e.preventDefault(); setP(prev => ({...prev, decimal: d})) }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${p.decimal===d ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    {d} ตำแหน่ง
                  </button>
                ))}
              </div>
            </div>
          </div>
          {lotSameAsParked && (
            <div className="bg-red-900/20 border border-red-500/40 rounded-lg px-3 py-2 text-xs text-red-400">
              ⚠️ Lot นี้เหมือนงานปัจจุบัน — ม้วนเก่าจะนับรวมด้วย กรุณาใช้ Lot ใหม่
            </div>
          )}

          {/* ── สินค้า (auto-fill ได้) ────────────────────────── */}
          <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider pt-2">รายละเอียดสินค้า</p>
          <div className="grid grid-cols-2 gap-2">
            {inp('Product Code',   'productCode', '',      true)}
            {inp('ชื่อสินค้า *',  'productName', '')}
            {inp('กว้าง (cm)',    'widthCm',     '',            true)}
            {inp('หนา (mc)',      'thickMc',     '',            true)}
          </div>

          {/* ── ลูกค้า (auto-fill ได้) ────────────────────────── */}
          <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider pt-2">ลูกค้า</p>
          <div className="grid grid-cols-2 gap-2">
            {inp('รหัสลูกค้า', 'custCode', '', true)}
            {inp('ชื่อลูกค้า *', 'custName', '', true)}
            {inp('ที่อยู่', 'custAddress', '')}
          </div>

          <p className="text-brand-400 text-[10px] font-bold uppercase tracking-wider pt-2">เครื่อง</p>
          <div className="grid grid-cols-2 gap-2">
            {inp('Core Weight (kg)',   'coreWeight', '', true)}
            {inp('ผู้ตรวจสอบ',        'inspector',  '',     true)}
            <div className="col-span-2">
              <label className="block text-[10px] text-slate-500 mb-1">ใบปะหน้า</label>
              <div className="flex gap-1">
                {(['long','short'] as const).map(s => (
                  <button key={s} onMouseDown={e => { e.preventDefault(); setP(prev => ({...prev, labelSize: s})) }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold ${p.labelSize===s ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    {s === 'long' ? 'ยาว 165×70' : 'สั้น 76×76'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {p.labelSize === 'short' && (
            <div className="col-span-2 space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none"
                onMouseDown={e => { e.preventDefault(); setP(prev => ({...prev, blankHeader: !prev.blankHeader})) }}>
                <input type="checkbox" readOnly checked={!!p.blankHeader}
                  className="w-4 h-4 accent-brand-500 pointer-events-none"/>
                <span className="text-xs text-slate-300">เว้นหัวกระดาษว่าง (ไม่พิมพ์ชื่อบริษัท)</span>
              </label>
              {!p.blankHeader && (
                <input value={p.headerText ?? ''} onChange={e => setP(prev => ({...prev, headerText: e.target.value}))}
                  placeholder="ปล่อยว่าง = ใช้ชื่อบริษัท BWP"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-brand-500" />
              )}
            </div>
          )}
        </div>

        <div className="px-5 pt-3 pb-0 border-t border-slate-800 shrink-0">
          {/* ปุ่มจอดงาน — แสดงเฉพาะเมื่อมีงานอยู่ */}
          {hasJob && (
            <div className="mb-3">
              {!showPark ? (
                <button onClick={() => setShowPark(true)}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors">
                  🅿 จอดงานนี้ไว้ก่อน (แทรกงานด่วน)
                </button>
              ) : (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
                  <p className="text-amber-300 text-xs font-bold">🅿 จอดงาน "{profile.productName}" ไว้ก่อน</p>
                  <input value={parkBy} onChange={e => setParkBy(e.target.value)}
                    placeholder="ชื่อผู้จอดงาน *"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm outline-none focus:border-amber-500"/>
                  <div className="flex gap-2">
                    <button onClick={() => setShowPark(false)}
                      className="flex-1 py-1.5 rounded-lg text-xs text-slate-400 bg-slate-800 hover:bg-slate-700">ยกเลิก</button>
                    <button onClick={parkJob} disabled={parking}
                      className="flex-[2] py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50">
                      {parking ? 'กำลังจอด...' : '✓ จอดงาน + เปิดรับงานใหม่'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-5 py-3 shrink-0">
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

// ── Offline Queue ─────────────────────────────────────────────────────────────
const QUEUE_KEY = 'bwp_offline_queue'
function loadQueue(): any[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') } catch { return [] }
}
function saveQueue(q: any[]) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) }

// ── Weigh Page ────────────────────────────────────────────────────────────────
function WeighPage({ profile, onBack }: { profile: MachineProfile; onBack: () => void }) {
  const [gross,        setGross]        = useState(0)
  // ── Scale Bridge (WebSocket) ─────────────────────────────────────────
  const [serialConnected, setSerialConnected] = useState(false)
  const [serialStable,    setSerialStable]    = useState(false)
  const [rawSerial,       setRawSerial]       = useState('')
  const [bridgeUrl,       setBridgeUrl]       = useState(() => localStorage.getItem('bwp_bridge_url') ?? 'ws://localhost:8080')
  const wsRef             = useRef<WebSocket | null>(null)
  const wsReconnectRef    = useRef<any>(null)

  // ── เชื่อมต่อ Bridge (WebSocket) — auto-reconnect ────────────────
  function connectBridge() {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    try {
      const ws = new WebSocket(bridgeUrl)
      wsRef.current = ws
      let lastUpdate = 0
      ws.onopen = () => {
        console.log('[bridge] connected')
        localStorage.setItem('bwp_bridge_url', bridgeUrl)
      }
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data)
          if (d.type !== 'weight') return
          // ถ้า bridge ยังไม่ได้ต่อเครื่องชั่ง → connected = false
          if (d.connected !== undefined) setSerialConnected(d.connected)
          // throttle update ทุก 150ms
          const now = Date.now()
          if (now - lastUpdate < 150) return
          lastUpdate = now
          if (typeof d.value === 'number') setGross(parseFloat(d.value.toFixed(dec)))
          setSerialStable(!!d.stable)
          setStable(!!d.stable)
          if (d.raw) setRawSerial(d.raw)
        } catch {}
      }
      ws.onclose = () => {
        setSerialConnected(false)
        // auto-reconnect ทุก 3 วินาที
        wsReconnectRef.current = setTimeout(connectBridge, 3000)
      }
      ws.onerror = () => { setSerialConnected(false) }
    } catch (e) {
      console.error('ws error', e)
      wsReconnectRef.current = setTimeout(connectBridge, 3000)
    }
  }

  function disconnectBridge() {
    if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    setSerialConnected(false)
    setSerialStable(false)
  }

  // ── เชื่อม Bridge อัตโนมัติตอนเปิดหน้า ────────────────────────
  useEffect(() => {
    connectBridge()
    return () => disconnectBridge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  // offline queue
  const [queue,      setQueue]      = useState<any[]>(loadQueue)
  const [syncing,    setSyncing]    = useState(false)

  // sync queue เมื่อออนไลน์
  useEffect(() => {
    async function flushQueue() {
      const q = loadQueue()
      if (!q.length || !navigator.onLine) return
      setSyncing(true)
      const remaining: any[] = []
      for (const item of q) {
        try {
          const { error } = await supabase.from('production_rolls').insert(item)
          if (error) remaining.push(item)
        } catch { remaining.push(item) }
      }
      saveQueue(remaining)
      setQueue(remaining)
      setSyncing(false)
    }
    flushQueue()
    window.addEventListener('online', flushQueue)
    return () => window.removeEventListener('online', flushQueue)
  }, [])

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

  // โหลดม้วนทั้งหมดของ machine+lot นี้
  function loadRollsForMachine() {
    supabase.from('production_rolls')
      .select('*')
      .eq('machine_no', profile.machine_no)
      .eq('lot_no', profile.lotNo)
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
  }

  useEffect(() => {
    loadRollsForMachine()
    setStable(true)

    // Realtime: อัปเดตสถานะ transferred ทันทีเมื่อโอนจากหน้าอื่น
    const channel = supabase.channel(`rolls-${profile.machine_no}-${profile.lotNo}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'production_rolls',
        filter: `machine_no=eq.${profile.machine_no}`,
      }, () => { loadRollsForMachine() })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
        sale_order:     profile.soNo ?? '',
        product_name:   profile.productName,
        customer:       profile.custName,
        item_code:      profile.itemCode,
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
        item_code: '', mat_code: '', product_code: '', product_name: '',
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

      const payload = {
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
        sale_order:   profile.soNo ?? '',
        product_name: profile.productName,
        customer:     profile.custName,
        section:      profile.section ?? 'blow',
        width_cm:     profile.widthCm || null,
        thick_mc:     profile.thickMc || null,
        created_at:   new Date().toISOString(),
      }

      let data: any = null
      const { data: inserted, error: insertErr } = await supabase
        .from('production_rolls').insert(payload).select().single()

      if (insertErr || !inserted) {
        // ── ออฟไลน์ → บันทึกลง queue ────────────────────────────────
        const offlineId = `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`
        const offlineRecord = { ...payload, id: offlineId, _offline: true }
        const q = [...loadQueue(), payload]
        saveQueue(q)
        setQueue(q)
        data = offlineRecord
        console.warn('offline — queued:', offlineRecord)
      } else {
        data = inserted
      }

      setLastRoll({ ...data, weighType: actualType })
      setWeighedRolls(prev => [...prev, data].filter(Boolean))

      // บันทึก log ทุกการชั่ง
      supabase.from('weigh_logs').insert({
        machine_no:   profile.machine_no,
        lot_no:       profile.lotNo,
        item_code:    profile.itemCode,
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
  const [deleteModal, setDeleteModal] = useState<{ roll: any } | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteBy, setDeleteBy]   = useState('')
  const [deleting, setDeleting]   = useState(false)

  async function confirmDelete() {
    if (!deleteModal) return
    if (!deleteBy.trim()) { alert('กรุณากรอกชื่อผู้ลบ'); return }
    if (!deleteReason.trim()) { alert('กรุณากรอกเหตุผล'); return }
    setDeleting(true)
    const r = deleteModal.roll
    // บันทึก log ก่อนลบ
    await supabase.from('roll_deletion_logs').insert({
      deleted_by:   deleteBy.trim(),
      reason:       deleteReason.trim(),
      machine_no:   r.machine_no,
      lot_no:       r.lot_no,
      roll_no:      r.roll_no,
      roll_type:    r.roll_type,
      weight:       r.weight,
      gross_weight: r.gross_weight,
      original_id:  r.id,
    })
    // ลบม้วน
    const { error } = await supabase.from('production_rolls').delete().eq('id', r.id)
    setDeleting(false)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    setDeleteModal(null)
    setDeleteReason('')
    setDeleteBy('')
    setSelectedRoll(null)
    loadRollsForMachine()
  }

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
            <p className="text-slate-400 text-xs">
              {profile.soNo && <span className="text-amber-300 font-bold mr-1.5">SO {profile.soNo}</span>}
              {profile.custName} · Lot {profile.lotNo}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Offline queue badge */}
          {queue.length > 0 && (
            <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-semibold ${
              syncing ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}>
              {syncing
                ? <><span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block"/> กำลัง sync {queue.length} รายการ...</>
                : <><span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block"/> ค้างส่ง {queue.length} ม้วน (ออฟไลน์)</>
              }
            </div>
          )}
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
            <div className="flex items-center justify-between mb-1 px-1">
              <p className="text-slate-500 text-[10px] uppercase tracking-widest">Gross Weight</p>
              <div className="flex items-center gap-1.5">
                {serialConnected ? (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                    serialStable ? 'bg-green-500/20 text-green-300 border-green-500/40' : 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                  }`} title={`Bridge: ${bridgeUrl}`}>
                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${serialStable?'bg-green-400':'bg-amber-400'}`}/>
                    {serialStable ? '● เครื่องชั่ง (นิ่ง)' : '◌ เครื่องชั่ง (อ่าน...)'}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40">
                    ⚠ Bridge ไม่เชื่อมต่อ
                  </span>
                )}
                <button onClick={() => {
                  const url = prompt('Bridge URL (ws://IP:8080)', bridgeUrl)
                  if (!url) return
                  setBridgeUrl(url)
                  localStorage.setItem('bwp_bridge_url', url)
                  disconnectBridge()
                  setTimeout(connectBridge, 300)
                }}
                  className="text-[10px] text-slate-500 hover:text-slate-300 px-1 py-0.5 rounded hover:bg-slate-700"
                  title="ตั้งค่า Bridge URL">
                  ⚙
                </button>
              </div>
            </div>
            <input
              type="number" step="0.01" inputMode="decimal"
              value={gross || ''}
              onChange={e => { setGross(parseFloat(e.target.value)||0); setStable(true) }}
              placeholder="0.00"
              readOnly={serialConnected}
              className="w-full font-mono text-[72px] font-black tracking-tight leading-none mb-1 text-white bg-transparent text-center outline-none placeholder-slate-700 focus:bg-slate-800/50 rounded-xl"
            />
            <p className="text-slate-500 text-xs font-semibold mb-2">Kgs.</p>
            {serialConnected && rawSerial && (
              <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1 mb-3 font-mono text-[9px] text-slate-500 truncate text-left" title={rawSerial}>
                📥 {rawSerial.replace(/[\r\n]/g, '·').slice(-80)}
              </div>
            )}

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
                isBad   ? `กรอ ${badRollNo} · ${fmt(saveWeight,dec)} Kgs.` :
                          `Roll ${rollNo} · ${fmt(saveWeight,dec)} Kgs.`}
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
                  const d      = new Date(r.created_at)
                  const dateShort = `${d.getDate()}/${d.getMonth()+1}`
                  const time   = d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
                  return (
                    <div key={r.id} onClick={()=>setSelectedRoll(r)}
                      className={`grid grid-cols-4 hover:bg-slate-800/40 cursor-pointer transition-colors ${isNew?'bg-green-500/5':''} ${isDone?'opacity-60':''}`}>
                      <div className={`px-3 py-2.5 text-xs leading-tight ${isDone?'text-slate-600 line-through':'text-slate-500'}`}>
                        <div className="text-[9px] text-slate-600">{dateShort}</div>
                        <div>{time}</div>
                      </div>
                      <div className="px-3 py-2.5">
                        <span className={`font-bold font-mono ${isDone?'text-slate-500 line-through':'text-white'}`}>{r.roll_no}</span>
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
                  const d2    = new Date(r.created_at)
                  const dateShort2 = `${d2.getDate()}/${d2.getMonth()+1}`
                  const time  = d2.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})
                  return (
                    <div key={r.id} onClick={()=>setSelectedRoll(r)}
                      className={`grid grid-cols-4 hover:bg-slate-800/40 cursor-pointer transition-colors ${isNew?'bg-orange-500/5':''}`}>
                      <div className="px-3 py-2.5 text-slate-500 text-xs leading-tight">
                        <div className="text-[9px] text-slate-600">{dateShort2}</div>
                        <div>{time}</div>
                      </div>
                      <div className="px-3 py-2.5">
                        <span className="text-orange-200 font-bold font-mono">{r.roll_no}</span>
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
            <div className="px-6 py-5 text-center relative">
              {/* ปุ่ม X → กลับหน้าแรก */}
              <button onClick={onBack}
                className="absolute top-3 right-3 text-slate-500 hover:text-white w-7 h-7 rounded-lg hover:bg-slate-700 flex items-center justify-center transition-colors">
                <X size={16}/>
              </button>
              {/* เลขเครื่อง — ใหญ่ชัดเจน */}
              <div className="bg-brand-600/20 border-2 border-brand-500/50 rounded-2xl px-6 py-3 mb-4 inline-block">
                <p className="text-brand-300 text-[11px] font-semibold uppercase tracking-widest mb-0.5">เครื่อง</p>
                <p className="text-white font-black text-5xl tracking-wider">{profile.machine_no}</p>
              </div>
              <p className="text-slate-300 text-sm font-semibold truncate px-2">{profile.productName}</p>
              <p className="text-white font-bold text-lg mt-3">ผู้ตรวจสอบกะนี้คือใคร?</p>
              {isStale && inspector && (
                <p className="text-amber-400 text-xs mt-2">⚠️ ผ่านมา {Math.floor(hoursSinceSet)} ชั่วโมง — เปลี่ยนกะหรือยัง?</p>
              )}
              <input value={inspectorInput} onChange={e => setInspectorInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmInspector(inspectorInput) }}
                placeholder="ชื่อผู้ตรวจสอบ..."
                autoFocus
                className="w-full mt-4 bg-slate-800 border-2 border-slate-700 rounded-xl px-4 py-3 text-white text-lg text-center outline-none focus:border-brand-500" />
            </div>
            <div className="px-6 py-4 border-t border-slate-800">
              <button onClick={() => confirmInspector(inspectorInput)}
                disabled={!inspectorInput.trim()}
                className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white py-3 rounded-xl font-bold text-base transition-colors">
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
                <p className="text-white font-bold">Roll {selectedRoll.roll_no}</p>
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
                  { k:'ความยาว',     v: profile.length ? `${profile.length} M.` : '—' },
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
            <div className="flex gap-2 px-5 pt-4 border-t border-slate-800">
              <button onClick={() => printLabel({...profile, inspector: selectedRoll.inspector || profile.inspector}, selectedRoll.roll_no, selectedRoll.gross_weight??0, selectedRoll.weight??0, 'short', selectedRoll.roll_type, selectedRoll.remark??'', selectedRoll.id)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-sm py-2.5 rounded-xl transition-colors">
                <Printer size={14}/> ใบสั้น
              </button>
              <button onClick={() => printLabel({...profile, inspector: selectedRoll.inspector || profile.inspector}, selectedRoll.roll_no, selectedRoll.gross_weight??0, selectedRoll.weight??0, 'long', selectedRoll.roll_type, selectedRoll.remark??'', selectedRoll.id)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm py-2.5 rounded-xl transition-colors font-semibold">
                <Printer size={14}/> ใบยาว
              </button>
            </div>

            {/* ลบม้วน */}
            <div className="px-5 pb-4 pt-2">
              <button onClick={() => { setDeleteModal({ roll: selectedRoll }); setDeleteReason(''); setDeleteBy('') }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-red-900/20 hover:bg-red-900/50 text-red-400 hover:text-red-300 border border-red-900/30 transition-colors">
                <X size={14}/> ลบม้วนนี้ (ชั่งผิด / งานผิด)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ────────────────────────────────────────────────── */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => !deleting && setDeleteModal(null)}>
          <div className="bg-slate-900 border border-red-900/50 rounded-2xl w-full max-w-sm p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-red-900/40 flex items-center justify-center">
                <X size={16} className="text-red-400"/>
              </div>
              <div>
                <p className="text-white font-bold text-sm">ลบม้วน {deleteModal.roll.roll_no}</p>
                <p className="text-slate-500 text-xs">{fmt(deleteModal.roll.weight??0,dec)} Kgs. · {deleteModal.roll.machine_no}</p>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <label className="flex flex-col gap-1">
                <span className="text-slate-400 text-xs font-semibold">ชื่อผู้ลบ *</span>
                <input value={deleteBy} onChange={e => setDeleteBy(e.target.value)}
                  placeholder="กรอกชื่อ..."
                  className="bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-red-500 focus:outline-none"/>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-400 text-xs font-semibold">เหตุผลที่ลบ *</span>
                <input value={deleteReason} onChange={e => setDeleteReason(e.target.value)}
                  placeholder="เช่น ชั่งผิดงาน, กรอกข้อมูลผิด..."
                  className="bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-red-500 focus:outline-none"/>
              </label>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setDeleteModal(null)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors">
                ยกเลิก
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50">
                {deleting ? 'กำลังลบ...' : 'ยืนยันลบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WeighStation({ dept }: { dept?: 'blow' | 'print' | 'rewind' }) {
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
          itemCode:    r.item_code    ?? '',
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
          headerText:  r.header_text  ?? '',
          blankHeader: r.blank_header ?? false,
          section:    (r.section      ?? 'blow') as 'blow'|'print'|'rewind',
          soNo:        r.sale_order   ?? '',
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
