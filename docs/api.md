# Contrato de API

Endpoints dos dois serviços HTTP. Tudo em JSON. Imagens enviadas como `multipart/form-data` (binário) ou base64 conforme indicado.

> Endpoints alinhados com a implementação vigente em [backend/Controllers](../backend/Controllers) e [vision-service/main.py](../vision-service/main.py). Para o schema do banco, veja [banco-dados.md](./banco-dados.md).

## Convenções

- Datas em ISO-8601 (UTC). Horário de Brasília na UI.
- Sucesso: HTTP 2xx com corpo JSON.
- Erro: HTTP 4xx/5xx com `{ "erro": "CODIGO", "mensagem": "..." }`.
- Autenticação: `Authorization: Bearer <JWT>` nos endpoints protegidos.
- Validação: CPF com dígitos verificadores (ADR-006). `limiar` em decimal entre 0 e 1 (use `0.60`, nunca `,60` ou `60`).

---

## Backend (C# .NET) — `http://localhost:5251`

### Health

`GET /health` → `200 { "status": "ok" }`

### Autenticação e cadastro de usuário

#### Criar usuário (dados cadastrais, sem biometria ainda)
`POST /api/auth/cadastro`
- Body:
```json
{
  "nome": "...",
  "cpf": "000.000.000-00",
  "dataNascimento": "1990-01-01",
  "nomeMae": "...",
  "consentimentoAceito": true,
  "documentos": [
    {
      "tipoDocumento": "RG",
      "nomeArquivo": "rg-front.jpg",
      "dadosExtraidosJson": "{ \"nome\":\"...\",\"cpf\":\"...\" }",
      "confianca": 0.92
    }
  ]
}
```
  - `documentos` é **opcional** (lista). Quando presente, cada item precisa ter ao menos `dadosExtraidosJson`. `confianca` e `nomeArquivo` são opcionais. Os dados já devem ter passado pela [validação ADR-006](./decisoes.md#adr-006) no endpoint de extração. Nenhum arquivo binário é persistido — somente o JSON estruturado ([ADR-009](./decisoes.md#adr-009)).
- Resposta `201`:
```json
{
  "usuario": { "id": 123, "nome": "...", "cpf": "00000000000", "termoVersao": "1.0" },
  "documentosPersistidos": 1,
  "token": "<JWT>",
  "expiraEmHoras": 8
}
```
- Erros: `400 CPF_INVALIDO | 400 NOME_OBRIGATORIO | 400 CONSENTIMENTO_OBRIGATORIO | 400 TERMO_INDISPONIVEL | 409 CPF_JA_CADASTRADO`

#### Perfil do usuário autenticado
`GET /api/auth/me` *(JWT)*
- Resposta `200`: dados do usuário + flag `temVetoresFaciais` (indicando se já cadastrou biometria) + lista `documentos` (id, tipoDocumento, nomeArquivo, confiancaExtracao, criadoEm) cadastrados na criação da conta.

#### Excluir conta (LGPD — direito ao esquecimento)
`DELETE /api/auth/usuario` *(JWT)*
- Remove o usuário, seus vetores faciais **e seus documentos cadastrados**. Logs em `Biometria_Logs` são **anonimizados** (`usuarioId = null`) mantidos para auditoria (LGPD Art. 18, VI).
- Resposta `200`:
```json
{
  "status": "excluido",
  "usuarioId": 123,
  "vetoresRemovidos": 2,
  "documentosRemovidos": 1,
  "logsAnonimizados": 14,
  "mensagem": "Conta excluida conforme LGPD (Art. 18, VI). Dados agregados anonimizados mantidos para auditoria."
}
```
- Erro: `404 USUARIO_NAO_ENCONTRADO`.

### Documentos — extrair dados via Gemini

> Rotas **anônimas** (sem `[Authorize]`): a extração roda apenas em memória — nenhum arquivo ou resultado é persistido por estes endpoints. Para armazenar o resultado, repasse o `dadosExtraidosJson` no `POST /api/auth/cadastro`.

#### Extrair documento de identidade (RG ou CNH)
`POST /api/documentos/extrair-identidade`
- Body: `multipart/form-data` com campo `imagens` (`List<IFormFile>`, 1 a 5 arquivos, JPEG/PNG/WebP/HEIC/HEIF, máx 10 MB cada).
- **Múltiplas imagens (ADR-020 Map-Reduce):** quando o cliente envia 2+ imagens (ex.: frente e verso do RG), o backend não junta tudo numa única chamada do Gemini — em vez disso, aplica a estratégia Map-Reduce:
  1. **Map:** extrai um JSON de cada imagem isoladamente (1 chamada por imagem). Cada chamada tem contexto reduzido, evitando perda de atenção.
  2. **Reduce:** uma chamada textual final (sem imagens) consolida todos os JSONs em um único resultado.
  - Custo: ~N+1 chamadas ao Gemini. Latência proporcional. Robustez muito maior para RG frente/verso (CPF, rgNumero e filiação normalmente estão no verso).
  - Para 1 imagem, faz extração direta (sem overhead).
- Resposta `200` — `DocumentoExtraido` com campos de identidade:
```json
{
  "tipoDocumento": "RG",
  "nome": "...", "cpf": "...", "dataNascimento": "1990-01-01", "nomeMae": "...", "nomePai": null,
  "rgNumero": "...", "rgOrgaoEmissor": "SSP", "rgUf": "SP", "rgDataEmissao": "2020-01-01",
  "cnhNumero": null, "cnhCategoria": null, "cnhValidade": null, "cnhUf": null,
  "camposExtras": null,
  "confianca": 0.92
}
```

#### Extrair comprovante de residência
`POST /api/documentos/extrair-comprovante`
- Body: `multipart/form-data` com campo `imagens` (mesmas regras acima).
- Resposta `200` — `DocumentoExtraido` com campos de comprovante:
```json
{
  "tipoDocumento": "Comprovante",
  "titular": "...", "cpfTitular": "...",
  "tipoComprovante": "agua | luz | gas | telefone | internet | iptu | cartao | banco | outro",
  "endereco": { "logradouro": "...", "numero": "...", "bairro": "...", "cidade": "...", "uf": "...", "cep": "..." },
  "dataEmissao": "2024-05-01", "dataVencimento": "2024-05-31",
  "valor": "123,45", "emitente": "...",
  "confianca": 0.88
}
```

#### Extrair (legado, mantido por compatibilidade)
`POST /api/documentos/extrair`
- Body: `multipart/form-data` com campo `imagens`. Internamente delega ao prompt de identidade (equivalente a `/extrair-identidade`). Mantido para clientes antigos — prefira os endpoints especializados acima.

#### Validação e erros (comuns aos três endpoints)
- O Gemini é instruído a **não alucinar**; se faltar nitidez, devolve campos nulos. Após a extração, aplica-se a [validação ADR-006](./decisoes.md#adr-006) **Camada 1** (dígitos de CPF, plausibilidade de datas, consistência entre documentos) antes de devolver o resultado.
- Header de resposta `X-Extracao-Confianca` traz a confiança em `0.00`–`1.00` (ou `null`).
- Erros:
  - `400 IMAGENS_AUSENTES` — nenhuma imagem enviada.
  - `400 IMAGENS_EXCESSO` — mais de 5 imagens na requisição.
  - `400 IMAGEM_VAZIA` — arquivo com 0 bytes.
  - `400 MIME_NAO_SUPORTADO` — tipo não aceito.
  - `400 IMAGEM_MUITO_GRANDE` — excedeu 10 MB por arquivo.
  - `422 VALIDACAO_CAMADA1` — extração ok, mas validação ADR-006 falhou (resposta inclui `documento` e `falhas[]`).
  - `422 EXTRACAO_FALHOU` — Gemini devolveu payload não estruturável.
  - `503 GEMINI_NAO_CONFIGURADO` — `Gemini:ApiKey` ausente.

### Biometria — Motor 2 (DeepFace)

#### Cadastrar vetores faciais
`POST /api/biometria/cadastrar` *(JWT)*
- Body: `multipart/form-data`
  - `fotos` (1 a 3 arquivos, JPEG/PNG/WebP, máx 10 MB cada)
  - `pose` (opcional: `frente` | `esquerda` | `direita`; default `frente`)
- Fluxo: repassa ao vision-service `/embeddings`, cifra cada embedding com AES-256-GCM (ADR-009), grava em `Vetores_Faciais`, registra métrica em `Biometria_Logs` (operacao=`cadastro`).
- Resposta `201`:
```json
{
  "usuarioId": 123, "modelo": "Facenet", "device": "cpu", "latenciaMs": 144,
  "vetoresCriados": 1, "vetoresIds": [1], "pose": "frente"
}
```
- Erros: `400 FOTOS_AUSENTES | 400 FOTOS_EXCESSO (>3) | 400 MIME_NAO_SUPORTADO | 409 VETORES_JA_EXISTEM | 422 SEM_ROSTO | 502 VISION_FALHOU`

#### Verificar (login facial)
`POST /api/biometria/verificar`
- Body: `multipart/form-data`
  - `foto` (1 arquivo)
  - `cpf` (string)
  - `limiar` (opcional, string decimal entre 0 e 1; default `0.60` — ADR-004)
- Fluxo: valida CPF → localiza usuário → decifra vetores com AES-256 → repassa foto atual + vetores ao vision-service `/verificar` → aplica regra ADR-014 (`livenessOk=false` ⇒ nunca AUTENTICADO) → grava métrica → emite JWT só se autenticado.
- Resposta `200` (autenticado ou não — falha de biometria não é erro HTTP):
```json
{
  "usuarioId": 123, "nome": "...",
  "resultado": "AUTENTICADO | INCONCLUSIVO | REJEITADO",
  "autenticado": true,
  "metricas": {
    "motor": 2, "score": 0.87, "limiar": 0.6,
    "latenciaMs": 158, "device": "cpu", "livenessOk": true
  },
  "logId": 42,
  "token": "<JWT ou null>",
  "expiraEmHoras": 8,
  "laudoUrl": "/api/biometria/laudo/42"
}
```
- Erros: `400 CPF_INVALIDO | 400 FOTO_AUSENTE | 400 MIME_NAO_SUPORTADO | 400 LIMIAR_INVALIDO | 404 USUARIO_NAO_ENCONTRADO | 409 SEM_VETORES | 500 DECIFRA_FALHOU | 502 VISION_FALHOU`

#### Verificar comparativo (Motor 1 + Motor 2 em paralelo)
`POST /api/biometria/verificar-comparativo` — comparação lado a lado ([ADR-016](./decisoes.md#adr-016))
- **Auth:** Nenhuma (anônimo) — `[AllowAnonymous]`.
- **Content-Type:** `multipart/form-data`.
- Parâmetros (form):
  - `cpf` (string, obrigatório) — CPF do usuário.
  - `fotoReferencia` (`IFormFile`, obrigatório) — foto do rosto do mesmo usuário (alimento do Motor 1).
  - `fotoAtual` (`IFormFile`, obrigatório) — selfie do momento da tentativa de login.
  - `limiar` (string, opcional) — limiar numérico entre 0 e 1 (default `0.60`).
- Fluxo: roda Motor 1 (Gemini) e Motor 2 (DeepFace) **em paralelo** (`Task.WhenAll`). **Nenhuma foto é persistida** ([ADR-009](./decisoes.md#adr-009)). Apenas o log do Motor 2 é gravado em `Biometria_Logs` (consistente com [ADR-013](./decisoes.md#adr-013): Motor 1 é apenas explicador). `concordancia` indica se ambos os motores chegaram à mesma decisão (ambos aprovam ou ambos rejeitam).
- Resposta `200`:
```json
{
  "usuarioId": 11,
  "nome": "Matheus Vicente",
  "concordancia": true,
  "latenciaTotalMs": 1834,
  "motor1": {
    "motor": "1-gemini",
    "ok": true,
    "erro": null,
    "similaridadePct": 95,
    "confianca": 0.89,
    "liveness": {
      "classificacao": "live",
      "confianca": 0.92,
      "indicadores": ["textura natural da pele", "reflexos oculares consistentes"]
    },
    "icaoConformidade": {
      "conforme": true,
      "falhas": []
    },
    "justificativa": "Mesma pessoa; geometricamente compativel.",
    "latenciaMs": 1834
  },
  "motor2": {
    "motor": "2-deepface",
    "ok": true,
    "erro": null,
    "score": 0.7821,
    "limiar": 0.60,
    "autenticado": true,
    "livenessOk": true,
    "device": "cpu",
    "latenciaMs": 144,
    "logId": 42
  },
  "laudoUrl": "/api/biometria/laudo/42",
  "token": "eyJhbGc..."
}
```
- Erros:
  - `400 CPF_INVALIDO` — CPF não parseia como válido.
  - `404 USUARIO_NAO_ENCONTRADO` — CPF não cadastrado.
  - `400 FOTO_REFERENCIA_AUSENTE` — campo `fotoReferencia` vazio.
  - `400 FOTO_ATUAL_AUSENTE` — campo `fotoAtual` vazio.
  - `400 MIME_NAO_SUPORTADO` — tipo MIME não é JPEG/PNG/WebP.
  - `400 IMAGEM_MUITO_GRANDE` — alguma foto > 10 MB.
  - `400 LIMIAR_INVALIDO` — `limiar` não é número entre 0 e 1.
  - `200 GEMINI_NAO_CONFIGURADO` — Motor 1 não configurado (`motor1.ok=false` na resposta).
  - `200 SEM_VETORES` — usuário sem biometria (`motor2.ok=false` na resposta).
  - `200 VISION_FALHOU` — erro interno Motor 2 (`motor2.ok=false` na resposta).
- Notas técnicas (ADRs aplicados):
  - [ADR-009](./decisoes.md#adr-009): fotos não persistidas (só trafegam em memória).
  - [ADR-013](./decisoes.md#adr-013): Motor 1 é apenas explicador; sua decisão **não** emite JWT. Só Motor 2 autentica.
  - [ADR-014](./decisoes.md#adr-014): veto de liveness — Motor 2 só autentica se `score >= limiar` **e** `livenessOk=true`.
  - [ADR-015](./decisoes.md#adr-015): Motor 2 usa `enforce_detection=False`; Motor 1 faz sua própria auditoria ICAO/liveness.
  - [ADR-016](./decisoes.md#adr-016): este endpoint.

#### Listar vetores do usuário
`GET /api/biometria/vetores` *(JWT)* — devolve id/pose/modelo/criadoEm (sem o conteúdo cifrado).

#### Remover vetores (LGPD — direito de exclusão)
`DELETE /api/biometria/vetores` *(JWT)* → `200 { "removidos": N }`. Erro `404 VETORES_NAO_ENCONTRADOS`.

### Biometria — Motor 1 (DEMO comparativo)

`POST /api/biometria/gemini/comparar` *(JWT)*
- Body: `multipart/form-data` com `referencia` + `atual` (2 imagens).
- Resposta `200`: inclui `similaridadeFacial`, `confianca`, `icaoConformidade`, `liveness`, `justificativa`.
- **Headers** `X-Motor: 1-gemini-demo` e `X-Warning` deixam claro: é DEMO, não usar para autenticar.

### Laudo Técnico Biométrico (ADR-014)

#### Obter laudo de uma verificação
`GET /api/biometria/laudo/{logId}`
- **Público** (sem `[Authorize]` — `[AllowAnonymous]` no MVP). Lê `Biometria_Logs` (+ nome do usuário). Devolve estrutura pronta para o front montar no layout do protótipo. Como é read-only e só expõe métricas + parecer (sem imagens nem dados sensíveis), pode ser compartilhado por URL.
- `nomeUsuario` será `null` quando o log já tiver sido anonimizado (após exclusão de conta).
- **Observação:** o `POST .../gerar` abaixo ainda exige JWT (regenera o parecer usando fotos enviadas — só o dono/admin pode fazer).
- Resposta `200`:
```json
{
  "logId": 42, "usuarioId": 123, "nomeUsuario": "...", "criadoEm": "...",
  "operacao": "login", "motor": 2,
  "similaridade": 85,
  "decisao": "AUTENTICADO | INCONCLUSIVO | REJEITADO | ERRO",
  "parecerPendente": false,
  "parecerTexto": "...",
  "parecer": {
    "decisao": "...", "acaoRecomendada": "PROSSEGUIR | RE-VALIDAR | BLOQUEAR | INVESTIGAR",
    "similaridadePct": 85.0, "resumo": "...",
    "livenessAuditoria": "Captura legítima - aprovada..."
  },
  "pontosAnatomicos": [
    { "item": "Distância Interocular", "status": "Igual", "observacao": "..." },
    { "item": "Estrutura do Nariz", "status": "Igual", "observacao": "..." },
    { "item": "Arco das Sobrancelhas", "status": "Igual", "observacao": "..." },
    { "item": "Formato dos Lábios", "status": "Igual", "observacao": "..." },
    { "item": "Linha do Maxilar e Barba", "status": "Igual", "observacao": "..." }
  ],
  "liveness": { "ok": true, "detalhe": "..." },
  "metricas": { "score": 0.85, "limiar": 0.6, "latenciaMs": 158, "device": "cpu", "motor": 2 },
  "erro": null
}
```
- Erro: `404 LOG_NAO_ENCONTRADO`.

#### Regenerar parecer do laudo
`POST /api/biometria/laudo/{logId}/gerar` *(JWT)*
- Body: `multipart/form-data` com `referencia` + `atual` (2 imagens — **usadas em memória**, não persistidas — ADR-009).
- Fluxo: chama Motor 1 (Gemini) com as 2 fotos + log do Motor 2; monta o `parecerJson` e `pontosAnatomicosJson` e persiste em `Biometria_Logs`.
- Resposta `200`: laudo completo (igual ao GET, mais `metricasMotor1` com `similaridadeGemini`, `confianca`, `livenessClassificacao`).
- Erros: `404 LOG_NAO_ENCONTRADO | 400 REFERENCIA_AUSENTE | 400 ATUAL_AUSENTE | 503 GEMINI_NAO_CONFIGURADO | 502 MOTOR1_FALHOU`.

### Admin — painel interno (protegido por JWT role=admin — ADR-022)

> Todos os endpoints abaixo (exceto `/login`) exigem header `Authorization: Bearer <token admin>` obtido via `POST /api/admin/login`. Token válido por 8h. Configurar senha via env `ADMIN_PASSWORD_HASH` (SHA-256 hex, recomendado) ou `ADMIN_PASSWORD` (texto, dev). Sem senha configurada → `500 ADMIN_NAO_CONFIGURADO`.

#### Login admin
`POST /api/admin/login`  *(sem auth)*
- Body:
```json
{ "senha": "string" }
```
- Resposta `200`:
```json
{ "token": "eyJhbGci...", "expiraEmHoras": 8, "papel": "admin" }
```
- Erros: `400 SENHA_OBRIGATORIA | 401 SENHA_INVALIDA | 500 ADMIN_NAO_CONFIGURADO`.
- Comparação em tempo constante (anti timing attack). Falhas são logadas com IP.

#### Validar sessão admin
`GET /api/admin/me`
- Resposta `200`: `{ "papel": "admin", "sub": "admin", "expiraEm": 8 }`
- Erros: `401` (token ausente / inválido / expirado / sem role admin).

#### Listar usuários com métricas agregadas
`GET /api/admin/usuarios?q=&limit=`
- Query params:
  - `q` (opcional) — filtra por `nome` ou `cpf` (contains).
  - `limit` (opcional, default `100`, clamp `1`–`500`).
- Resposta `200`:
```json
{
  "total": 42,
  "totalVetores": 71,
  "totalLogs": 318,
  "retornados": 2,
  "usuarios": [
    {
      "id": 123, "nome": "...", "cpf": "00000000000",
      "dataNascimento": "1990-01-01", "nomeMae": "...",
      "consentimentoAceito": true, "termoVersao": "1.0", "criadoEm": "...",
      "totalVetores": 2, "totalDocumentos": 1, "totalLogs": 14,
      "ultimoLogin": "2026-07-19T12:00:00Z"
    }
  ]
}
```

#### Detalhar um usuário
`GET /api/admin/usuarios/{id}`
- Resposta `200`: `{ usuario, vetores[], documentos[], logs[] }` — vetores sem conteúdo cifrado (só id/pose/modelo/criadoEm); documentos com `dadosExtraidosJson`; últimos 20 logs (operacao, motor, autenticado, score, limiar, latenciaMs, device, livenessOk, erro, criadoEm).
- Erro: `404 USUARIO_NAO_ENCONTRADO`.

#### Excluir usuário (LGPD — direito ao esquecimento, admin)
`DELETE /api/admin/usuarios/{id}`
- Mesma política de exclusão do `DELETE /api/auth/usuario`: remove vetores + documentos cadastrados, anonimiza logs (`usuarioId = null`) mantidos para auditoria, e por fim remove o registro de usuário.
- Resposta `200`:
```json
{
  "status": "excluido",
  "usuarioId": 123,
  "nome": "...",
  "vetoresRemovidos": 2,
  "documentosRemovidos": 1,
  "logsAnonimizados": 14,
  "mensagem": "Usuario excluido. Logs anonimizados mantidos para auditoria (LGPD Art. 18, VI)."
}
```
- Erro: `404 USUARIO_NAO_ENCONTRADO`.

#### Listar últimos logs biométricos (auditoria)
`GET /api/admin/logs?limit=&operacao=`
- Query params:
  - `limit` (opcional, default `50`, clamp `1`–`500`).
  - `operacao` (opcional) — filtra por `operacao` (ex.: `login`, `cadastro`).
- Resposta `200`: `{ retornados, logs[] }` onde cada log traz `nomeUsuario` (resolvido via join; `null` se o usuário foi excluído/anonimizado), além de `usuarioId`, `operacao`, `motor`, `autenticado`, `score`, `limiar`, `latenciaMs`, `device`, `livenessOk`, `erro`, `criadoEm`.

---

## Vision Service (Python / FastAPI) — `http://localhost:8000`

> Interno. Protegido por header `X-Internal-Token`. **Não exposto à internet** (ADR-003).

### Health
`GET /health` → `200 { "status": "ok", "device": "cpu", "model": "Facenet", "tokenConfigurado": true }`

### Gerar embeddings
`POST /embeddings`
- Header: `X-Internal-Token`.
- Body: `multipart/form-data` com `files` (1+ imagens) e `pose` (opcional).
- Resposta:
```json
{
  "embeddings": [ [0.012, -0.03, "..."] ],
  "modelo": "Facenet", "device": "cpu", "latenciaMs": 144, "quantidade": 1
}
```

### Comparar (login Motor 2)
`POST /verificar`
- Body:
```json
{
  "imagemAtual": "<base64 sem prefixo data:>",
  "vetoresCadastrados": [ [ ... ], [ ... ], [ ... ] ],
  "limiar": 0.60
}
```
- Resposta:
```json
{ "autenticado": true, "score": 0.87, "livenessOk": true, "device": "cpu", "latenciaMs": 380 }
```
- Liveness simples: detecta 1+ rosto via OpenCV. Movimento entre frames é validado em `/liveness` separado.

### Executar desafio de liveness
`POST /liveness`
- Body: `multipart/form-data` com 2+ frames ( desafio "vire o rosto" ).
- Resposta: `{ "livenessOk": true, "movimentoDetectado": true, "framesAnalisados": 2 }`

---

## Códigos de erro (resumo)

| Código | Significado |
|---|---|
| `CPF_INVALIDO` | Dígitos verificadores falharam (ADR-006) |
| `CPF_JA_CADASTRADO` | Conflito de unicidade |
| `CONSENTIMENTO_OBRIGATORIO` | LGPD: aceite do termo é obrigatório |
| `TERMO_INDISPONIVEL` | Versão do termo não existe ou está inativa |
| `FOTOS_AUSENTES` / `FOTOS_EXCESSO` | Cadastro facial exige 1 a 3 fotos (ADR-004) |
| `FOTO_AUSENTE` / `FOTO_MUITO_GRANDE` | Validação de upload |
| `FOTO_REFERENCIA_AUSENTE` / `FOTO_ATUAL_AUSENTE` | Campos `fotoReferencia`/`fotoAtual` vazios no `verificar-comparativo` (ADR-016) |
| `MIME_NAO_SUPORTADO` | Aceitos: JPEG, PNG, WebP |
| `LIMIAR_INVALIDO` | limiar deve estar entre 0 e 1 |
| `IMAGENS_AUSENTES` | Nenhuma imagem enviada para `/api/documentos/*` |
| `IMAGENS_EXCESSO` | Mais de 5 imagens por requisição de extração |
| `IMAGEM_VAZIA` | Arquivo enviado com 0 bytes |
| `IMAGEM_MUITO_GRANDE` | Excedeu 10 MB por arquivo |
| `VALIDACAO_CAMADA1` | Extração ok, mas validação ADR-006 falhou (422) |
| `EXTRACAO_FALHOU` | Gemini não conseguiu estruturar o documento (422) |
| `VETORES_JA_EXISTEM` | Re-cadastro sem remoção prévia |
| `VETORES_NAO_ENCONTRADOS` | Exclusão sem vetores existentes |
| `SEM_VETORES` | Login facial de usuário sem cadastro |
| `SEM_ROSTO` | DeepFace não detectou rosto |
| `USUARIO_NAO_ENCONTRADO` | CPF não cadastrado |
| `LOG_NAO_ENCONTRADO` | logId inexistente |
| `DECIFRA_FALHOU` | AES-256-GCM tag falhou (vetor adulterado?) |
| `VISION_FALHOU` | vision-service devolveu erro |
| `VISION_UNAVAILABLE` | vision-service offline (503) |
| `GEMINI_NAO_CONFIGURADO` | `Gemini:ApiKey` ausente |
| `MOTOR1_FALHOU` | Erro inesperado do Gemini |
| `RATE_LIMITED` | Limite de chamadas excedido (reserva futura) |

---

## Tokens e chaves (não commitar)

Variáveis em [backend/appsettings.Development.json](../backend/appsettings.Development.json) (somente Dev):
- `ConnectionStrings:Default` — MySQL VPS
- `AES_EMBEDDING_KEY` — 32 bytes base64 para AES-256-GCM (ADR-009)
- `Jwt:Secret` — segredo HS256 do JWT (≥32 chars)
- `Gemini:ApiKey` — chave do Gemini 3.5 Flash
- `Gemini:Model` — `gemini-3.5-flash`
- `VisionService:Url` / `VisionService:Token` — acesso interno ao vision-service

Em produção, todas via variáveis de ambiente ou secrets manager.
