import type { ProductionRecord, KpiData, FilterState } from './types'

export const BLS = ['BL01','BL02','BL03','BL04','BL05','BL06','BL07','BL08','BL09','BL10','BL11']

export const MACHINE_COLORS: Record<string, string> = {
  BL01:'#3b82f6', BL02:'#8b5cf6', BL03:'#ec4899', BL04:'#f97316',
  BL05:'#10b981', BL06:'#06b6d4', BL07:'#f59e0b', BL08:'#6366f1',
  BL09:'#14b8a6', BL10:'#ef4444', BL11:'#84cc16',
}

export const PALETTE = [
  '#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6',
  '#ec4899','#06b6d4','#f97316','#14b8a6','#a855f7','#84cc16','#0ea5e9',
]

export function fmt(n?: number | null, d = 1): string {
  if (n == null || isNaN(n)) return '-'
  return n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function pct(n: number): string {
  return n.toFixed(2) + '%'
}

export function uniq(data: ProductionRecord[], field: keyof ProductionRecord): string[] {
  return [...new Set(data.map(r => r[field] as string).filter(Boolean))].sort()
}

export function applyFilter(data: ProductionRecord[], f: FilterState): ProductionRecord[] {
  return data.filter(r => {
    if (f.machine  && r.machine   !== f.machine)   return false
    if (f.customer && r.customer  !== f.customer)  return false
    if (f.size     && r.size      !== f.size)      return false
    if (f.shift    && r.shift     !== f.shift)     return false
    if (f.from     && r.production_date < f.from)  return false
    if (f.to       && r.production_date > f.to)    return false
    if (f.search) {
      const q = f.search.toLowerCase()
      return [r.customer, r.machine, r.order_no, r.product_code, r.size, r.production_date]
        .some(v => v && String(v).toLowerCase().includes(q))
    }
    return true
  })
}

export function kpiCalc(data: ProductionRecord[]): KpiData {
  let fg = 0, rolls = 0, sc = 0, rw = 0, pl = 0, rwFg = 0, rwScrap = 0
  data.forEach(r => {
    fg      += r.fg_kg     ?? 0
    rolls   += r.fg_rolls  ?? 0
    sc      += r.scrap_kg  ?? 0
    rw      += r.rework_kg ?? 0
    pl      += r.planned_kg ?? 0
    rwFg    += r.rework_fg_kg ?? 0
    rwScrap += r.rework_scrap_kg ?? 0
  })
  // Total = "ออกจากเครื่อง (ผลิต)" = FG ผลิตได้ + กรอ(เสีย) + เศษจากผลิต
  //   กรอคืน (rwFg) + เศษจากกรอ (rwScrap) เป็นผลของ "การกรอ" (downstream) → ไม่นับใน total
  const fgFirst   = Math.max(0, fg - rwFg)      // FG ที่ผลิตจากเครื่องครั้งแรก
  const prodScrap = Math.max(0, sc - rwScrap)   // เศษจากผลิต (ไม่รวมเศษจากกรอ)
  const t = fgFirst + rw + prodScrap
  return { fg, rolls, sc, rw, pl, t, rwFg, rwScrap, fgP: t > 0 ? fgFirst/t*100 : 0, lossP: t > 0 ? (rw+prodScrap)/t*100 : 0, scP: fg > 0 ? sc/fg*100 : 0, rwP: fg > 0 ? rw/fg*100 : 0 }
}

export function machineAgg(data: ProductionRecord[]) {
  const m: Record<string, { fg: number; sc: number; rw: number; rolls: number }> = {}
  data.forEach(r => {
    if (!r.machine) return
    if (!m[r.machine]) m[r.machine] = { fg: 0, sc: 0, rw: 0, rolls: 0 }
    m[r.machine].fg    += r.fg_kg     ?? 0
    m[r.machine].sc    += r.scrap_kg  ?? 0
    m[r.machine].rw    += r.rework_kg ?? 0
    m[r.machine].rolls += r.fg_rolls  ?? 0
  })
  return BLS.filter(k => m[k]).map(k => ({ m: k, ...m[k] }))
}

export function dailyAgg(data: ProductionRecord[]) {
  const m: Record<string, { fg: number; sc: number; rw: number }> = {}
  data.forEach(r => {
    if (!r.production_date) return
    if (!m[r.production_date]) m[r.production_date] = { fg: 0, sc: 0, rw: 0 }
    m[r.production_date].fg += r.fg_kg     ?? 0
    m[r.production_date].sc += r.scrap_kg  ?? 0
    m[r.production_date].rw += r.rework_kg ?? 0
  })
  return Object.entries(m).sort().map(([d, v]) => ({ d, ...v }))
}

export function customerAgg(data: ProductionRecord[]) {
  const m: Record<string, number> = {}
  data.forEach(r => {
    if (!r.customer) return
    m[r.customer] = (m[r.customer] ?? 0) + (r.fg_kg ?? 0)
  })
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, fg]) => ({ c, fg }))
}

