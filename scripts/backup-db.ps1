<#
================================================================
  backup-db.ps1 — สำรองฐานข้อมูล Supabase (PostgreSQL) ครบทั้งก้อน
  โครงสร้าง (schema) + ข้อมูล (data) ด้วย pg_dump
================================================================

วิธีใช้ (เปิด PowerShell ในโฟลเดอร์โปรเจค):

  # 1) เอา connection string จาก Supabase:
  #    Dashboard → Settings → Database → Connection string → เลือก "URI"
  #    จะได้แบบ:  postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres
  #    *แทน [PASSWORD] ด้วยรหัส database จริง*

  # 2) รัน (ดัมพ์ทั้ง custom + plain .sql):
  .\scripts\backup-db.ps1 -ConnString "postgresql://postgres:รหัส@db.xxxx.supabase.co:5432/postgres"

  # เลือกเฉพาะรูปแบบ:
  .\scripts\backup-db.ps1 -ConnString "..." -Format custom   # ไฟล์ .dump (กู้ด้วย pg_restore)
  .\scripts\backup-db.ps1 -ConnString "..." -Format plain    # ไฟล์ .sql (อ่าน/แก้ได้, บีบเป็น .zip)

  # เปลี่ยนที่เก็บไฟล์ (เช่นใส่ Google Drive ที่ sync ไว้):
  .\scripts\backup-db.ps1 -ConnString "..." -OutDir "G:\My Drive\bwp-backups"

ต้องมี pg_dump ก่อน (มากับ PostgreSQL client):
  - ลง PostgreSQL: https://www.postgresql.org/download/windows/  (เลือกเฉพาะ Command Line Tools ก็พอ)
  - หรือถ้ามี Supabase CLI: ใช้  supabase db dump  แทนก็ได้
  - แนะนำ pg_dump เวอร์ชัน >= 15 (ให้ตรง/ใหม่กว่าเซิร์ฟเวอร์ ไม่งั้นอาจขึ้น version mismatch)

หมายเหตุ: --no-owner --no-privileges ทำให้กู้คืนไป DB/Supabase project ใหม่ได้ง่าย
          (ไม่ติดปัญหา role/สิทธิ์ที่ต่างกัน)
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$ConnString,

  [ValidateSet('both', 'custom', 'plain')]
  [string]$Format = 'both',

  [string]$OutDir = "$PSScriptRoot\..\backups"
)

$ErrorActionPreference = 'Stop'

# --- ตรวจว่ามี pg_dump ไหม ---
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  Write-Host "[X] ไม่พบ pg_dump" -ForegroundColor Red
  Write-Host "    ติดตั้ง PostgreSQL Command Line Tools ก่อน:" -ForegroundColor Yellow
  Write-Host "    https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
  Write-Host "    (หรือเพิ่มโฟลเดอร์ ...\PostgreSQL\<ver>\bin เข้า PATH)" -ForegroundColor Yellow
  exit 1
}
Write-Host "[i] pg_dump: $((pg_dump --version) -join ' ')" -ForegroundColor Cyan

# --- เตรียมโฟลเดอร์ปลายทาง ---
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
$OutDir = (Resolve-Path $OutDir).Path

# --- ดึงชื่อ host มาตั้งชื่อไฟล์ (กันสับสนระหว่างหลาย project) ---
$dbHost = 'db'
if ($ConnString -match '@([^:/]+)') { $dbHost = ($Matches[1] -split '\.')[0] }
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$baseName = "bwp_${dbHost}_$stamp"

$common = @('--no-owner', '--no-privileges', '--verbose')

function Show-Result($path) {
  if (Test-Path $path) {
    $mb = [math]::Round((Get-Item $path).Length / 1MB, 2)
    Write-Host "[OK] $path  ($mb MB)" -ForegroundColor Green
  } else {
    Write-Host "[X] ไม่ได้ไฟล์: $path" -ForegroundColor Red
  }
}

Write-Host "[i] เริ่มสำรองข้อมูลจาก host '$dbHost' ..." -ForegroundColor Cyan

# --- custom format (.dump) — กู้ด้วย pg_restore, บีบอัดในตัว, เลือกกู้บางตารางได้ ---
if ($Format -eq 'both' -or $Format -eq 'custom') {
  $dump = Join-Path $OutDir "$baseName.dump"
  Write-Host "[i] ดัมพ์ custom format -> $dump" -ForegroundColor Cyan
  & pg_dump $ConnString -Fc @common -f $dump
  if ($LASTEXITCODE -ne 0) { Write-Host "[X] pg_dump (custom) ล้มเหลว (exit $LASTEXITCODE)" -ForegroundColor Red; exit $LASTEXITCODE }
  Show-Result $dump
}

# --- plain SQL (.sql) — อ่าน/แก้ได้ แล้วบีบเป็น .zip ---
if ($Format -eq 'both' -or $Format -eq 'plain') {
  $sql = Join-Path $OutDir "$baseName.sql"
  Write-Host "[i] ดัมพ์ plain SQL -> $sql" -ForegroundColor Cyan
  & pg_dump $ConnString @common -f $sql
  if ($LASTEXITCODE -ne 0) { Write-Host "[X] pg_dump (plain) ล้มเหลว (exit $LASTEXITCODE)" -ForegroundColor Red; exit $LASTEXITCODE }
  $zip = Join-Path $OutDir "$baseName.sql.zip"
  Compress-Archive -Path $sql -DestinationPath $zip -Force
  Remove-Item $sql -Force
  Show-Result $zip
}

Write-Host ""
Write-Host "[DONE] สำรองเสร็จ เก็บไว้ที่: $OutDir" -ForegroundColor Green
Write-Host ""
Write-Host "วิธีกู้คืน (ไป DB/Supabase project ใหม่):" -ForegroundColor Yellow
Write-Host "  • custom : pg_restore --no-owner --no-privileges -d ""<conn ปลายทาง>"" $baseName.dump" -ForegroundColor Gray
Write-Host "  • plain  : แตก .zip แล้ว  psql ""<conn ปลายทาง>"" -f $baseName.sql" -ForegroundColor Gray
