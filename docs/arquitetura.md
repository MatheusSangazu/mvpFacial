# Arquitetura

Visão de alto nível dos componentes e dos fluxos de cadastro e login. Para decisões de _por quê_, veja [decisoes.md](./decisoes.md). Para detalhes de endpoints, [api.md](./api.md).

## Componentes

```mermaid
flowchart LR
    subgraph Cliente
        F["Frontend (Next.js)<br/> Webcam · Capturas · UI Laudo"]
    end

    subgraph Backend["Backend C# .NET — Orquestrador"]
        C[Controllers<br/>Auth · Document · Biometria · Laudo]
        S[Services<br/>JWT · AES-256 · Gemini · PythonClient]
        C --> S
    end

    subgraph Vision["Vision Service Python (interno)"]
        V[FastAPI<br/>/embeddings · /verificar · /liveness]
        DF[DeepFace<br/>Facenet 128-dim]
        CV[OpenCV<br/>Liveness]
        V --> DF
        V --> CV
    end

    G[(Gemini 3.5 Flash<br/>Motor 1 + Laudo)]
    DB[(MySQL 8<br/>VPS)]

    F <-->|HTTP/JSON + JWT| C
    S <-->|X-Internal-Token| V
    S <-->|HTTPS + API Key| G
    S <-->|SQL/TLS| DB

    classDef ext fill:#fef3c7,stroke:#92400e
    class G,DB ext
    classDef internal fill:#dbeafe,stroke:#1e3a8a
    class F,V internal
```

## Responsabilidades por serviço

### Frontend (Next.js)
- UI de cadastro e login, com seletor de motor facial.
- Acesso à webcam com overlays visuais (guia de rosto, _burst_ de capturas).
- Captura de fotos de documentos e envio ao backend.
- Apresentação de métricas (latência/acurácia) pós-operação.
- **Não** chama IA nem o vision-service diretamente; passa sempre pelo backend.

### Backend (C# .NET)
- Orquestrador central: regras de negócio, persistência, métricas.
- **Camada de serviços** ([backend/Services](../backend/Services)):
  - `CriptografiaService` — AES-256-GCM para vetores faciais em repouso (ADR-009).
  - `JwtService` — emissão de tokens HS256 para autenticação.
  - `ValidacaoCpfService` — Camada 1 do ADR-006 (dígitos verificadores).
  - `GeminiService` — extração de documentos (ADR-001, ADR-005).
  - `Motor1GeminiService` — Motor 1 (DEMO comparativa + explicador do Laudo ADR-014).
  - `PythonVisionService` — cliente HTTP para o vision-service (Motor 2).
- **Camada de controllers** ([backend/Controllers](../backend/Controllers)):
  - `AuthController` — `/api/auth/cadastro`, `/api/auth/me`.
  - `DocumentController` — `/api/documentos/extrair`.
  - `BiometriaController` — cadastro/verificação/listagem/remoção de vetores + DEMO do Motor 1.
  - `LaudoController` — Laudo Técnico Biométrico (ADR-014).
- Validação determinística dos dados extraídos (ver ADR-006).

### Vision Service (Python / FastAPI)
- Geração de embeddings com `DeepFace` (modelo padrão: Facenet, 128 dim).
- Comparação de embeddings (cosseno) e threshold.
- Liveness caseiro com OpenCV (detecção de rostos + movimento entre frames).
- Suporte a toggle CPU vs GPU (CUDA). **No Windows, roda em CPU** (limitação do TF ≥ 2.11 — ver ADR-013).

### Banco de Dados
- `Usuarios`: dados cadastrais + dados extraídos de documentos.
- `Biometria_Logs`: métricas de cada tentativa (latência, acurácia, motor, acerto/erro) + colunas do Laudo (parecerTexto, parecerJson, pontosAnatomicosJson).
- `Vetores_Faciais`: embeddings (JSON cifrado AES-256-GCM) por usuário.
- `Termos_Consentimento`: termos LGPD versionados.

## Jornada do Usuário (onboarding completo)

