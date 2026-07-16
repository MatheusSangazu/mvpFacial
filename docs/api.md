# Contrato de API

Endpoints dos dois serviços HTTP. Tudo em JSON. Imagens enviadas como `multipart/form-data` (binário) ou base64 conforme indicado.

> Esta é a proposta de contrato inicial — ajustar conforme a implementação. Para o schema do banco, veja [banco-dados.md](./banco-dados.md).

## Convenções

- Datas em ISO-8601 (UTC).
- Sucesso: HTTP 2xx com corpo JSON.
- Erro: HTTP 4xx/5xx com `{ "error": { "code": "...", "message": "..." } }`.
- Autenticação: `Authorization: Bearer <JWT>` nos endpoints protegidos.

---

## Backend (C# .NET) — `http://localhost:5000`

### Health
`GET /health` → `200 { "status": "ok" }`

### Cadastro

#### Extrair dados de documentos
`POST /api/documentos/extrair`
- Body: `multipart/form-data` com 1+ imagens (RG, CNH, comprovante)
- Resposta `200`:
```json
{
  "nome": "...",
  "cpf": "...",
  "dataNascimento": "...",
  "nomeMae": "...",
  "tipoDocumento": "RG",
  "camposExtras": { "endereco": "..." },
  "confianca": 0.92
}
```
- O backend valida CPF/datas antes de aceitar (ADR-006). Erros de validação → `422`.

#### Criar usuário (pré-matrícula)
`POST /api/usuarios`
- Body: dados extraídos + consentimento
```json
{ "nome": "...", "cpf": "...", "consentimento": { "aceito": true, "versaoTermo": "1.0" } }
```
- Resposta `201 { "id": 123 }`

#### Cadastrar biometria (embeddings do cadastro)
`POST /api/usuarios/{id}/biometria`
- Body: `multipart/form-data` com 3 imagens (frente/lados)
- Fluxo: backend repassa ao vision-service, recebe 3 embeddings e **persiste separados** (ADR-004)
- Resposta `201 { "quantidadeVetores": 3 }`

### Login facial

`POST /api/login/facial`
- Body:
```json
{ "motor": 1 | 2 | 3, "dispositivo": "cpu" | "cuda", "midia": "<base64 ou multipart>" }
```
- Resposta `200`:
```json
{
  "autenticado": true,
  "usuarioId": 123,
  "metricas": {
    "motor": 2,
    "latenciaMs": 412,
    "score": 0.87,
    "limiar": 0.60,
    "device": "cuda",
    "livenessOk": true
  },
  "token": "<JWT>"
}
```
- Falha de autenticação → `200 { "autenticado": false, "metricas": {...} }` (falha de biometria não é erro HTTP; métricas são registradas).

### Excluir dados do titular (LGPD)
`DELETE /api/usuarios/{id}` → remove usuário, embeddings e logs associados.

---

## Vision Service (Python / FastAPI) — `http://localhost:8000`

> Interno. Protegido por header `X-Internal-Token`. Não exposto à internet.

### Health
`GET /health` → `200 { "status": "ok", "device": "cuda" }`

### Gerar embeddings
`POST /embeddings`
- Header: `X-Internal-Token`
- Body: `multipart/form-data` com 1+ imagens
- Resposta:
```json
{ "embeddings": [ [0.012, -0.03, ...], [ ... ], [ ... ] ], "modelo": "Facenet" }
```

### Comparar (login Motor 2)
`POST /verificar`
- Body:
```json
{
  "imagemAtual": "<base64>",
  "vetoresCadastrados": [ [ ... ], [ ... ], [ ... ] ],
  "limiar": 0.60
}
```
- Resposta:
```json
{ "autenticado": true, "score": 0.87, "livenessOk": true, "device": "cuda", "latenciaMs": 380 }
```

### Executar desafio de liveness
`POST /liveness`
- Body: `multipart/form-data` com quadros/clip do desafio (ex.: "vire o rosto")
- Resposta: `{ "livenessOk": true, "movimentoDetectado": true }`

---

## Códigos de erro

| Código | Significado |
|---|---|
| `VALIDATION_ERROR` | Campo inválido (CPF, datas, etc.) |
| `EXTRACTION_FAILED` | Gemini não conseguiu estruturar o documento |
| `VISION_UNAVAILABLE` | Vision-service fora do ar |
| `RATE_LIMITED` | Limite de chamadas excedido |
| `NO_BIOMETRIA` | Usuário sem embeddings cadastrados |
| `AZURE_MOCK` | Motor 3 rodando em modo simulado |
