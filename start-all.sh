#!/usr/bin/env bash
# start-all.sh - Inicia os 3 servicos do mvpFacial em abas/janelas separadas.
# Git Bash (Windows), WSL, Linux e macOS.
#
# Uso:
#   ./start-all.sh            # inicia tudo
#   ./start-all.sh --stop     # para tudo
#   ./start-all.sh --build    # faz dotnet build antes de iniciar o backend
#   ./start-all.sh --help
#
# Servicos:
#   1. vision-service  (Python/FastAPI) -> http://localhost:8001
#   2. backend         (.NET 9)         -> http://localhost:5251
#   3. frontend        (Next.js)        -> http://localhost:3001
# ====================================================================

set -euo pipefail

# Resolve diretorio do projeto (independente de onde foi chamado)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

# Cores (ANSI)
C_RESET="\033[0m"
C_CYAN="\033[36m"
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_RED="\033[31m"
C_GRAY="\033[90m"

print_title() {
    echo ""
    echo -e "${C_GRAY}============================================================${C_RESET}"
    echo -e "${C_CYAN}  $1${C_RESET}"
    echo -e "${C_GRAY}============================================================${C_RESET}"
}

print_ok()   { echo -e "  ${C_GREEN}[OK]${C_RESET} $1"; }
print_warn() { echo -e "  ${C_YELLOW}[!]${C_RESET} $1"; }
print_err()  { echo -e "  ${C_RED}[X]${C_RESET} $1"; }

# --- Parse de argumentos ---
ACTION="start"
DO_BUILD=false
for arg in "$@"; do
    case "$arg" in
        --stop|-s)        ACTION="stop" ;;
        --build|-b)       DO_BUILD=true ;;
        --help|-h)
            cat <<EOF
Uso: ./start-all.sh [opcoes]

Opcoes:
  (sem arg)        Inicia os 3 servicos em janelas/abas separadas
  --stop, -s       Para todos os servicos pelas portas
  --build, -b      Faz dotnet build antes de iniciar o backend
  --help, -h       Mostra esta ajuda
EOF
            exit 0
            ;;
        *)
            print_err "Argumento desconhecido: $arg"
            echo "Use --help para ver as opcoes."
            exit 1
            ;;
    esac
done

# --- Helpers de portas ---
# Git Bash nao tem 'lsof' mas tem 'netstat' via Windows.
# Tenta varios metodos em ordem.
port_in_use() {
    local port="$1"
    # Metodo 1: netstat (Windows / Git Bash)
    if command -v netstat &>/dev/null; then
        # Importante: redirecionar stderr e checar saida do grep SEM abortar com set -e
        if netstat -ano 2>/dev/null | grep "LISTENING" | grep -E ":${port}\b" > /dev/null 2>&1; then
            return 0
        fi
    fi
    # Metodo 2: lsof (Linux/macOS/WSL)
    if command -v lsof &>/dev/null; then
        if lsof -i ":${port}" -sTCP:LISTEN > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

kill_by_port() {
    local port="$1"
    local name="$2"
    local killed_any=false
    # Windows via taskkill
    if command -v netstat &>/dev/null && command -v taskkill &>/dev/null; then
        local pids
        # -E para garantir boundary (nao pegar :80010 quando busca :8001)
        pids=$(netstat -ano 2>/dev/null | grep "LISTENING" | grep -E ":${port}\b" | awk '{print $NF}' | sort -u || true)
        if [[ -n "$pids" ]]; then
            for pid in $pids; do
                # taskkill no Git Bash precisa de //
                if taskkill //F //PID "$pid" > /dev/null 2>&1; then
                    print_warn "$name parado (PID $pid) porta $port"
                    killed_any=true
                fi
            done
            if [[ "$killed_any" != "true" ]]; then
                print_err "$name: falha ao parar PIDs ($pids) porta $port"
            fi
            return
        fi
    fi
    # Linux/macOS via kill
    if command -v lsof &>/dev/null; then
        local pids
        pids=$(lsof -t -i ":${port}" -sTCP:LISTEN 2>/dev/null || true)
        if [[ -n "$pids" ]]; then
            for pid in $pids; do
                if kill -9 "$pid" > /dev/null 2>&1; then
                    print_warn "$name parado (PID $pid) porta $port"
                    killed_any=true
                fi
            done
            if [[ "$killed_any" != "true" ]]; then
                print_err "$name: falha ao parar PIDs ($pids) porta $port"
            fi
            return
        fi
    fi
    print_warn "$name nao estava rodando (porta $port livre)"
}

# --- Detecta como abrir nova janela ---
# Git Bash no Windows: usa 'start' para abrir novo cmd/powershell
# Linux com X11: gnome-terminal ou xterm
# macOS: open -a Terminal
detect_open_terminal_cmd() {
    # Git Bash no Windows tem 'start' disponivel
    if command -v start &>/dev/null 2>&1 || [[ "$(uname -s)" == MINGW* ]] || [[ "$(uname -s)" == MSYS* ]]; then
        OPEN_TERMINAL="gitbash"
        return
    fi
    if command -v gnome-terminal &>/dev/null; then
        OPEN_TERMINAL="gnome-terminal"
        return
    fi
    if command -v xterm &>/dev/null; then
        OPEN_TERMINAL="xterm"
        return
    fi
    if [[ "$(uname -s)" == "Darwin" ]]; then
        OPEN_TERMINAL="macos"
        return
    fi
    OPEN_TERMINAL="background"  # fallback: roda em background no mesmo terminal
}

open_new_window() {
    local title="$1"
    local workdir="$2"
    local exec_cmd="$3"

    case "$OPEN_TERMINAL" in
        gitbash)
            # No Git Bash, 'start' abre nova janela. Mintty e o terminal padrao.
            # Passamos o titulo como titulo da janela e mudamos diretorio antes de executar.
            local full_cmd="cd '$workdir' && echo '=== $title ===' && $exec_cmd; exec bash"
            # O 'start' do cmd aceita 'mintty' como programa e -t para titulo
            if command -v mintty &>/dev/null; then
                mintty -t "$title" -h always bash -lc "$full_cmd" &
            else
                # fallback: cmd start + bash
                cmd //c start "$title" bash -lc "$full_cmd" &
            fi
            ;;
        gnome-terminal)
            gnome-terminal --title="$title" -- bash -lc "cd '$workdir' && $exec_cmd; exec bash" &
            ;;
        xterm)
            xterm -title "$title" -e bash -lc "cd '$workdir' && $exec_cmd" &
            ;;
        macos)
            osascript -e "tell app \"Terminal\" to do script \"cd $workdir && $exec_cmd\"" &
            ;;
        background)
            # Sem GUI para abrir janela - roda em background
            print_warn "Sem terminal grafico detectado. Rodando '$title' em background..."
            (cd "$workdir" && eval "$exec_cmd" > "/tmp/mvpfacial-${title}.log" 2>&1) &
            echo "  logs em /tmp/mvpfacial-${title}.log"
            ;;
    esac
}