export function symptomAgg(data: ProductionRecord[]) {
  const m: Record<string, { s: string; n: number; l: number }> = {}
  data.forEach(r => {
    if (!r.symptom) return
    const k = r.symptom.trim()
    if (!m[k]) m[k] = { s: k, n: 0, l: 0 }
    m[k].n++
    m[k].l += (r.scrap_kg ?? 0) + (r.rework_kg ?? 0)
  })
  return Object.values(m).sort((a, b) => b.l - a.l).slice(0, 15)
}

export function machineCauseAgg(data: ProductionRecord[]) {
  const m: Record<string, Record<string, { c: string; n: number; l: number; syms: Record<string, number> }>> = {}
  data.forEach(r => {
    if (!r.machine || !r.cause || r.cause === '-') return
    if (!m[r.machine]) m[r.machine] = {}
    const k = r.cause.trim()
    if (!m[r.machine][k]) m[r.machine][k] = { c: k, n: 0, l: 0, syms: {} }
    m[r.machine][k].n++
    m[r.machine][k].l += (r.scrap_kg ?? 0) + (r.rework_kg ?? 0)
    if (r.symptom) {
      const s = r.symptom.trim()
      m[r.machine][k].syms[s] = (m[r.machine][k].syms[s] ?? 0) + 1
    }
  })
  const res: Record<string, { c: string; n: number; l: number; syms: Record<string, number> }[]> = {}
  BLS.forEach(bl => { if (m[bl]) res[bl] = Object.values(m[bl]).sort((a, b) => b.l - a.l) })
  return res
}

// ── Excel parsing ─────────────────────────────────────────────────────────────
function excelDateToISO(v: unknown): string | null {
  if (!v) return null
  if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}/)) return v.slice(0, 10)
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
  }
  return null
}

const NUM_FIELDS = new Set(['planned_kg','planned_rolls','fg_kg','fg_rolls','wip_kg','scrap_kg','rework_kg','rework_rolls'])
const NUM_LIMITS: Record<string, number> = {
  fg_kg: 500000, scrap_kg: 500000, rework_kg: 500000, wip_kg: 500000, planned_kg: 500000,
  fg_rolls: 9999, rework_rolls: 9999, planned_rolls: 9999,
}

const CMAP_BL: Record<number, string>    = {0:"production_date",1:"start_time",3:"order_no",4:"sales_order",5:"machine",8:"product_code",9:"size",10:"customer",11:"product_group",12:"planned_kg",13:"planned_rolls",14:"fg_kg",15:"fg_rolls",18:"wip_kg",20:"scrap_kg",24:"shift",28:"symptom",29:"cause",30:"action",31:"rework_kg",32:"rework_rolls"}
const CMAP_DATA: Record<number, string>  = {0:"production_date",6:"start_time",9:"order_no",10:"sales_order",11:"machine",14:"product_code",15:"size",16:"customer",17:"product_group",18:"planned_kg",19:"planned_rolls",20:"fg_kg",21:"fg_rolls",24:"wip_kg",26:"scrap_kg",32:"shift",36:"symptom",37:"cause",38:"action",39:"rework_kg",40:"rework_rolls"}
const CMAP_ALL: Record<number, string>   = {4:"production_date",5:"start_time",7:"order_no",8:"sales_order",9:"machine",12:"product_code",13:"size",14:"customer",15:"product_group",16:"planned_kg",17:"planned_rolls",18:"fg_kg",19:"fg_rolls",22:"wip_kg",24:"scrap_kg",28:"shift",32:"symptom",33:"cause",34:"action",35:"rework_kg",36:"rework_rolls"}
const CMAP_ALL_V2: Record<number, string>= {7:"production_date",8:"start_time",10:"order_no",11:"sales_order",12:"machine",15:"product_code",16:"size",17:"customer",18:"product_group",19:"planned_kg",20:"planned_rolls",21:"fg_kg",22:"fg_rolls",25:"wip_kg",27:"scrap_kg",31:"shift",35:"symptom",36:"cause",37:"action",38:"rework_kg",39:"rework_rolls"}

