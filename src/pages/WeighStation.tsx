import { useState, useEffect, useRef } from 'react'
import { Save, Printer, RefreshCw, CheckCircle2, ArrowLeft, Wind, Lock, X } from 'lucide-react'
import QRCode from 'react-qr-code'
import { supabase } from '../lib/supabase'
import { loadProfiles, type MachineProfile } from './MachineSettings'

function fmt(n: number, d: 1|2 = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function thaiDate() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`
}
function barcodeUrl(text: string, h = 10) {
  return `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(text||'0')}&scale=2&height=${h}&includetext`
}

// ── Print Label ───────────────────────────────────────────────────────────────
function printLabel(p: MachineProfile, rollNo: number, gross: number, net: number, size: 'long'|'short' = 'long') {
  const dec     = p.decimal
  const mfgDate = thaiDate()
  const core    = parseFloat(p.coreWeight) || 0
  const qrData  = JSON.stringify({
    mat: p.matCode, lot: p.lotNo, roll: rollNo,
    net: fmt(net,dec), gross: fmt(gross,dec),
    machine: p.machine_no, date: mfgDate,
    customer: p.custName, product: p.productName,
  })
  const qrUrl = (s: number) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(qrData)}&margin=2`

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
  <div class="title">บริษัท เบสท์เวิลด์ อินเตอร์พลาส จำกัด</div>

  <!-- Header: ไม่มี barcode แค่ text -->
  <div class="hdr">
    <div class="hc1">
      <span style="font-size:8pt">Mat Code &nbsp;</span><b style="font-size:9pt">${p.matCode}</b>
    </div>
    <div class="hc2">
      <span style="font-size:8pt">MFG Date &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><b style="font-size:9pt">${mfgDate}</b>
    </div>
    <div class="hc3">
      <span style="font-size:8pt">Roll No. &nbsp;</span><b style="font-size:9pt">${rollNo}</b>
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
        <img src="${qrUrl(72)}" width="72" height="72" style="flex-shrink:0"/>
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
    <img src="${qrUrl(56)}" width="56" height="56"/>
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
function MachinePicker({ profiles, onSelect }: {
  profiles: MachineProfile[]
  onSelect: (p: MachineProfile) => void
}) {
  const ready    = profiles.filter(p => p.machine_no && p.custName && p.productName && p.matCode && p.lotNo)
  const notReady = profiles.filter(p => !p.machine_no || !p.custName || !p.productName || !p.matCode || !p.lotNo)

  return (
    <div className="min-h-[calc(100vh-48px)] bg-[#0a0f1e] p-6 flex flex-col items-center">
      <div className="w-full max-w-4xl">
        <div className="mb-6">
          <h1 className="text-white font-bold text-xl flex items-center gap-2">
            <Wind size={20} className="text-brand-400" /> เลือกเครื่องที่ต้องการชั่ง
          </h1>
          <p className="text-slate-400 text-sm mt-1">แตะเครื่องเพื่อเริ่มชั่งทันที — ข้อมูลถูกตั้งค่าไว้แล้ว</p>
        </div>

        {ready.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
            {ready.map((p, i) => (
              <button key={i} onClick={() => onSelect(p)}
                className="bg-slate-900 border border-slate-700 hover:border-brand-500 hover:bg-brand-500/8 rounded-2xl p-4 text-left transition-all active:scale-95 group">
                <div className="flex items-center justify-between mb-2">
                  <div className="bg-brand-600 text-white font-black text-lg w-12 h-12 rounded-xl flex items-center justify-center group-hover:bg-brand-500 transition-colors">
                    {p.machine_no}
                  </div>
                  {p.locked && <Lock size={12} className="text-red-400" />}
                </div>
                <p className="text-white font-semibold text-sm leading-tight truncate">{p.productName}</p>
                <p className="text-slate-400 text-xs mt-0.5 truncate">{p.custName}</p>
                <div className="flex gap-1 flex-wrap mt-1.5">
                  <span className="text-[9px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">Lot {p.lotNo.slice(-6)}</span>
                  {p.widthCm && <span className="text-[9px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">{p.widthCm}cm×{p.thickMc}mc</span>}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-2xl mb-6">
            <Wind size={40} className="text-slate-700 mx-auto mb-3" />
            <p className="text-slate-400 font-semibold">ยังไม่มีเครื่องพร้อม</p>
            <p className="text-slate-600 text-sm mt-1">ไปตั้งค่า Profile เครื่องที่ Tab "ตั้งค่าเครื่อง" ก่อน</p>
          </div>
        )}

        {notReady.length > 0 && (
          <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-400">
            ⚠️ เครื่องยังไม่พร้อม {notReady.length} เครื่อง ({notReady.map(p=>p.machine_no||'?').join(', ')}) — กรอกข้อมูลให้ครบในหน้าตั้งค่า
          </div>
        )}
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
      .select('roll_no, weight')
      .eq('roll_type', 'good')
      .gte('created_at', today.toISOString())
      .order('roll_no', { ascending: true })
      .then(({ data }) => {
        if (!data?.length) return
        const total = (data as any[]).reduce((s, r) => s + (r.weight ?? 0), 0)
        setWeighedKg(parseFloat(total.toFixed(dec)))
        setWeighedRolls(data as any[])
        setRollNo(data.length + 1)
      })
    startIdle()
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
    setStable(false)
    let tick = 0
    const TOTAL = 25
    timerRef.current = setInterval(() => {
      tick++
      const progress   = Math.min(1, tick / TOTAL)
      const approaching = target * Math.min(1, progress * 1.4)
      const noise      = tick < TOTAL
        ? (Math.random() - 0.5) * 3 * (1 - progress)
        : (Math.random() - 0.5) * 0.02
      const cur = parseFloat(Math.max(0, approaching + noise).toFixed(dec))
      setGross(cur)
      if (tick >= TOTAL) {
        clearInterval(timerRef.current!)
        setGross(target)
        setStable(true)
        timerRef.current = setInterval(() => {
          const n = (Math.random() - 0.5) * 0.02
          setGross(parseFloat((target + n).toFixed(dec)))
        }, 200)
      }
    }, 100)
  }

  async function handleSave() {
    if (net <= 0 || !stable) return
    setSaving(true)
    try {
      const { data } = await supabase.from('production_rolls').insert({
        job_id: null, roll_no: rollNo, roll_type: 'good',
        weight: net, gross_weight: gross, core_weight: core,
      }).select().single()
      const newTotal = parseFloat((weighedKg + net).toFixed(dec))
      setLastRoll(data)
      setWeighedKg(newTotal)
      setWeighedRolls(prev => [...prev, { roll_no: rollNo, weight: net }])
      setRollNo(r => r + 1)
      printLabel(profile, rollNo, gross, net, profile.labelSize ?? 'long')
      setGross(0)
      startIdle()
    } catch { alert('บันทึกไม่สำเร็จ') }
    finally { setSaving(false) }
  }

  const progressColor = done ? 'bg-green-500' : pct >= 80 ? 'bg-amber-400' : 'bg-brand-500'

  const [selectedRoll, setSelectedRoll] = useState<any>(null)

  // QR data สำหรับม้วนที่เลือก
  function makeQrData(r: any) {
    return JSON.stringify({
      mat: profile.matCode, lot: profile.lotNo,
      roll: r.roll_no, net: fmt(r.weight, dec),
      gross: fmt(r.gross_weight ?? 0, dec), core: fmt(r.core_weight ?? 0, dec),
      machine: profile.machine_no, date: new Date(r.created_at).toLocaleDateString('th-TH'),
      time: new Date(r.created_at).toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit'}),
      customer: profile.custName, product: profile.productName,
    })
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
          <button onClick={onBack}
            className="flex items-center gap-1 text-slate-500 hover:text-white text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors">
            <ArrowLeft size={12}/> เปลี่ยนเครื่อง
          </button>
        </div>
      </div>

      {/* Body: 2 column */}
      <div className="flex flex-1 min-h-0">

        {/* ── LEFT: เครื่องชั่ง ─────────────────────────────── */}
        <div className="w-[340px] shrink-0 flex flex-col gap-3 p-4 border-r border-slate-800 overflow-y-auto">

          {/* Scale display */}
          <div className="bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-5 text-center shadow-xl">
            <p className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">Gross Weight</p>
            <div className={`font-mono text-6xl font-black tracking-tight leading-none mb-1 transition-colors ${stable ? 'text-white' : 'text-amber-300'}`}>
              {fmt(gross, dec)}
            </div>
            <p className={`text-xs font-semibold mb-3 ${stable ? 'text-slate-500' : 'text-amber-500 animate-pulse'}`}>
              {stable ? 'Kgs. ✓' : 'Kgs. ⟳ อ่านค่า...'}
            </p>

            <div className="flex items-center justify-center gap-4 mb-3">
              <div className="text-center bg-slate-800 rounded-xl px-3 py-1.5">
                <p className="text-slate-500 text-[9px]">Core</p>
                <p className="text-slate-300 font-bold text-sm">{fmt(core, dec)}</p>
              </div>
              <span className="text-slate-700 text-lg">−</span>
              <div className="text-center">
                <p className="text-slate-500 text-[9px]">Net</p>
                <p className="text-brand-400 font-black text-2xl">{fmt(net, dec)}</p>
                <p className="text-brand-400/60 text-[9px]">Kgs.</p>
              </div>
            </div>

            <button onClick={readScale}
              className={`w-full py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${stable ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-amber-500/20 text-amber-400 cursor-not-allowed'}`}>
              <RefreshCw size={13} className={stable ? '' : 'animate-spin'}/>
              {stable ? 'วางม้วน / อ่านค่าใหม่' : 'กำลังอ่านค่า...'}
            </button>
          </div>

          {/* Roll No + Save */}
          <div className="flex items-center gap-2">
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 flex items-center gap-2 shrink-0">
              <span className="text-slate-500 text-xs">Roll</span>
              <button onClick={() => setRollNo(r => Math.max(1,r-1))} className="text-slate-500 hover:text-white w-5 text-center">−</button>
              <span className="text-white font-black w-7 text-center">{rollNo}</span>
              <button onClick={() => setRollNo(r => r+1)} className="text-slate-500 hover:text-white w-5 text-center">+</button>
            </div>
            <button onClick={handleSave} disabled={saving || net <= 0 || !stable}
              className={`flex-1 py-3 rounded-xl text-white font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40 ${!stable ? 'bg-slate-700 cursor-not-allowed' : 'bg-brand-600 hover:bg-brand-500'}`}>
              <Save size={17}/>
              {saving ? 'บันทึก...' : !stable ? 'รอค่านิ่ง...' : `Roll ${rollNo} · ${fmt(net,dec)}`}
            </button>
          </div>

          {/* Last saved flash */}
          {lastRoll && (
            <div className="bg-green-500/10 border border-green-500/25 rounded-xl px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-400"/>
                <p className="text-green-300 text-sm font-semibold">Roll {lastRoll.roll_no} · {fmt(lastRoll.weight,dec)} Kgs. ✓</p>
              </div>
            </div>
          )}

          {/* Progress detail */}
          {planned > 0 && (
            <div className={`rounded-xl p-3 border ${done ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-900 border-slate-800'}`}>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-400">ชั่งแล้ว <b className={done?'text-green-300':'text-white'}>{fmt(weighedKg,dec)}</b></span>
                <span className={done ? 'text-green-400 font-bold' : 'text-brand-300'}>{done ? '✓ ครบ' : `เหลือ ${fmt(remaining,dec)}`}</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${progressColor}`} style={{width:`${pct}%`}}/>
              </div>
              <p className="text-slate-600 text-[10px] mt-1">{weighedRolls.length} ม้วน · {pct}% · เป้า {fmt(planned,dec)} Kgs.</p>
            </div>
          )}
        </div>

        {/* ── RIGHT: ตารางม้วน ──────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between shrink-0">
            <p className="text-white font-semibold text-sm">รายการม้วน</p>
            <p className="text-slate-500 text-xs">{weighedRolls.length} ม้วน</p>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-5 gap-0 border-b border-slate-800 bg-slate-800/30 shrink-0">
            {['ม้วนที่','นน.เต็ม (Kgs.)','นน.แกน (Kgs.)','นน.สุทธิ (Kgs.)',''].map(h => (
              <div key={h} className="px-4 py-2 text-slate-500 text-[10px] font-semibold uppercase tracking-wider">{h}</div>
            ))}
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50">
            {[...weighedRolls].reverse().map(r => (
              <div key={r.roll_no}
                onClick={() => setSelectedRoll(r)}
                className={`grid grid-cols-5 gap-0 hover:bg-slate-800/40 cursor-pointer transition-colors ${lastRoll?.roll_no === r.roll_no ? 'bg-green-500/5' : ''}`}>
                <div className="px-4 py-3">
                  <span className="text-white font-bold font-mono">#{r.roll_no}</span>
                  {lastRoll?.roll_no === r.roll_no && (
                    <span className="ml-2 text-[9px] text-green-400">NEW</span>
                  )}
                </div>
                <div className="px-4 py-3 text-slate-400">{fmt(r.weight + (r.core_weight??0), dec)}</div>
                <div className="px-4 py-3 text-slate-500">{fmt(r.core_weight ?? 0, dec)}</div>
                <div className="px-4 py-3 text-brand-300 font-black text-base">{fmt(r.weight, dec)}</div>
                <div className="px-4 py-3 flex items-center">
                  <span className="text-slate-600 text-[10px]">คลิกดูรายละเอียด →</span>
                </div>
              </div>
            ))}
            {weighedRolls.length === 0 && (
              <div className="flex items-center justify-center h-40 text-slate-600 text-sm">
                ยังไม่มีม้วน — ชั่งแล้วกดบันทึก
              </div>
            )}
          </div>

          {/* Footer sum */}
          {weighedRolls.length > 0 && (
            <div className="border-t border-slate-700 bg-slate-900 px-4 py-2 grid grid-cols-5 gap-0 shrink-0">
              <div className="text-slate-400 text-xs font-semibold col-span-3">รวม {weighedRolls.length} ม้วน</div>
              <div className="text-brand-300 font-black">{fmt(weighedKg, dec)}</div>
              <div/>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: ประวัติม้วน ─────────────────────────────── */}
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
              {/* น้ำหนัก */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label:'นน.เต็ม', val: fmt(selectedRoll.weight+(selectedRoll.core_weight??0), dec), cls:'text-slate-300' },
                  { label:'นน.แกน',  val: fmt(selectedRoll.core_weight??0, dec),  cls:'text-slate-500' },
                  { label:'นน.สุทธิ',val: fmt(selectedRoll.weight, dec),          cls:'text-brand-400 font-black text-2xl' },
                ].map(item => (
                  <div key={item.label} className="bg-slate-800 rounded-xl py-3">
                    <p className="text-slate-500 text-[9px] mb-1">{item.label}</p>
                    <p className={`font-bold text-lg ${item.cls}`}>{item.val}</p>
                    <p className="text-slate-600 text-[9px]">Kgs.</p>
                  </div>
                ))}
              </div>

              <div className="text-center text-slate-500 text-xs">
                {new Date(selectedRoll.created_at).toLocaleDateString('th-TH')} · {new Date(selectedRoll.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}
              </div>

              {/* QR Code */}
              <div className="flex flex-col items-center gap-2 bg-white rounded-xl p-4">
                <QRCode value={makeQrData(selectedRoll)} size={160} level="M"/>
                <p className="text-slate-500 text-[9px] text-center">สแกนเพื่อดูข้อมูลม้วน</p>
              </div>
            </div>

            {/* Reprint */}
            <div className="flex gap-2 px-5 py-4 border-t border-slate-800">
              <button onClick={() => printLabel(profile, selectedRoll.roll_no, selectedRoll.gross_weight??selectedRoll.weight+(selectedRoll.core_weight??0), selectedRoll.weight, 'short')}
                className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-sm py-2.5 rounded-xl transition-colors">
                <Printer size={14}/> พิมพ์ใบสั้น
              </button>
              <button onClick={() => printLabel(profile, selectedRoll.roll_no, selectedRoll.gross_weight??selectedRoll.weight+(selectedRoll.core_weight??0), selectedRoll.weight, 'long')}
                className="flex-1 flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm py-2.5 rounded-xl transition-colors font-semibold">
                <Printer size={14}/> พิมพ์ใบยาว
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WeighStation() {
  const [selected, setSelected] = useState<MachineProfile | null>(null)
  const profiles = loadProfiles()
  if (!selected) return <MachinePicker profiles={profiles} onSelect={setSelected} />
  return <WeighPage profile={selected} onBack={() => setSelected(null)} />
}
