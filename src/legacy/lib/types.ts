export interface ProductionRecord {
  id?: number
  row_key?: string
  production_date: string
  start_time?: string
  order_no?: string
  sales_order?: string
  machine: string
  product_code?: string
  size?: string
  customer?: string
  product_group?: string
  planned_kg?: number
  planned_rolls?: number
  fg_kg?: number
  fg_rolls?: number
  wip_kg?: number
  scrap_kg?: number
  shift?: string
  symptom?: string
  cause?: string
  action?: string
  rework_kg?: number
  rework_rolls?: number
}

export interface KpiData {
  fg: number
  rolls: number
  sc: number
  rw: number
  pl: number
  t: number
  fgP: number
  lossP: number
  scP: number
  rwP: number
}

export interface FilterState {
  from: string
  to: string
  machine: string
  customer: string
  size: string
  shift: string
  search: string
}
