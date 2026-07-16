# MVP — Reconhecimento Facial e Extração Documental

MVP funcional para validar tecnicamente **cadastro com extração inteligente de documentos** e **login biométrico facial** em 3 motores distintos, com coleta de métricas (latência e acurácia) para apresentação executiva.

> Documento original de referência: [projeto.md](./projeto.md)

## Visão rápida

- **Objetivo:** demonstrar, em 3 motores, diferentes abordagens de biometria facial (IA generativa, visão computacional local e Cloud API) e a extração de dados de documentos via IA multimodal.
- **Público:** diretoria/stakeholders, com métricas de tempo de resposta e acurácia.
- **Status:** MVP de demonstração — **não é código de produção** (ver [docs/lgpd-seguranca.md](./docs/lgpd-seguranca.md) antes de qualquer uso real).

## Stack (proposta — decisão em aberto)

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js (React) + Tailwind CSS |
| Backend principal | C# (.NET) |
| Visão computacional | Python (FastAPI + OpenCV + DeepFace) |
| Banco de dados | Relacional hospedado em VPS |
| IA multimodal (documentos e Motor 1) | Google Gemini |

> A decisão final sobre manter os 3 serviços (Next.js + C# + Python) está registrada como **aberta** em [docs/decisoes.md](./docs/decisoes.md).

## Documentação

| Documento | Para quê serve |
|---|---|
| [docs/decisoes.md](./docs/decisoes.md) | Registros de Decisão Arquitetural (ADR) — o quê, por quê, alternativas |
| [docs/arquitetura.md](./docs/arquitetura.md) | Componentes, fluxos de cadastro e login |
| [docs/setup.md](./docs/setup.md) | Como subir o projeto localmente |
| [docs/api.md](./docs/api.md) | Contrato de endpoints |
| [docs/banco-dados.md](./docs/banco-dados.md) | Schema de tabelas e vetores faciais |
| [docs/motores-faciais.md](./docs/motores-faciais.md) | Detalhamento dos 3 motores, thresholds e riscos |
| [docs/metricas.md](./docs/metricas.md) | O que é medido e como visualizar |
| [docs/lgpd-seguranca.md](./docs/lgpd-seguranca.md) | Dados sensíveis, consentimento, criptografia |
| [docs/glossario.md](./docs/glossario.md) | Termos do domínio |

## Estrutura de pastas

```text
/mvp-reconhecimento-facial
├── /frontend         # Next.js
│   ├── /components   # CameraOverlay.tsx, DocumentUploader.tsx
│   ├── /pages        # /cadastro, /login
│   └── /utils
├── /backend          # API C# (.NET)
│   ├── /Controllers  # AuthController.cs, DocumentController.cs
│   ├── /Services     # GeminiService.cs, PythonVisionService.cs
│   └── /Data
├── /vision-service   # Python (FastAPI)
│   ├── main.py
│   ├── vector_math.py
│   └── liveness.py
├── /docs             # Esta documentação
└── README.md
```

## Quick Start

Veja [docs/setup.md](./docs/setup.md) para instruções detalhadas de cada serviço.

## Riscos conhecidos

- **Biometria = dado sensível (LGPD)** — ver [docs/lgpd-seguranca.md](./docs/lgpd-seguranca.md)
- **Motor 1 é propositalmente inseguro** — demo de falha, não usar em produção
- **Azure Face API** requer aprovação de "Limited Access"