Visão de alto nível do caminho que o usuário percorre do cadastro até estar pronto para fazer login facial. Swim lanes (raias) separam o que é ação humana vs automação do sistema.

```mermaid
flowchart LR
    %% Raias: Usuário | Frontend | Backend | Servicos externos
    subgraph User["👤 Usuário"]
        U1[Acessa /cadastro] --> U2[Aceita termo LGPD]
        U2 --> U3[Anexa fotos<br/>RG / CNH / comprovante]
        U3 --> U4[Confere dados<br/>extraídos]
        U4 --> U5[Tira 1-3 selfies<br/>com overlay facial]
        U5 --> U6((Pronto para<br/>login facial))
    end

    subgraph FE["🖥️ Frontend Next.js"]
        F1[/cadastro page/]
        F2[CameraOverlay<br/>+ DocumentUploader]
        F3[Review form]
        F1 -.-> F2 -.-> F3
    end

    subgraph BE["⚙️ Backend C# .NET"]
        B1[AuthController<br/>POST /api/auth/cadastro]
        B2[DocumentController<br/>POST /api/documentos/extrair]
        B3[ValidacaoCpfService<br/>+ ValidacaoDocumentoService<br/>Camada 1 ADR-006]
        B4[BiometriaController<br/>POST /api/biometria/cadastrar]
        B5[CriptografiaService<br/>AES-256-GCM]
        B1 --> B3 --> B4 --> B5
    end

    subgraph EXT["🌐 Serviços externos"]
        G[(Gemini 3.5 Flash<br/>extração de doc)]
        V[(Vision Service<br/>DeepFace + OpenCV)]
        DB[(MySQL<br/>VPS)]
    end

    %% Conexões entre raias
    U1 -.-> F1
    U2 -.-> B1
    U3 -.-> F2
    F2 ==>|multipart| B2
    B2 ==>|HTTPS| G
    G -.->|JSON| B3
    B3 -.->|dados validados| F3
    U4 -.-> F3
    U5 -.-> F2
    F2 ==>|multipart + JWT| B4
    B4 ==>|X-Internal-Token| V
    V -.->|embeddings| B5
    B5 ==>|cifra + persiste| DB
    B4 -.->|201 OK| U6

    classDef userNode fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef feNode fill:#dbeafe,stroke:#1e3a8a,color:#1e3a8a
    classDef beNode fill:#fce7f3,stroke:#9d174d,color:#831843
    classDef extNode fill:#fef3c7,stroke:#92400e,color:#78350f
    classDef finalNode fill:#fcd34d,stroke:#b45309,color:#78350f,font-weight:bold

    class U1,U2,U3,U4,U5 userNode
    class F1,F2,F3 feNode
    class B1,B2,B3,B4,B5 beNode
    class G,V,DB extNode
    class U6 finalNode
```

| Etapa | Quem faz | O que acontece |
|---|---|---|
| 1 | Usuário | Acessa `/cadastro` e lê o termo de consentimento LGPD |
| 2 | Usuário + Backend | Aceita o termo → `POST /api/auth/cadastro` cria usuário e emite JWT |
| 3 | Usuário + Frontend | Anexa 1+ fotos do documento via `DocumentUploader` |
| 4 | Backend + Gemini | `POST /api/documentos/extrair` → Gemini 3.5 Flash extrai dados estruturados |
| 5 | Backend | `ValidacaoDocumentoService` aplica Camada 1 do ADR-006 (dígitos de CPF, datas, consistência) |
| 6 | Usuário | Revê os dados extraídos, corrige se necessário |
| 7 | Usuário + Frontend | Tira 1-3 selfies com overlay facial via `CameraOverlay` |
| 8 | Backend + Vision Service | `POST /api/biometria/cadastrar` → DeepFace gera embeddings (Facenet 128-dim) |
| 9 | Backend | `CriptografiaService` cifra cada embedding com AES-256-GCM antes de gravar |
| 10 | Backend → MySQL | Persiste em `Vetores_Faciais` + registra em `Biometria_Logs` |
| ✓ | Usuário | Está pronto para fazer login facial em `/login` |

