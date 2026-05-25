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
  return { comPort: '', baudRate: 9600 }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

let config = loadConfig()
let currentPort = null
let lastWeight = { value: 0, stable: false, raw: '', timestamp: 0, connected: false }

// ── เปิด Serial Port ──────────────────────────────────────
async function openSerial() {
  if (currentPort) {
    try { currentPort.close() } catch {}
    currentPort = null
  }
  if (!config.comPort) {
    console.log('[bridge] ยังไม่ได้เลือก COM port')
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
    currentPort.open(err => {
      if (err) {
        console.error('[bridge] เปิด port ไม่สำเร็จ:', err.message)
        lastWeight.connected = false
        broadcast()
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
      console.error('[bridge] serial error:', e.message)
      lastWeight.connected = false
      broadcast()
    })
    currentPort.on('close', () => {
      console.log('[bridge] port closed')
      lastWeight.connected = false
      broadcast()
    })
  } catch (e) {
    console.error('[bridge] open error:', e.message)
  }
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

app.get('/status', (req, res) => res.json({ ...lastWeight, config }))
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

// Config UI (เปิดที่ http://localhost:8080)
app.get('/', async (req, res) => {
  const ports = await SerialPort.list().catch(() => [])
  res.send(`<!DOCTYPE html><html><head>
    <meta charset="utf-8"/><title>BWP Scale Bridge</title>
    <style>
      body{font-family:Sarabun,Arial,sans-serif;background:#0a0f1e;color:#fff;padding:20px;max-width:600px;margin:auto}
      h1{color:#3b82f6}
      .card{background:#1e293b;padding:20px;border-radius:12px;margin-bottom:16px}
      label{display:block;margin:8px 0 4px;color:#94a3b8;font-size:13px}
      select,input{width:100%;padding:8px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#fff;font-size:14px}
      button{background:#3b82f6;color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold}
      .status{font-family:monospace;color:#10b981;font-size:24px;font-weight:bold;text-align:center;padding:20px}
      .raw{font-family:monospace;background:#020617;padding:8px;border-radius:6px;font-size:11px;color:#64748b;word-break:break-all}
      .ok{color:#10b981}.bad{color:#ef4444}
    </style></head><body>
    <h1>⚖ BWP Scale Bridge</h1>
    <div class="card">
      <label>COM Port</label>
      <select id="comPort">
        <option value="">— เลือก —</option>
        ${ports.map(p => `<option value="${p.path}" ${p.path===config.comPort?'selected':''}>${p.path} ${p.friendlyName ? `(${p.friendlyName})` : ''}</option>`).join('')}
      </select>
      <label>Baud Rate</label>
      <select id="baudRate">
        ${[1200,2400,4800,9600,19200,38400,57600,115200].map(b => `<option value="${b}" ${b===config.baudRate?'selected':''}>${b}</option>`).join('')}
      </select>
      <p style="margin-top:16px"><button onclick="save()">💾 บันทึก + เชื่อมต่อ</button></p>
    </div>
    <div class="card">
      <p style="color:#94a3b8;font-size:12px">สถานะ: <span id="status" class="bad">ยังไม่เชื่อมต่อ</span></p>
      <div class="status" id="weight">— Kgs.</div>
      <p style="color:#64748b;font-size:11px;margin-bottom:6px">Raw data:</p>
      <div class="raw" id="raw">—</div>
    </div>
    <script>
      async function save() {
        const comPort = document.getElementById('comPort').value
        const baudRate = parseInt(document.getElementById('baudRate').value)
        await fetch('/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({comPort, baudRate}) })
        alert('บันทึกแล้ว')
      }
      const ws = new WebSocket('ws://' + location.host)
      ws.onmessage = e => {
        const d = JSON.parse(e.data)
        document.getElementById('weight').textContent = d.value.toFixed(2) + ' Kgs. ' + (d.stable ? '✓' : '...')
        document.getElementById('status').textContent = d.connected ? '● เชื่อมต่อแล้ว' : '○ ยังไม่เชื่อมต่อ'
        document.getElementById('status').className = d.connected ? 'ok' : 'bad'
        document.getElementById('raw').textContent = d.raw || '—'
      }
    </script>
  </body></html>`)
})

const server = app.listen(PORT, () => {
  console.log(`[bridge] 🚀 http://localhost:${PORT}`)
  console.log(`[bridge] WebSocket: ws://localhost:${PORT}`)
  if (config.comPort) openSerial()
  else console.log('[bridge] เปิด UI ที่ http://localhost:8080 เพื่อตั้งค่า COM port')
})

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
})

// ส่งสถานะปัจจุบันให้ client ใหม่ทันที
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'weight', ...lastWeight }))
})
