- Decisão de cifrar a foto precisar ser auditada por DPO (LGPD): eventuais ajustes no termo de consentimento.

---

## ADR-019 — Multi-Key Fallback Pool para Gemini

**Status:** Aceita (2026-07-19).

### Contexto
A conta gratuita do Gemini tem limites baixos de RPM/RPD (ex.: 5 RPM e 20 RPD para Flash). Em pico de uso ou em testes repetidos, a API retorna `429 TooManyRequests`, derrubando o fluxo de extração de documentos e liveness. Adquirimos uma segunda chave de API (conta Google distinta) para atuar como fallback.

### Decisão
Implementar um **pool de chaves** no backend (`GeminiKeysProvider`) com rotação automática:

1. Provider recebe N chaves no construtor (via config/env, separadas por `;`).
2. `ChaveAtual()` devolve a primeira chave cujo cooldown expirou (round-robin simples).
3. Quando uma chave falha com `429` (rate limit): cooldown de **60 segundos**.
4. Quando uma chave falha com `403/404` (sem acesso ao modelo, key banida): cooldown de **24 horas** (86400s).
5. Quando todas estão em cooldown: log de warning e aborta a operação com erro transiente para o cliente.

### Por que não retry simples
- Retry simples (mesma chave) consome a mesma quota e piora o problema.
- Multi-key distribui o load entre contas, alargando o teto efetivo para `N × RPM`.
- Cooldown inteligente evita "martelar" uma chave temporariamente suspensa.

### Consequências
- **+** Resiliência a picos de uso sem intervenção manual.
- **+** Custo zero (tier gratuito em múltiplas contas).
- **−** Cada chave precisa estar configurada em todas as instâncias do backend (env vars).
- **−** Se todas as contas forem do mesmo projeto Google, o rate limit pode ser agregado (mitigação: usar contas Google distintas).

### Implementação
- `backend/Services/GeminiKeysProvider.cs`: gerenciador do pool com cooldowns.
- `backend/Services/GeminiService.cs`: refatorado para receber `GeminiKeysProvider` (DI) e reportar falhas.
- `backend/Services/Motor1GeminiService.cs`: mesmo pool para liveness/comparação facial.
- `backend/appsettings.json`: `Gemini:ApiKeys` (string com chaves separadas por `;`).

### Revisão futura
Reabrir o debate se:
- Google unificar rate limit por organização (contornar com contas pessoais distintas).
- Migramos para uma conta paga (single-key passa a ser suficiente).
- Aparecerem modelos on-prem equivalentes que dispensam Gemini.

---

## ADR-020 — Extração Multi-Imagem via Map-Reduce

**Status:** Aceita (2026-07-19).

### Contexto
O cliente envia 2+ imagens de um documento (ex.: RG frente + verso) para `/api/documentos/extrair-identidade`. A primeira tentativa enviava todas as imagens em um único `inline_data` array para o Gemini. O Gemini 3 Flash exibia **comportamento de viés de atenção** (recency bias): processava apenas a primeira imagem e ignorava as demais, devolvendo JSON incompleto (sem CPF, rgNumero, nomeMae — que estão no verso do RG).

Engenharia de prompt direta não resolveu:
- Reforço no início do prompt: ignorado.
- Intercalação texto/imagem com marcadores `--- INICIO DA IMAGEM N ---`: ignorado.
- Reforço no final (após as imagens): ignorado.
- System instruction + temperature=0: parcial.

### Decisão
Implementar **extração Map-Reduce** no `GeminiService`:

1. **Map**: para cada imagem enviada, fazer uma chamada isolada ao Gemini com apenas aquela imagem + o prompt base. Cada chamada tem contexto mínimo (1 imagem), eliminando o viés de atenção.
2. **Reduce**: após todas as extrações individuais, fazer uma chamada **textual** (sem imagens) passando o array de JSONs extraídos e pedindo para o Gemini consolidá-los em um único objeto final, aplicando regras explícitas (nulo vira valor quando houver, prefira nome completo sobre abreviado, etc.).
3. **Caso de 1 imagem**: pula o Map-Reduce e faz extração direta (sem overhead de chamada extra).

### Alternativas consideradas
- **Trocar para modelo Pro** (`gemini-3-pro`): janela de atenção maior, lida melhor com múltiplas imagens. Descartado por ser ~5x mais caro e mais lento (não caberia no orçamento do MVP).
- **Comprimir/redimensionar imagens**: ajuda em tokens, mas não resolve o viés de atenção do modelo. Mantida como otimização futura.
- **Usar Google DocumentAI**: serviço especializado em parsing de documentos. Descartado por exigir billing configurado e ter latência maior.
- **Chamadas sequenciais (sem Reduce)**: o frontend teria que consolidar os JSONs manualmente. Descartado para manter a lógica no backend e simplificar o cliente.

