# Start-All.ps1 - Inicia os 3 servicos do mvpFacial em janelas separadas.
# Uso:
#   .\start-all.ps1            # inicia tudo
#   .\start-all.ps1 -Stop     # para tudo
#
# Servicos:
#   1. vision-service  (Python/FastAPI) -> http://localhost:8001
#   2. backend         (.NET 9)         -> http://localhost:5251
#   3. frontend        (Next.js)        -> http://localhost:3000
#
# Cada servico abre numa janela propria do Windows Terminal (ou console).
# Fechar a janela derruba o servico correspondente.
# ====================================================================

[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Build   # faz build antes de iniciar (backend e frontend)
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

# --- Helpers ---

function Write-Title($msg) {
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor DarkGray
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor DarkGray
}

function Test-Port($port) {
    $tcp = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return $tcp -ne $null
}

function Stop-ByPort($port, $name) {
    $tcp = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($tcp) {
        $tcp | ForEach-Object {
            try {
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop
                Write-Host "  [$name] parado (PID $($_.OwningProcess)) na porta $port" -ForegroundColor Yellow
            } catch {
                Write-Host "  [$name] nao consegui parar PID $($_.OwningProcess)" -ForegroundColor Red
            }
        }
    } else {
        Write-Host "  [$name] nao estava rodando (porta $port livre)" -ForegroundColor DarkGray
    }
}

function Start-NewWindow($title, $command, $workingDir) {
    # Usa start para abrir nova janela de console preservando o terminal atual.
    $cmd = "title $title; Set-Location '$workingDir'; $command"
    Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", $cmd -WindowStyle Normal | Out-Null
    Write-Host "  janela '$title' aberta" -ForegroundColor Green
}

# --- Modo STOP ---

if ($Stop) {
    Write-Title "Parando servicos mvpFacial"
    Stop-ByPort 8001 "vision-service"
    Stop-ByPort 5251 "backend"
    Stop-ByPort 3000 "frontend"
    Write-Host ""
    Write-Host "Concluido. Todos os servicos foram parados." -ForegroundColor Green
    exit 0
}

# --- Modo START ---

Write-Title "mvpFacial - Iniciando 3 servicos"

# Verifica portas ocupadas
foreach ($p in @(8001, 5251, 3000)) {
    if (Test-Port $p) {
        Write-Host ""
        Write-Host "Porta $p ocupada. Use:" -ForegroundColor Red
        Write-Host "  .\start-all.ps1 -Stop" -ForegroundColor Yellow
        Write-Host "para parar tudo antes de iniciar." -ForegroundColor Yellow
        exit 1
    }
}

# --- 1. Vision-service ---
Write-Title "1/3  Vision-service (Python/FastAPI) -> :8001"
$visionDir = Join-Path $ProjectRoot "vision-service"
$pythonExe = Join-Path $visionDir ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    Write-Host "  .venv nao encontrado em $visionDir" -ForegroundColor Red
    Write-Host "  Crie com:" -ForegroundColor Yellow
    Write-Host "    cd vision-service" -ForegroundColor Yellow
    Write-Host "    py -m venv .venv" -ForegroundColor Yellow
    Write-Host "    .\.venv\Scripts\Activate.ps1" -ForegroundColor Yellow
    Write-Host "    pip install -r requirements.txt" -ForegroundColor Yellow
    exit 1
}
$visionCmd = "& '$pythonExe' -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload"
Start-NewWindow "mvpFacial - vision-service" $visionCmd $visionDir

# --- 2. Backend ---
Write-Title "2/3  Backend (.NET 9) -> :5251"
$backendDir = Join-Path $ProjectRoot "backend"
if ($Build) {
    Write-Host "  -Build detectado: executando dotnet build..." -ForegroundColor DarkGray
    Push-Location $backendDir
    & dotnet build --nologo 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Build falhou." -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
}
$backendCmd = "`$env:ASPNETCORE_URLS='http://localhost:5251'; `$env:ASPNETCORE_ENVIRONMENT='Development'; dotnet run --no-build --no-launch-profile"
Start-NewWindow "mvpFacial - backend" $backendCmd $backendDir

# --- 3. Frontend ---
Write-Title "3/3  Frontend (Next.js) -> :3000"
$frontendDir = Join-Path $ProjectRoot "frontend"
$frontendCmd = "npm run dev"
Start-NewWindow "mvpFacial - frontend" $frontendCmd $frontendDir

# --- Resumo final ---
Write-Title "Tudo iniciado"
Write-Host ""
Write-Host "  Servico          URL                           Janela" -ForegroundColor Cyan
Write-Host "  ---------------  ----------------------------  ----------------------------"
Write-Host "  vision-service   http://localhost:8001/docs    mvpFacial - vision-service"
Write-Host "  backend          http://localhost:5251/health  mvpFacial - backend"
Write-Host "  frontend         http://localhost:3000         mvpFacial - frontend"
Write-Host ""
Write-Host "Aguarde ~5-10s para os servicos subirem." -ForegroundColor DarkGray
Write-Host "Para parar tudo: .\start-all.ps1 -Stop" -ForegroundColor Yellow
Write-Host ""
