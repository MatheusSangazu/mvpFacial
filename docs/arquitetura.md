# Arquitetura

Visão de alto nível dos componentes e dos fluxos de cadastro e login. Para decisões de _por quê_, veja [decisoes.md](./decisoes.md). Para detalhes de endpoints, [api.md](./api.md).

## Componentes

```text
┌──────────────┐       (HTTP/JSON)        ┌──────────────────┐
│   Frontend   │  ─────────────────────▶  │   Backend (C#)   │
│   Next.js    │                          │      .NET        │
│ - Webcam     │  ◀─────────────────────  │  Orquestrador    │
│ - Capturas   │                          │                  │
│ - Seletor de │                          └────────┬─────────┘
│   motores    │                                   │
└──────────────┘                                   │ (HTTP/JSON)
                                                    ▼
                                         ┌──────────────────┐
              ┌──────────────┐           │  Vision Service  │
              │   Gemini API │◀──────────│  (Python/FastAPI)│
              │  (multimodal)│           │  - DeepFace      │
              └──────────────┘           │  - OpenCV        │
                     ▲                   │  - Embeddings    │
                     │                   └────────┬─────────┘
                     │ (HTTP)                      │
              ┌──────┴───────┐                     │
              │ Backend (C#) │                     │
              └──────┬───────┘                     │
                     │                             ▼
                     │                  ┌──────────────────┐
                     └────────────────▶ │  Banco de Dados  │
                                        │  (Relacional)    │
                                        └──────────────────┘
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
- `GeminiService`: extração de documentos (e Motor 1 de liveness).
- `PythonVisionService`: cliente HTTP para o vision-service (Motor 2).
- Validação determinística dos dados extraídos (ver ADR-006).

### Vision Service (Python / FastAPI)
- Geração de embeddings com `DeepFace`.
- Comparação de embeddings (cosseno) e threshold.
- Liveness caseiro com OpenCV (detecção de movimento/desafio).
- Suporte a toggle CPU vs GPU (CUDA).

### Banco de Dados
- `Usuarios`: dados cadastrais + dados extraídos de documentos.
- `Biometria_Logs`: métricas de cada tentativa (latência, acurácia, motor, acerto/erro).
- `Vetores_Faciais`: embeddings (JSON/array) por usuário.

## Fluxo de Cadastro (Pré-matrícula)

```text
1. Usuário abre /cadastro no Next.js
2. Envia fotos dos documentos (RG/CNH/comprovante)
3. Next.js -> Backend (POST /api/documentos/extrair)
4. Backend -> GeminiService -> Gemini (System Prompt estruturado)
5. Gemini devolve JSON estruturado
6. Backend valida (CPF, datas, campos) — ADR-006
7. Usuário tira 3 fotos faciais (burst com overlay)
8. Next.js -> Backend (POST /api/usuarios/:id/biometria)
9. Backend -> Vision Service (POST /embeddings) -> DeepFace
10. Vision Service devolve 3 embeddings
11. Backend persiste usuário + embeddings (NÃO faz média — ADR-004)
12. Tudo com logs de métricas em Biometria_Logs
```

## Fluxo de Login Facial

```text
1. Usuário abre /login e SELECIONA o motor (1 ou 2)
2. Next.js captura vídeo/foto
3. Next.js -> Backend (POST /api/login/facial { motor })
4. Backend roteia conforme o motor:

   MOTOR 1 (IA generativa — DEMO de falha)
   -> GeminiService envia mídia para o Gemini validar identidade+liveness
   -> retorno inseguro, marcado como demo

   MOTOR 2 (visão local)
   -> Vision Service executa desafio (OpenCV) + embedding (DeepFace)
   -> compara contra os embeddings cadastrados (score máximo, threshold)
   -> CPU ou GPU conforme toggle

5. Backend registra resultado + métricas em Biometria_Logs
6. Backend devolve sucesso/falha + métricas ao Next.js
```

## Fronteiras de confiança

- O **frontend nunca fala com IA/vision/banco diretamente**; todo tráfego passa pelo backend, que aplica validação e autenticação.
- Comunicação entre backend e vision-service deve usar segredo compartilhado ou rede privada (não exposta à internet). Detalhes em [lgpd-seguranca.md](./lgpd-seguranca.md).

## Estratégia de degradação (_fallback_)

- **Vision service indisponível:** login do Motor 2 retorna erro explícito (não cai para outro motor automaticamente — o objetivo é medir cada motor isoladamente).
- **Gemini indisponível:** cadastro de documentos bloqueado temporariamente, com mensagem clara.