## Jornada do Usuário (login facial)

Caminho da autenticação facial, do `/login` até a tela do Laudo Técnico. Cobre os 3 desfechos possíveis (AUTENTICADO, INCONCLUSIVO, REJEITADO) e o veto de liveness (ADR-014).

```mermaid
flowchart LR
    subgraph User["👤 Usuário"]
        U1[Acessa /login] --> U2[Digita CPF]
        U2 --> U3[Captura 1 selfie]
        U3 --> U4{Resultado?}
        U4 -->|autenticado| U5((✅ Acesso<br/>concedido))
        U4 -->|inconclusivo| U6[⚠️ Re-validar<br/>liveness falhou]
        U4 -->|rejeitado| U7[❌ Acesso negado<br/>biometria não confere]
        U6 -.->|tira nova selfie| U3
        U5 --> U8[Abre Laudo Técnico<br/>para auditoria]
    end

    subgraph FE["🖥️ Frontend Next.js"]
        F1[/login page/]
        F2[CameraOverlay<br/>CPF input + captura]
        F3[Tela de resultado<br/>+ Laudo card]
        F1 -.-> F2 -.-> F3
    end

    subgraph BE["⚙️ Backend C# .NET"]
        B1[BiometriaController<br/>POST /api/biometria/verificar]
        B2[ValidacaoCpfService<br/>Camada 1 ADR-006]
        B3[CriptografiaService<br/>decifra AES-256-GCM]
        B4[Regra ADR-014<br/>livenessOk=false<br/>⇒ nunca AUTENTICADO]
        B5[LaudoController<br/>GET /api/biometria/laudo/{logId}]
        B1 --> B2 --> B3 --> B4
        B4 -.-> B5
    end

    subgraph EXT["🌐 Serviços externos"]
        V[(Vision Service<br/>DeepFace + OpenCV)]
        G[(Gemini 3.5 Flash<br/>parecer do Laudo)]
        DB[(MySQL<br/>VPS)]
    end

    %% Fluxo principal
    U1 -.-> F1
    U2 -.-> F2
    U3 -.-> F2
    F2 ==>|multipart + CPF| B1
    B1 --> DB
    DB -.->|vetores cifrados| B3
    B1 ==>|X-Internal-Token| V
    V -.->|score + livenessOk| B4
    B4 -.->|grava Biometria_Logs| DB

    %% Desfechos
    B4 -.->|JWT| U5
    B4 -.->|sem JWT| U6
    B4 -.->|sem JWT| U7

    %% Laudo
    U8 -.-> F3
    F3 ==>|GET laudo| B5
    B5 --> DB
    F3 -.->|POST /gerar| G
    G -.->|parecer textual| B5

    classDef userNode fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef feNode fill:#dbeafe,stroke:#1e3a8a,color:#1e3a8a
    classDef beNode fill:#fce7f3,stroke:#9d174d,color:#831843
    classDef extNode fill:#fef3c7,stroke:#92400e,color:#78350f
    classDef okNode fill:#bbf7d0,stroke:#15803d,color:#14532d,font-weight:bold
    classDef warnNode fill:#fed7aa,stroke:#9a3412,color:#7c2d12,font-weight:bold
    classDef errNode fill:#fecaca,stroke:#991b1b,color:#7f1d1d,font-weight:bold

    class U1,U2,U3,U4,U8 userNode
    class F1,F2,F3 feNode
    class B1,B2,B3,B4,B5 beNode
    class G,V,DB extNode
    class U5 okNode
    class U6 warnNode
    class U7 errNode
```