// Thai header → field name mapping (Easy Entry format)
const THAI_HEADER_MAP: Record<string, string> = {
  'วันที่ผลิต': 'production_date', 'production_date': 'production_date',
  'เครื่องจักร': 'machine',        'machine': 'machine',
  'กะ':          'shift',           'shift': 'shift',
  'ลูกค้า':      'customer',        'customer': 'customer',
  'รหัสสินค้า':  'product_code',    'product_code': 'product_code',
  'ขนาด':        'size',            'size': 'size',
  'fg (kg)':     'fg_kg',           'fg_kg': 'fg_kg',
  'fg (ม้วน)':   'fg_rolls',        'fg_rolls': 'fg_rolls',
  'ของเสีย (kg)':'scrap_kg',        'scrap_kg': 'scrap_kg',
  'ของซ่อม (kg)':'rework_kg',       'rework_kg': 'rework_kg',
  'เลขที่ใบสั่ง':'order_no',        'order_no': 'order_no',
  'sales order':  'sales_order',    'sales_order': 'sales_order',
  'แผน (kg)':    'planned_kg',      'planned_kg': 'planned_kg',
  'แผน (ม้วน)':  'planned_rolls',   'planned_rolls': 'planned_rolls',
  'อาการ':        'symptom',         'symptom': 'symptom',
  'สาเหตุ':       'cause',           'cause': 'cause',
  'การแก้ไข':    'action',          'action': 'action',
  'เวลาเริ่ม':   'start_time',      'start_time': 'start_time',
  'กลุ่มสินค้า': 'product_group',   'product_group': 'product_group',
  'wip (kg)':    'wip_kg',          'wip_kg': 'wip_kg',
}

function buildCmapFromHeader(headerRow: unknown[]): Record<number, string> | null {
  const cmap: Record<number, string> = {}
  let matched = 0
  headerRow.forEach((h, i) => {
    if (!h) return
    const key = String(h).toLowerCase().replace(/\n.*$/, '').replace(/\s*\*\s*$/, '').trim()
    const field = THAI_HEADER_MAP[key]
    if (field) { cmap[i] = field; matched++ }
  })
  return matched >= 3 ? cmap : null
}

export function parseExcelRows(rows: unknown[][]): ProductionRecord[] {
  const records: ProductionRecord[] = []

  // Try header-based detection on first row
  let headerCmap: Record<number, string> | null = null
  let dataStart = 0
  if (rows.length > 0) {
    headerCmap = buildCmapFromHeader(rows[0])
    if (headerCmap) dataStart = 1
  }

  rows.slice(dataStart).forEach((row, rowIndex) => {
    let cmap: Record<number, string>
    if (headerCmap) {
      cmap = headerCmap
    } else {
      const len = row.length
      cmap = len >= 40 ? CMAP_ALL_V2 : len >= 37 ? CMAP_ALL : len >= 33 ? CMAP_DATA : CMAP_BL
    }
    const machCol = Object.entries(cmap).find(([, v]) => v === 'machine')?.[0]
    const dateCol = Object.entries(cmap).find(([, v]) => v === 'production_date')?.[0]
    if (!machCol || !dateCol || !row[parseInt(dateCol)]) return
    const rec: Partial<ProductionRecord> = {}
    for (const [ci, field] of Object.entries(cmap)) {
      let v = row[parseInt(ci)]
      if (field === 'production_date') { rec[field] = excelDateToISO(v) ?? undefined; continue }
      if (NUM_FIELDS.has(field)) {
        const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
        if (isNaN(n) || n < 0) { (rec as any)[field] = null; continue }
        const lim = NUM_LIMITS[field]
        ;(rec as any)[field] = lim && n > lim ? null : parseFloat(n.toFixed(4))
        continue
      }
      if (v != null && v !== '') (rec as any)[field] = String(v).trim()
    }
    // normalise shift: เช้า→A, บ่าย→B, ดึก/กลางคืน→C
    if (rec.shift) {
      const s = String(rec.shift).trim()
      if (/เช้า|morning|^a$/i.test(s))           rec.shift = 'A'
      else if (/บ่าย|afternoon|^b$/i.test(s))    rec.shift = 'B'
      else if (/ดึก|กลางคืน|night|^c$/i.test(s)) rec.shift = 'C'
    }
    if (!rec.shift) rec.shift = 'unknown'
    // machine normalise
    if (rec.machine) {
      const m = String(rec.machine).trim().toUpperCase()
      rec.machine = m.startsWith('BL') ? m : 'BL' + m.replace(/\D/g, '').padStart(2, '0')
    }
    if (rec.production_date && rec.machine) {
      // row_key เป็น fingerprint ของเนื้อหา — ถ้าเหมือนเดิมเป๊ะ จะถูกข้าม
      const parts = [
        rec.production_date,
        rec.machine,
        rec.order_no    ?? '',
        rec.shift       ?? '',
        rec.product_code?? '',
        String(rec.fg_kg     ?? ''),
        String(rec.fg_rolls  ?? ''),
        String(rec.scrap_kg  ?? ''),
        String(rec.rework_kg ?? ''),
      ]
      rec.row_key = parts.join('|')
      records.push(rec as ProductionRecord)
    }
  })
  return records
}
