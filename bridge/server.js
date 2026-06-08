// ── BWP Scale Bridge ─────────────────────────────────────────
// อ่านค่าน้ำหนักจาก Serial Port → broadcast ผ่าน WebSocket
// ─────────────────────────────────────────────────────────────

const { SerialPort } = require('serialport')
const WebSocket = require('ws')
const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const PORT = 8080
// ── หา path สำหรับเก็บ config (writable) ──
// เมื่อรันเป็น .exe (pkg) → __dirname เป็น virtual fs read-only
// ใช้ path ข้าง .exe (process.execPath) หรือ cwd แทน
function getConfigPath() {
  const isPkg = typeof process.pkg !== 'undefined'
  if (isPkg) {
    return path.join(path.dirname(process.execPath), 'config.json')
  }
  return path.join(__dirname, 'config.json')
}
const CONFIG_FILE = getConfigPath()
console.log('[bridge] config file:', CONFIG_FILE)

// ── โหลด/บันทึก config ────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    }
  } catch (e) { console.warn('load config error', e.message) }
  return { comPort: '', baudRate: 9600, scales: [] }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

let config = loadConfig()
if (!Array.isArray(config.scales)) config.scales = []
let currentPort = null
let lastWeight = { value: 0, stable: false, raw: '', timestamp: 0, connected: false, standby: false }

// ── โหมดแย่ง COM อัตโนมัติ ────────────────────────────────
// standby = true  → ปล่อยให้โปรแกรมเก่าใช้ COP (บริดไม่แย่ง)
// standby = false → บริดพยายามจับ COM ทุก 2 วิ จนได้ (โปรแกรมเก่าปิดปุ๊บ จับเอง)
let standby = false
let retryTimer = null
const RETRY_MS = 2000

function scheduleRetry(reason) {
  if (standby) return
  if (retryTimer) return            // กันตั้งซ้อน
  retryTimer = setTimeout(() => {
    retryTimer = null
    openSerial()
  }, RETRY_MS)
  if (reason) console.log(`[bridge] COM ไม่ว่าง (${reason}) → ลองใหม่ใน ${RETRY_MS/1000}s`)
}

// ── ค้นหาเครื่องชั่งอัตโนมัติ (สแกนทุก COM หาตัวที่ส่งน้ำหนัก) ──────────────
let autoDetecting = false
let autoTimer = null
const COMMON_BAUDS = [9600, 1200, 2400, 4800, 19200, 38400]

