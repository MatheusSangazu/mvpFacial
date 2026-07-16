# Setup do ambiente

Como preparar e rodar cada serviço localmente. Tudo aqui assume Windows, Linux ou macOS com as versões indicadas.

> Princípio: cada serviço é **independente** e roda em seu próprio processo. Para facilidade, considere um `docker-compose` (tarefa futura).

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

# Azure (Motor 3) — enquanto não aprovado, usar mock
AZURE_FACE_ENDPOINT=https://...
AZURE_FACE_KEY=...
AZURE_USE_MOCK=true

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
dotnet tool install --global dotnet-ef   # se for usar migrations
dotnet ef database update                # cria/aplica schema
dotnet run
# escuta em http://localhost:5000
```

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