| Etapa | Quem faz | O que acontece |
|---|---|---|
| 1 | Usuário | Acessa `/login` e digita o CPF |
| 2 | Usuário + Frontend | Captura 1 selfie via `CameraOverlay` |
| 3 | Backend | `ValidacaoCpfService` valida CPF (Camada 1 ADR-006) |
| 4 | Backend + MySQL | Carrega vetores de `Vetores_Faciais` e decifra com AES-256-GCM |
| 5 | Backend + Vision Service | `POST /verificar` → DeepFace gera embedding atual e compara cosseno; OpenCV valida liveness |
| 6 | Backend | Aplica regra ADR-014 (`livenessOk=false` ⇒ nunca `AUTENTICADO`) |
| 7 | Backend → MySQL | Grava métrica em `Biometria_Logs` (operacao=login) |
| 8 | Backend | Emite JWT **só se** `autenticadoFinal = true` |
| 9 | Frontend | Mostra resultado + card com link para o Laudo |
| 10 | Usuário (opcional) | Abre Laudo Técnico para auditoria → `GET /api/biometria/laudo/{logId}` |
| 11 | Usuário (opcional) | Gera parecer via Motor 1 → `POST /laudo/{logId}/gerar` |

**Desfechos possíveis (decisão tripla ADR-014):**

| Cor no diagrama | Resultado | Condição técnica | Ação |
|---|---|---|---|
| 🟢 verde | `AUTENTICADO` | `score >= limiar` E `livenessOk = true` | Emite JWT + libera acesso |
| 🟠 laranja | `INCONCLUSIVO` | `score >= limiar` E `livenessOk = false` | Re-validar (veto de liveness) |
| 🔴 vermelho | `REJEITADO` | `score < limiar` | Bloquear acesso |

## Fluxo de Cadastro (Pré-matrícula)