// ลองเปิดพอร์ต+baud แล้วฟังว่ามีตัวเลข (น้ำหนัก) ไหลมาไหม ภายใน ms
function probePort(path, baud, ms) {
  return new Promise(resolve => {
    let sp, done = false
    const finish = (ok) => { if (done) return; done = true; try { sp && sp.isOpen && sp.close() } catch {} resolve(ok) }
    try {
      sp = new SerialPort({ path, baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', autoOpen: false })
      sp.open(err => {
        if (err) return finish(false)
        let buf = ''
        sp.on('data', c => { buf += c.toString('utf8'); if (/\d+\.\d+/.test(buf) || /\d{3,}/.test(buf)) finish(true) })
      })
      sp.on('error', () => finish(false))
      setTimeout(() => finish(false), ms)
    } catch { finish(false) }
  })
}

async function autoDetect() {
  if (standby || autoDetecting) return
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  if (currentPort) { try { currentPort.close() } catch {} currentPort = null }
  autoDetecting = true
  lastWeight.connected = false; lastWeight.detecting = true; broadcast()
  console.log('[bridge] 🔍 ค้นหาเครื่องชั่งอัตโนมัติ...')
  try {
    const ports = await SerialPort.list().catch(() => [])
    if (!ports.length) console.log('[bridge] ไม่พบ COM port ใดๆ (เสียบสาย/ลง driver หรือยัง?)')
    for (const baud of COMMON_BAUDS) {
      for (const p of ports) {
        if (standby) { autoDetecting = false; lastWeight.detecting = false; return }
        const ok = await probePort(p.path, baud, 2200)
        if (ok) {
          console.log(`[bridge] ✅ เจอเครื่องชั่งที่ ${p.path} @ ${baud} baud`)
          config.comPort = p.path; config.baudRate = baud; saveConfig(config)
          autoDetecting = false; lastWeight.detecting = false
          openSerial()
          return
        }
      }
    }
  } catch (e) { console.warn('[bridge] autoDetect error:', e.message) }
  autoDetecting = false; lastWeight.detecting = false; broadcast()
  console.log('[bridge] ยังไม่เจอเครื่องชั่ง — ลองใหม่ใน 6 วิ')
  autoTimer = setTimeout(autoDetect, 6000)
}

// ── เปิด Serial Port ──────────────────────────────────────
async function openSerial() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  if (currentPort) {
    try { currentPort.close() } catch {}
    currentPort = null
  }
  if (standby) { lastWeight.connected = false; lastWeight.standby = true; broadcast(); return }
  lastWeight.standby = false
  if (!config.comPort) {
    // ยังไม่เคยตั้ง COM → ค้นหาเครื่องชั่งอัตโนมัติเลย
    autoDetect()
    return
  }
  try {
    currentPort = new SerialPort({
      path: config.comPort,
      baudRate: config.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false,
    })
    currentPort.open(async err => {
      if (err) {
        lastWeight.connected = false
        broadcast()
        // ถ้าพอร์ตที่ตั้งไว้ "หายไปแล้ว" (ถอดสาย/เปลี่ยนเครื่อง) → ค้นหาใหม่อัตโนมัติ
        const ports = await SerialPort.list().catch(() => [])
        const stillThere = ports.some(p => p.path === config.comPort)
        if (!stillThere) { console.log(`[bridge] ${config.comPort} หายไป → ค้นหาใหม่`); config.comPort = ''; autoDetect(); return }
        // พอร์ตยังอยู่แต่เปิดไม่ได้ (โปรแกรมเก่าจับอยู่) → ลองใหม่เรื่อยๆ
        scheduleRetry(err.message)
        return
      }
      console.log(`[bridge] ✅ เชื่อมต่อ ${config.comPort} @ ${config.baudRate} baud`)
      lastWeight.connected = true
      broadcast()
    })

    let buf = ''
    currentPort.on('data', (chunk) => {
      const str = chunk.toString('utf8')
      buf += str
      lastWeight.raw = (lastWeight.raw + str).slice(-200)

      // หาตัวเลขทศนิยมทั้งหมดใน buffer → เอาตัวสุดท้าย (ใหม่ที่สุด)
      const nums = [...buf.matchAll(/(\d+\.\d+)/g)]
      if (nums.length > 0) {
        const v = parseFloat(nums[nums.length - 1][1])
        if (!isNaN(v) && v >= 0) {
          lastWeight.value = parseFloat(v.toFixed(2))
          lastWeight.stable = !buf.toUpperCase().includes('US,')
          lastWeight.timestamp = Date.now()
          broadcast()
        }
        buf = '' // ล้าง buffer หลัง parse
      }

      if (buf.length > 200) buf = buf.slice(-100)
    })

    currentPort.on('error', (e) => {
      lastWeight.connected = false
      broadcast()
      scheduleRetry('error: ' + e.message)
    })
    currentPort.on('close', () => {
      console.log('[bridge] port closed')
      lastWeight.connected = false
      broadcast()
      scheduleRetry('closed')   // โปรแกรมอื่นอาจแย่งไป → พยายามจับกลับ
    })
  } catch (e) {
    console.error('[bridge] open error:', e.message)
    scheduleRetry('exception')
  }
}

// ── ปล่อย COM ให้โปรแกรมเก่า / เอากลับมา ──────────────────
function releaseCom() {
  standby = true
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  if (currentPort) { try { currentPort.close() } catch {} currentPort = null }
  lastWeight.connected = false
  lastWeight.standby = true
  console.log('[bridge] ⏸ ปล่อย COM ให้โปรแกรมเก่า (standby)')
  broadcast()
}
function acquireCom() {
  standby = false
  console.log('[bridge] ▶ กลับมาจับ COM')
  openSerial()
}

// ── WebSocket Server ─────────────────────────────────────
const wss = new WebSocket.Server({ noServer: true })
function broadcast() {
  const msg = JSON.stringify({ type: 'weight', ...lastWeight })
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg)
  })
}

