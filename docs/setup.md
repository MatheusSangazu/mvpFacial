# Setup do ambiente

Como preparar e rodar cada serviço localmente. Tudo aqui assume Windows, Linux ou macOS com as versões indicadas.

> Princípio: cada serviço é **independente** e roda em seu próprio processo. Para facilidade, considere um `docker-compose` (tarefa futura).

## Início rápido

Depois que os [pré-requisitos globais](#pré-requisitos-globais) e os `.env` de cada serviço estiverem configurados **uma única vez**, você pode iniciar os 3 serviços com um comando só.

### Git Bash (Windows) / Linux / macOS

```bash
./start-all.sh
```

### PowerShell (Windows)

```powershell
.\start-all.ps1
```

Isso abre 3 janelas separadas (uma por serviço) com tudo rodando:

| Serviço         | URL                           |
|-----------------|-------------------------------|
| vision-service  | http://localhost:8001/docs    |
| backend         | http://localhost:5251/health  |
| frontend        | http://localhost:3000         |

### Opções úteis

```bash
# Git Bash / Linux / macOS
./start-all.sh --stop       # para todos os 3 serviços pelas portas
./start-all.sh --build      # faz dotnet build antes de iniciar o backend
./start-all.sh --help

# PowerShell
.\start-all.ps1 -Stop
.\start-all.ps1 -Build
.\start-all.cmd             # wrapper CMD (duplo-clique funciona)
```

### Pré-requisitos do script

- Backend já buildado (`cd backend && dotnet build`) OU usar `--build`/`-Build`
- Vision-service com venv em `vision-service/.venv/`
- Frontend com `node_modules` instalado (`cd frontend && npm install`)

O script verifica automaticamente portas livres e aborta se alguma já estiver ocupada (use `--stop` para liberar).

## Pré-requisitos globais

| Ferramenta | Versão mínima | Observação |
|---|---|---|
| Node.js | 20 LTS | Para o Next.js |
| .NET SDK | 8.0 | Backend C# |
| Python | 3.11 | Vision-service |
| Git | recente | |
| Acesso à VPS/banco | — | String de conexão fornecida pelo time |
| Chave Google Gemini | — | `GEMINI_API_KEY` |
| (Opcional) NVIDIA GPU + CUDA | 12.x | Para Motor 2 em GPU; sem GPU, roda em CPU (mais lento) |

## Variáveis de ambiente

Cada serviço tem seu `.env` (não versionar). Exemplos abaixo.

### `frontend/.env.local`
```bash
NEXT_PUBLIC_API_URL=http://localhost:5000   # URL do backend C#
```

### `backend/.env`
```bash
# Banco
ConnectionStrings__Default="Host=...;Database=...;Username=...;Password=..."

# Gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash

# Vision service
VISION_SERVICE_URL=http://localhost:8000
VISION_SERVICE_TOKEN=...

# Segurança
JWT_SECRET=...
CORS_ORIGINS=http://localhost:3000
```

### `vision-service/.env`
```bash
INTERNAL_TOKEN=...           # mesmo valor de VISION_SERVICE_TOKEN do backend
DEVICE=cpu                   # cpu | cuda
# DeepFace baixa modelos no primeiro uso; defina a pasta de cache
DEEPFACE_HOME=/app/.deepface
```

## Subindo o Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
# abre em http://localhost:3000
```

Permissões necessárias no navegador: **câmera** (e microfone se capturar vídeo). Use `https://` ou `localhost` (navegadores bloqueiam câmera em http não-localhost).

## Subindo o Backend (C# .NET)

```bash
cd backend
dotnet restore

# 1. Criar o banco no MySQL (uma vez só):
#    mysql -u root -p < backend/Data/schema.sql
#    Ou abra o MySQL Workbench e execute o conteudo de backend/Data/schema.sql

# 2. (Opcional) Gerar/atualizar migrations via EF Core:
dotnet tool install --global dotnet-ef   # se nao tiver instalado
dotnet ef migrations add Inicial
dotnet ef database update

# 3. Rodar o backend
dotnet run
# escuta em http://localhost:5000
```

> **String de conexão MySQL** (em `appsettings.Development.json` ou variável):
> `Server=localhost;Port=3306;Database=mvp_facial;User=root;Password=sua-senha;`

## Subindo o Vision Service (Python)

```bash
cd vision-service
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# escuta em http://localhost:8000
```

> No **primeiro run**, o DeepFace baixa pesos dos modelos (centenas de MB). Pode demorar.

## Toggle CPU vs GPU (Motor 2)

- Sem GPU: `DEVICE=cpu` — funciona, mas mais lento (documentar na demo).
- Com NVIDIA: instalar PyTorch compatível com CUDA e `DEVICE=cuda`. Validar com `python -c "import torch; print(torch.cuda.is_available())"`.

## Ordem recomendada de inicialização

1. Banco de dados (VPS já no ar, ou container local)
2. Vision Service (Python)
3. Backend (C#) — depende do banco e do vision-service
4. Frontend (Next.js) — depende do backend

## Verificação rápida (healthchecks)

Após subir tudo, validar:
- `GET http://localhost:8000/health` → `{"status":"ok"}`
- `GET http://localhost:5000/health` → `{"status":"ok"}`
- `http://localhost:3000` carrega a home

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Câmera não abre no browser | Acessar via http não-localhost; use `localhost` ou https |
| Vision service erro de modelo não encontrado | `DEEPFACE_HOME` sem permissão de escrita |
| Backend 500 ao chamar Gemini | `GEMINI_API_KEY` inválida ou cota esgotada |
| Login facial Motor 2 muito lento | Rodando em CPU; ativar GPU ou reduzir resolução da imagem |
| CORS no frontend | `CORS_ORIGINS` do backend não inclui a origem do Next.js |