detect_open_terminal_cmd

# --- MODO STOP ---
if [[ "$ACTION" == "stop" ]]; then
    print_title "Parando servicos mvpFacial"
    kill_by_port 8001 "vision-service"
    kill_by_port 5251 "backend"
    kill_by_port 3001 "frontend"
    echo ""
    echo -e "${C_GREEN}Concluido. Todos os servicos foram parados.${C_RESET}"
    exit 0
fi

# --- MODO START ---
print_title "mvpFacial - Iniciando 3 servicos"

# Verifica portas ocupadas
PORTAS_OCUPADAS=()
for p in 8001 5251 3001; do
    if port_in_use "$p"; then
        PORTAS_OCUPADAS+=("$p")
    fi
done
if [[ ${#PORTAS_OCUPADAS[@]} -gt 0 ]]; then
    echo ""
    print_err "Porta(s) ocupada(s): ${PORTAS_OCUPADAS[*]}"
    echo ""
    echo "Use:"
    echo -e "  ${C_YELLOW}./start-all.sh --stop${C_RESET}"
    echo "para parar tudo antes de iniciar."
    exit 1
fi

# --- 1. Vision-service ---
print_title "1/3  Vision-service (Python/FastAPI) -> :8001"
VISION_DIR="$SCRIPT_DIR/vision-service"
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
    # Git Bash: .venv/Scripts/python.exe
    PYTHON_EXE="$VISION_DIR/.venv/Scripts/python.exe"
else
    # Linux/macOS/WSL: .venv/bin/python
    PYTHON_EXE="$VISION_DIR/.venv/bin/python"
fi
if [[ ! -f "$PYTHON_EXE" ]]; then
    print_err ".venv nao encontrado em:"
    echo "    $PYTHON_EXE"
    echo ""
    echo "Crie com:"
    echo "    cd vision-service"
    echo "    python -m venv .venv"
    if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
        echo "    .venv/Scripts/activate"
    else
        echo "    source .venv/bin/activate"
    fi
    echo "    pip install -r requirements.txt"
    exit 1
fi
VISION_CMD="'$PYTHON_EXE' -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload"
open_new_window "mvpFacial - vision-service" "$VISION_DIR" "$VISION_CMD"
print_ok "vision-service iniciando"

# --- 2. Backend ---
print_title "2/3  Backend (.NET 9) -> :5251"
BACKEND_DIR="$SCRIPT_DIR/backend"
if $DO_BUILD; then
    echo -e "  ${C_GRAY}--build detectado: executando dotnet build...${C_RESET}"
    (cd "$BACKEND_DIR" && dotnet build --nologo 2>&1 | tail -3) || {
        print_err "Build falhou."
        exit 1
    }
fi
BACKEND_CMD="ASPNETCORE_URLS=http://localhost:5251 ASPNETCORE_ENVIRONMENT=Development dotnet run --no-build --no-launch-profile"
open_new_window "mvpFacial - backend" "$BACKEND_DIR" "$BACKEND_CMD"
print_ok "backend iniciando"

# --- 3. Frontend ---
print_title "3/3  Frontend (Next.js) -> :3001"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
FRONTEND_CMD="npm run dev"
open_new_window "mvpFacial - frontend" "$FRONTEND_DIR" "$FRONTEND_CMD"
print_ok "frontend iniciando"

# --- Resumo final ---
print_title "Tudo iniciado"
echo ""
echo -e "  ${C_CYAN}Servico          URL                           Janela${C_RESET}"
echo "  ---------------  ----------------------------  ----------------------------"
echo "  vision-service   http://localhost:8001/docs    mvpFacial - vision-service"
echo "  backend          http://localhost:5251/health  mvpFacial - backend"
echo "  frontend         http://localhost:3001         mvpFacial - frontend"
echo ""
echo -e "  ${C_GRAY}Aguarde ~5-10s para os servicos subirem.${C_RESET}"
echo -e "  ${C_YELLOW}Para parar tudo: ./start-all.sh --stop${C_RESET}"
echo ""