### Consequências
- **+** Taxa de sucesso de extração de RG frente/verso sobe para ~100% (cada imagem é processada isoladamente).
- **+** Frontend não muda (mesma interface `/extrair-identidade` e `/extrair-comprovante`).
- **+** Validação ADR-006 (Camada 1) continua funcionando, agora sobre o JSON consolidado.
- **−** Latência multiplicada por `N+1` (2 imagens = 3 chamadas ao Gemini; 3 imagens = 4 chamadas). Para RG frente/verso típico: ~3×13s = ~40s no tier gratuito.
- **−** Consome `N+1` quotas de RPM/RPD (mitigado pelo ADR-019 Multi-Key).
- **−** Edge case: se o Gemini inventar dados conflitantes entre as duas extrações, a fase Reduce precisa resolver — pode haver perda de informação menor.

### Implementação
- `backend/Services/GeminiService.cs`:
  - `ExtrairAsync`: ramifica em `Map` (loop por imagem) + `Reduce` (chamada textual consolidadora).
  - `ExecutarComRetryAsync`: extraído o bloco de retry para reuso em todas as N+1 chamadas.
  - `ChamarGemini`: aceita lista vazia de imagens (modo texto puro para a fase Reduce).
- `backend/Controllers/DocumentosController.cs`: sem mudança — já repassava a lista completa.

### Revisão futura
Reabrir o debate se:
- Latência agregada virar problema real (considerar paralelismo no Map com `Task.WhenAll`).
- Surgir modelo de visão com janela de atenção suficiente para consolidar de primeira (reverter para single-call).
- Migramos para DocumentAI do Google ou similar (eliminar o Gemini da extração).

---

## ADR-021 — Deploy em Containers no Coolify via docker-compose

**Status:** Proposta (2026-07-20).

### Contexto
A apresentação do MVP para executivos exige um ambiente público (HTTPS, domínio) na VPS onde o Coolify já está instalado. O time já mantém um MySQL externo em outro projeto Coolify (reaproveitável). Subir manualmente cada serviço (frontend, backend, vision-service) via SSH a cada demo é frágil e lento. Precisamos de um processo reprodutível e versionado.

### Decisão
Empacotar os 3 serviços em **Docker** e orquestrá-los com um único **`docker-compose.yml`** deployado no Coolify:

1. **Dockerfile por serviço** (`frontend/`, `backend/`, `vision-service/`), builds multi-estágio.
2. **`docker-compose.yml`** na raiz com 3 serviços + rede interna `mvpnet`.
3. **MySQL externo**: NÃO incluído no compose. A connection string é injetada via `${DATABASE_URL}` (Coolify env vars).
4. **Variáveis sensíveis** injetadas pelo painel do Coolify, jamais commitadas (`.env.example` documenta o template).
5. **`vision-service`** sem exposição pública — só o backend o acessa via DNS interno (`http://vision-service:8001`).
6. **Frontend** com `output: "standalone"` no Next.js para imagem final ~150MB.
7. **Backend** roda em modo `Production` (`ASPNETCORE_ENVIRONMENT=Production`); `appsettings.Development.json` é ignorado pelo Docker (`.dockerignore`).

### Alternativas consideradas
- **3 resources separados no Coolify** (um compose por serviço): descartado pelaComplexidade de operação (3 deploys, 3 redes para plugar) sem benefício claro para MVP.
- **Incluir MySQL no compose**: descartado porque o MySQL já existe em outro projeto Coolify; duplicar implicaria migrar dados e manter 2 instâncias.
- **Deploy direto via `dotnet run` / `npm start` na VPS (sem Docker)**: descartado — exige configurar runtime, Node, Python, libs de sistema manualmente na VPS e quebra a reprodutibilidade.
- **Kubernetes**: descartado por overhead operacional absurdo para um MVP de 3 containers.

### Consequências
- **+** Deploy reprodutível versionado no git: qualquer dev sobe o mesmo ambiente com `docker compose up`.
- **+** Isolamento total: cada serviço em seu container, dependências de sistema não conflitam.
- **+** Coolify cuida de TLS (Let's Encrypt), proxy reverso, restart automático, logs centralizados.
- **−** Imagem do vision-service é grande (~2GB por TensorFlow + DeepFace + Facenet). Primeiro build lento (~10min), pull em novo node demora.
- **−** Latência de rede entre containers (vs. localhost): irrelevante para MVP, mas medir em `Biometria_Logs`.
- **−** Injeção de env vars exige configuração manual no painel Coolify em cada novo ambiente.

### Implementação
- `docker-compose.yml` (raiz) com `services.{frontend,backend,vision-service}` + `networks.mvpnet`.
- `frontend/Dockerfile` (Node 20-alpine, multi-estagio standalone).
- `backend/Dockerfile` (SDK 9.0 build, aspnet:9.0 runtime, uid 1654).
- `vision-service/Dockerfile` (python:3.11-slim + libgl1 + ffmpeg + DeepFace).
- `.dockerignore` por serviço (exclui `bin/`, `obj/`, `node_modules/`, `.next/`, `.env*`, `appsettings.Development.json`).
- `.env.example` (raiz) documentando todas as variáveis esperadas pelo compose.
- `frontend/next.config.ts` atualizado com `output: "standalone"`.

### Revisão futura
Reabrir o debate se:
- Latência entre containers virar gargalo (considerar shared volume socket ou processo único).
- Quiser escalar horizontalmente (separar em recursos Coolify independentes com rede compartilhada).
- Migrar para GPU (adicionar `deploy.resources.reservations.devices` para CUDA no `vision-service`).
