// สร้าง public/version.json จาก APP_VERSION ใน src/version.ts (รันก่อน build)
// ใช้ให้แอปที่ติดตั้งแล้วเช็คว่ามีเวอร์ชันใหม่ → เด้งให้รีเฟรช
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/version.ts', import.meta.url), 'utf8')
const m = src.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)
const version = m ? m[1] : '0.0.0'
writeFileSync(new URL('../public/version.json', import.meta.url), JSON.stringify({ version }) + '\n')
console.log('version.json →', version)