// broadcast keepalive ทุก 50ms (fallback กรณี parse ไม่ได้)
setInterval(() => {
  if (wss.clients.size > 0) broadcast()
}, 50)

// ── HTTP API + Config UI ─────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json())

app.get('/status', (req, res) => res.json({ ...lastWeight, config, standby }))
// ปล่อย COM ให้โปรแกรมเก่า / เอากลับมา
app.post('/autodetect', (req, res) => { config.comPort=''; autoDetect(); res.json({ detecting: true }) })
app.post('/release', (req, res) => { releaseCom(); res.json({ standby }) })
app.post('/acquire', (req, res) => { acquireCom(); res.json({ standby }) })
app.get('/ports', async (req, res) => {
  try {
    const list = await SerialPort.list()
    res.json(list.map(p => ({ path: p.path, manufacturer: p.manufacturer, friendlyName: p.friendlyName })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/config', (req, res) => {
  try {
    const { comPort, baudRate } = req.body
    if (comPort !== undefined) config.comPort = comPort
    if (baudRate !== undefined) config.baudRate = baudRate
    saveConfig(config)
    openSerial()
    res.json(config)
  } catch (e) {
    console.error('[bridge] /config error:', e)
    res.status(500).json({ error: e.message, path: CONFIG_FILE })
  }
})

// ── บันทึก/ลบ "เครื่องชั่ง" ที่จำไว้ ─────────────────────────
app.post('/scales', (req, res) => {
  try {
    const { action, name, comPort, baudRate, index } = req.body
    if (!Array.isArray(config.scales)) config.scales = []
    if (action === 'add') {
      if (!name || !comPort) return res.status(400).json({ error: 'ต้องมีชื่อและ COM port' })
      // ถ้าชื่อซ้ำ → อัปเดตตัวเดิม
      const exist = config.scales.findIndex(s => s.name === name)
      const item = { name, comPort, baudRate: baudRate || 9600 }
      if (exist >= 0) config.scales[exist] = item
      else config.scales.push(item)
    } else if (action === 'delete') {
      if (typeof index === 'number') config.scales.splice(index, 1)
    }
    saveConfig(config)
    res.json(config)
  } catch (e) {
    console.error('[bridge] /scales error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Config UI (เปิดที่ http://localhost:8080)
app.get('/', async (req, res) => {
  const ports = await SerialPort.list().catch(() => [])
  res.send(`<!DOCTYPE html><html><head>
    <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>BWP Scale Bridge</title>
    <style>
      body{font-family:Sarabun,Arial,sans-serif;background:#0a0f1e;color:#fff;padding:20px;max-width:640px;margin:auto}
      h1{color:#3b82f6;font-size:22px}
      .card{background:#1e293b;padding:18px;border-radius:14px;margin-bottom:16px}
      label{display:block;margin:8px 0 4px;color:#94a3b8;font-size:13px}
      select,input{width:100%;padding:9px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#fff;font-size:14px;box-sizing:border-box}
      button{background:#3b82f6;color:#fff;border:0;padding:10px 18px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:14px}
      .status{font-family:monospace;color:#10b981;font-size:30px;font-weight:bold;text-align:center;padding:16px}
      .raw{font-family:monospace;background:#020617;padding:8px;border-radius:6px;font-size:11px;color:#64748b;word-break:break-all}
      .ok{color:#10b981}.bad{color:#ef4444}
      h2{font-size:15px;color:#cbd5e1;margin:0 0 12px}
      .scaleBtn{display:flex;align-items:center;justify-content:space-between;width:100%;padding:14px 16px;margin-bottom:8px;border-radius:12px;
        background:#0f172a;border:2px solid #334155;color:#fff;cursor:pointer;text-align:left}
      .scaleBtn:hover{border-color:#3b82f6}
      .scaleBtn.active{border-color:#10b981;background:#0d2a1f}
      .scaleBtn .nm{font-size:17px;font-weight:bold}
      .scaleBtn .meta{font-size:12px;color:#94a3b8}
      .scaleBtn .badge{font-size:11px;color:#10b981;font-weight:bold}
      .del{background:#7f1d1d;padding:6px 10px;font-size:12px;border-radius:6px;margin-left:8px}
      .muted{color:#64748b;font-size:12px}
      .row{display:flex;gap:8px}.row>*{flex:1}
      details summary{cursor:pointer;color:#94a3b8;font-size:13px;padding:4px 0}
    </style></head><body>
    <h1>⚖ BWP Scale Bridge</h1>

    <!-- น้ำหนักสด + สถานะ -->
    <div class="card">
      <p class="muted">สถานะ: <span id="status" class="bad">ยังไม่เชื่อมต่อ</span> · ใช้อยู่: <b id="curName">—</b></p>
      <div class="status" id="weight">— Kgs.</div>
      <p class="muted" style="margin-bottom:6px">Raw data:</p>
      <div class="raw" id="raw">—</div>
    </div>

    <!-- แชร์เครื่องชั่งกับโปรแกรมเก่า -->
    <div class="card">
      <h2>🤝 แชร์เครื่องชั่งกับโปรแกรมเก่า</h2>
      <p class="muted" style="margin-bottom:10px">ปกติบริดจับ COM เอง · ถ้าจะใช้โปรแกรมเก่า กด "ปล่อย" → บริดถอยให้ · กด "เอากลับมา" เพื่อใช้แอปนี้ต่อ</p>
      <div class="row">
        <button id="btnRelease" onclick="release()" style="background:#b45309">⏸ ปล่อยให้โปรแกรมเก่า</button>
        <button id="btnAcquire" onclick="acquire()" style="background:#15803d">▶ เอากลับมาใช้แอปนี้</button>
      </div>
      <p id="standbyMsg" class="muted" style="margin-top:8px;display:none">⏸ <b style="color:#f59e0b">กำลังปล่อยให้โปรแกรมเก่า</b> — แอปนี้ยังไม่อ่านน้ำหนัก</p>
    </div>

    <!-- ปุ่มสลับเครื่องชั่งคลิกเดียว -->
    <div class="card">
      <h2>🔀 สลับเครื่องชั่ง (คลิกเดียว)</h2>
      <div id="scaleList"></div>
      <p id="noScale" class="muted" style="display:none">ยังไม่มีเครื่องชั่งที่บันทึกไว้ — เพิ่มด้านล่าง</p>
    </div>

    <!-- เพิ่ม/ตั้งค่าเครื่องชั่ง -->
    <details class="card">
      <summary>➕ เพิ่ม / ตั้งค่าเครื่องชั่ง</summary>
      <label>ชื่อเครื่องชั่ง (เช่น เครื่องชั่ง 1)</label>
      <input id="name" placeholder="เครื่องชั่ง 1"/>
      <div class="row">
        <div>
          <label>COM Port</label>
          <select id="comPort">
            <option value="">— เลือก —</option>
            ${ports.map(p => `<option value="${p.path}" ${p.path===config.comPort?'selected':''}>${p.path} ${p.friendlyName ? `(${p.friendlyName})` : ''}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Baud Rate</label>
          <select id="baudRate">
            ${[1200,2400,4800,9600,19200,38400,57600,115200].map(b => `<option value="${b}" ${b===config.baudRate?'selected':''}>${b}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="row" style="margin-top:14px">
        <button onclick="addScale()">💾 บันทึกเป็นเครื่องชั่ง</button>
        <button onclick="connectNow()" style="background:#475569">⚡ เชื่อมต่อทันที (ไม่บันทึก)</button>
      </p>
      <p class="muted">บันทึกครั้งเดียว ครั้งต่อไปกดปุ่มสลับด้านบนได้เลย</p>
    </details>

    <script>
      let cfg = { comPort:'', baudRate:9600, scales:[] }

      async function refresh() {
        const r = await fetch('/status'); const s = await r.json()
        cfg = s.config || cfg
        renderScales(s.connected)
      }
      function renderScales(connected) {
        const list = document.getElementById('scaleList')
        const scales = cfg.scales || []
        document.getElementById('noScale').style.display = scales.length ? 'none' : 'block'
        list.innerHTML = scales.map((sc, i) => {
          const active = sc.comPort === cfg.comPort
          const cur = active ? (connected ? ' · ● ทำงาน' : ' · ○ ไม่ติด') : ''
          return '<div class="scaleBtn '+(active?'active':'')+'">'
            + '<div onclick="switchTo('+i+')" style="flex:1">'
            +   '<div class="nm">'+escapeHtml(sc.name)+(active?' <span class="badge">(ใช้อยู่'+cur+')</span>':'')+'</div>'
            +   '<div class="meta">'+escapeHtml(sc.comPort)+' @ '+sc.baudRate+' baud</div>'
            + '</div>'
            + '<button class="del" onclick="delScale('+i+')">ลบ</button>'
            + '</div>'
        }).join('')
        const cs = (cfg.scales||[]).find(x => x.comPort === cfg.comPort)
        document.getElementById('curName').textContent = cs ? cs.name : (cfg.comPort || '—')
      }
      function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

      async function switchTo(i) {
        const sc = cfg.scales[i]; if (!sc) return
        await fetch('/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({comPort:sc.comPort, baudRate:sc.baudRate}) })
        await refresh()
      }
      async function delScale(i) {
        if (!confirm('ลบเครื่องชั่งนี้?')) return
        await fetch('/scales', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'delete', index:i}) })
        await refresh()
      }
      async function addScale() {
        const name = document.getElementById('name').value.trim()
        const comPort = document.getElementById('comPort').value
        const baudRate = parseInt(document.getElementById('baudRate').value)
        if (!name) { alert('กรุณาตั้งชื่อเครื่องชั่ง'); return }
        if (!comPort) { alert('กรุณาเลือก COM port'); return }
        await fetch('/scales', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'add', name, comPort, baudRate}) })
        // เชื่อมต่อเครื่องที่เพิ่งบันทึกเลย
        await fetch('/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({comPort, baudRate}) })
        document.getElementById('name').value = ''
        await refresh()
        alert('บันทึกแล้ว — ครั้งต่อไปกดปุ่มสลับด้านบนได้เลย')
      }
      async function connectNow() {
        const comPort = document.getElementById('comPort').value
        const baudRate = parseInt(document.getElementById('baudRate').value)
        if (!comPort) { alert('กรุณาเลือก COM port'); return }
        await fetch('/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({comPort, baudRate}) })
        await refresh()
      }
      async function release() {
        await fetch('/release', { method:'POST' })
        alert('ปล่อย COM แล้ว — เปิดโปรแกรมเก่าได้เลย\\n(พอเลิกใช้โปรแกรมเก่า กด "เอากลับมาใช้แอปนี้")')
      }
      async function acquire() { await fetch('/acquire', { method:'POST' }) }

      const ws = new WebSocket('ws://' + location.host)
      ws.onmessage = e => {
        const d = JSON.parse(e.data)
        const sb = !!d.standby
        document.getElementById('weight').textContent = d.value.toFixed(2) + ' Kgs. ' + (d.stable ? '✓' : '...')
        document.getElementById('status').textContent = sb ? '⏸ ปล่อยให้โปรแกรมเก่า' : (d.connected ? '● เชื่อมต่อแล้ว' : '○ รอจับ COM (โปรแกรมเก่าอาจถืออยู่)')
        document.getElementById('status').className = d.connected ? 'ok' : 'bad'
        document.getElementById('raw').textContent = d.raw || '—'
        document.getElementById('standbyMsg').style.display = sb ? 'block' : 'none'
      }
      refresh()
      setInterval(refresh, 5000)
    </script>
  </body></html>`)
})

const server = app.listen(PORT, () => {
  console.log(`[bridge] 🚀 http://localhost:${PORT}`)
  console.log(`[bridge] WebSocket: ws://localhost:${PORT}`)
  // มี COM ที่เคยตั้งไว้ → เปิดเลย · ยังไม่เคยตั้ง → ค้นหาเครื่องชั่งอัตโนมัติ
  if (config.comPort) openSerial()
  else autoDetect()
})

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
})

// ส่งสถานะปัจจุบันให้ client ใหม่ทันที
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'weight', ...lastWeight }))
})