Cobre a extração de dados do documento + criação do usuário. A biometria facial vem depois (ver próximo fluxo).

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário
    participant F as Frontend (Next.js)
    participant B as Backend (C# .NET)
    participant G as Gemini 3.5 Flash
    participant DB as MySQL

    U->>F: Anexa fotos (RG/CNH/comprovante)
    F->>B: POST /api/documentos/extrair (multipart)
    B->>G: System prompt + imagens (anti-alucinação)
    G-->>B: JSON estruturado {nome, cpf, dataNascimento, ...}
    B->>B: Validação ADR-006 (dígitos CPF, datas, consistência)
    B-->>F: 200 dados extraídos
    F->>U: Confirma dados + pede aceite do termo LGPD
    U->>F: Aceita termo
    F->>B: POST /api/auth/cadastro {nome, cpf, consentimento}
    B->>DB: INSERT Usuarios + INSERT referência Termos_Consentimento
    DB-->>B: usuarioId
    B-->>F: 201 { usuario, token JWT (8h) }
    F->>U: Redireciona para cadastro facial
```

## Fluxo de Cadastro Facial (Motor 2 — DeepFace)

Gera os embeddings que servirão de referência para o login. Cifra com AES-256-GCM antes de persistir (ADR-009).

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário
    participant F as Frontend (Next.js)
    participant B as Backend (C# .NET)
    participant V as Vision Service (Python)
    participant DF as DeepFace (Facenet)
    participant DB as MySQL

    U->>F: Captura 1-3 fotos (burst com overlay)
    F->>B: POST /api/biometria/cadastrar (JWT, multipart)
    B->>B: Valida JWT + bloqueia re-cadastro
    B->>V: POST /embeddings (X-Internal-Token)
    V->>DF: represent(img, Facenet, opencv)
    DF-->>V: 1 embedding (128 dim) por foto
    V-->>B: { embeddings[], modelo, latenciaMs }
    B->>B: AES-256-GCM cifra cada embedding (ADR-009)
    B->>DB: INSERT Vetores_Faciais (embedding cifrado)
    B->>DB: INSERT Biometria_Logs (operacao=cadastro, motor=2)
    B-->>F: 201 { vetoresIds[], modelo, latenciaMs }
    F->>U: "Biometria cadastrada com sucesso"
```

## Fluxo de Login Facial (Motor 2 — DeepFace)

Pipeline de verificação com a regra crítica do ADR-014: `livenessOk=false` ⇒ nunca `AUTENTICADO`, mesmo com score alto.

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário
    participant F as Frontend (Next.js)
    participant B as Backend (C# .NET)
    participant V as Vision Service (Python)
    participant DF as DeepFace
    participant CV as OpenCV
    participant DB as MySQL

    U->>F: Digita CPF + captura 1 foto
    F->>B: POST /api/biometria/verificar (multipart)
    B->>B: Valida CPF (ADR-006 Camada 1)
    B->>DB: SELECT Usuarios WHERE cpf=?
    B->>DB: SELECT Vetores_Faciais WHERE usuarioId=?
    DB-->>B: embeddings cifrados
    B->>B: Decifra AES-256-GCM cada vetor
    B->>V: POST /verificar { imagemB64, vetores[], limiar }
    V->>DF: represent(imagem atual)
    V->>CV: detectar rostos (liveness simples)
    CV-->>V: { qtdRostos }
    V->>V: melhor_score_cosseno(atual, cadastrados)
    V-->>B: { autenticado, score, livenessOk, latenciaMs }
    B->>B: Aplica ADR-014: livenessOk=false ⇒ nunca AUTENTICADO
    Note over B: AUTENTICADO se score>=limiar E livenessOk=true<br/>INCONCLUSIVO se score>=limiar E livenessOk=false<br/>REJEITADO se score<limiar
    B->>DB: INSERT Biometria_Logs (operacao=login, motor=2)
    alt autenticadoFinal = true
        B->>B: JwtService.Gerar(usuario)
        B-->>F: 200 { resultado, metricas, logId, token, laudoUrl }
        F->>U: "Login OK" + pede parecer do Laudo
    else
        B-->>F: 200 { resultado=INCONCLUSIVO|REJEITADO, metricas, logId, token=null }
        F->>U: "Falha na autenticação"
    end
```

## Fluxo do Laudo Técnico (ADR-014)

Laudo híbrido: Motor 2 fornece o número; Motor 1 (Gemini) fornece o texto. Gerado sob demanda, depois da verificação.

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário (ou auditor)
    participant F as Frontend (Next.js)
    participant B as Backend (C# .NET)
    participant G as Gemini 3.5 Flash (Motor 1)
    participant DB as MySQL

    Note over U,DB: Etapa 1: GET laudo (lê do DB, pode estar pendente)
    U->>F: Abre tela de Laudo (logId)
    F->>B: GET /api/biometria/laudo/{logId} (JWT)
    B->>DB: SELECT Biometria_Logs WHERE id=? LEFT JOIN Usuarios
    DB-->>B: log + nome usuario
    B-->>F: 200 { similaridade, decisao, parecerTexto?, pontosAnatomicos?, ... }
    F->>U: Renderiza Laudo (layout do protótipo)

    Note over U,DB: Etapa 2 (opcional): gerar/regenerar parecer via Motor 1
    opt parecerPendente = true ou auditor quer regenerar
        U->>F: Anexa 2 fotos (referência + atual) — em memória, NÃO persistidas
        F->>B: POST /api/biometria/laudo/{logId}/gerar (multipart, JWT)
        B->>G: System prompt Laudo + 2 imagens
        G-->>B: JSON { similaridadeFacial, liveness{classificacao}, justificativa }
        B->>B: Monta parecerJson + pontosAnatomicosJson (5 pontos canônicos)
        B->>DB: UPDATE Biometria_Logs SET parecerTexto=?, parecerJson=?, pontosAnatomicosJson=?
        B-->>F: 200 Laudo completo
        F->>U: Mostra parecer atualizado
    end
```

## Diagrama de Estados — Decisão Biométrica (ADR-014)

Mostra como uma verificação facial transita entre os estados canônicos. A regra de ouro é: `livenessOk=false` **sempre** bloqueia `AUTENTICADO`, mesmo com score alto.

```mermaid
stateDiagram-v2
    [*] --> Pendente: POST /api/biometria/verificar

    Pendente --> Processando: CPF válido + usuário encontrado + vetores ok
    Pendente --> Erro: CPF_INVALIDO / USUARIO_NAO_ENCONTRADO / SEM_VETORES

    Processando --> Autenticado: score >= limiar E livenessOk = true
    Processando --> Inconclusivo: score >= limiar E livenessOk = false
    Processando --> Rejeitado: score < limiar
    Processando --> Erro: VISION_FALHOU / DECIFRA_FALHOU

    Autenticado --> [*]: emite JWT
    Inconclusivo --> [*]: ação RE-VALIDAR
    Rejeitado --> [*]: ação BLOQUEAR
    Erro --> [*]: ação INVESTIGAR

    note right of Autenticado
        Único estado que
        emite JWT (8h).
    end note

    note right of Inconclusivo
        ADR-014: veto de liveness.
        Recomendado nova prova.
    end note
```

| Estado | Condição técnica | Ação recomendada | JWT? |
|---|---|---|---|
| `Autenticado` | `score >= limiar` E `livenessOk = true` | PROSSEGUIR | Sim |
| `Inconclusivo` | `score >= limiar` E `livenessOk = false` | RE-VALIDAR | Não |
| `Rejeitado` | `score < limiar` | BLOQUEAR | Não |
| `Erro` | exceção no pipeline (vision offline, cifra quebrada etc.) | INVESTIGAR | Não |

## Diagrama de Estados — Laudo Técnico (parecer do Motor 1)

Mostra o ciclo de vida do parecer textual gerado pelo Gemini dentro de um `Biometria_Logs`. O Laudo pode ser gerado sob demanda e regenerado quantas vezes o auditor quiser.

```mermaid
stateDiagram-v2
    [*] --> SemLaudo: Biometria_Logs criado (cadastro ou login)

    SemLaudo --> ParecerPendente: GET /api/biometria/laudo/{logId}
    note right of SemLaudo
        Colunas parecerTexto / parecerJson /
        pontosAnatomicosJson ainda NULL.
    end note

    ParecerPendente --> Gerando: POST /laudo/{logId}/gerar (com 2 fotos)
    Gerando --> ParecerGerado: Gemini 200 + UPDATE DB
    Gerando --> ParecerPendente: Gemini 503 / 502 (mantém null)

    ParecerGerado --> ParecerGerado: POST /laudo/{logId}/gerar (regenerar)
    note right of ParecerGerado
        Auditor pode regenerar quantas
        vezes quiser — sobrescreve.
    end note

    ParecerGerado --> [*]: arquivado (retenção LGPD)
```

| Estado do parecer | Campos no DB | Resposta do GET /laudo |
|---|---|---|
| `SemLaudo` | tudo NULL | `parecerPendente: true`, textos nulos |
| `ParecerPendente` | tudo NULL | igual ao acima (já consultado) |
| `Gerando` | tudo NULL (em trânsito) | igual ao acima (race condition curta) |
| `ParecerGerado` | 3 colunas preenchidas | `parecerPendente: false`, com `parecer`, `pontosAnatomicos`, `liveness.detalhe` |

## Fronteiras de confiança

- O **frontend nunca fala com IA/vision/banco diretamente**; todo tráfego passa pelo backend, que aplica validação e autenticação.
- Comunicação entre backend e vision-service usa segredo compartilhado (`X-Internal-Token`); não exposta à internet (ADR-003). Detalhes em [lgpd-seguranca.md](./lgpd-seguranca.md).
- Fotos brutas **não são persistidas** (ADR-009, LGPD); só embeddings cifrados e parecer textual.

## Estratégia de degradação (_fallback_)

- **Vision service indisponível:** `/api/biometria/cadastrar` e `/verificar` devolvem `502 VISION_FALHOU` explícito (não cai para outro motor — o objetivo é medir cada motor isoladamente).
- **Gemini indisponível:** `/api/documentos/extrair`, `/api/biometria/gemini/comparar` e `/api/biometria/laudo/{id}/gerar` devolvem `503 GEMINI_NAO_CONFIGURADO` ou `502 MOTOR1_FALHOU`. O login facial pelo Motor 2 **continua funcionando** — só a geração do parecer textual fica pendente (`parecerPendente=true` no Laudo).
