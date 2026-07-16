# Métricas

O MVP existe para **coletar métricas comparativas** entre os 3 motores. Este documento define o quê medir, onde armazenar e como apresentar.

## Objetivo da medição

Responder, com dados, perguntas como:
- Qual motor é mais rápido (latência)?
- Qual é mais preciso (acurácia / FAR / FRR)?
- CPU vs GPU: vale o investimento em GPU (Motor 2)?
- IA generativa é viável para biometria? (esperado: não)

## O que medir

Para **cada** operação de cadastro/login, registrar (tabela `Biometria_Logs`):

| Métrica | Descrição |
|---|---|
| `latenciaMs` | Tempo total da operação (captura desconsiderada; só processamento) |
| `score` | Similaridade retornada (0..1) quando aplicável |
| `limiar` | Threshold aplicado |
| `autenticado` | Resultado final (true/false) |
| `livenessOk` | Prova de vida passou |
| `device` | `cpu` / `cuda` / `cloud` |
| `motor` | 1, 2 ou 3 |
| `operacao` | `cadastro` / `login` |
| `erro` | Código de erro, se houve |

## Indicadores derivados (calculados para a apresentação)

| Indicador | Definição |
|---|---|
| **Latência p50 / p95** | Mediana e 95º percentil por motor |
| **FAR** (_False Acceptance Rate_) | % de impostores aceitos |
| **FRR** (_False Rejection Rate_) | % de legítimos rejeitados |
| **Taxa de spoofing detectado** | % de ataques de tela bloqueados (Motor 1 espera falhar aqui) |
| **Custo por tentativa** | $ estimado (Gemini, Azure) — relevante p/ diretoria |
| **Throughput** | Tentativas/segundo (CPU vs GPU no Motor 2) |

## Onde armazenar

- Tabela `Biometria_Logs` (ver [banco-dados.md](./banco-dados.md)). Cada linha = uma operação.
- Logs estruturados nos 3 serviços (correlacionar por um `traceId`).

## Como apresentar (decisão — ADR-008)

A exibição acontece em **dois momentos**, para máximo impacto na apresentação executiva:

### 1. Cards em tempo real (após cada login)
Ao executar um login, o frontend mostra **um card por motor** lado a lado, com:
- Tempo de resposta (latência em ms)
- Score de similaridade
- Autenticado? (sim/não)
- Device (CPU/GPU/cloud)
- Liveness OK?

Esse formato cria o efeito imediato "olha como cada motor se sai" — essencial para a diretoria **sentir** a diferença durante a demo ao vivo.

### 2. Dashboard final (`/dashboard`)
Página agregando `Biometria_Logs` com:
- **Latência média (p50/p95) por motor** — gráfico de barras (Recharts).
- **Taxa de sucesso/falha** por motor.
- **Comparação CPU vs GPU** (Motor 2) — justifica (ou não) investimento em GPU.
- **Volume de tentativas** por motor.
- **Taxas de erro** (extração falhou, liveness falhou, etc.) — importante para mostrar os limites de cada abordagem.

> Dados sempre **agregados/anonimizados** (LGPD). Sem nomes, CPFs ou fotos no dashboard.

### Stack sugerida para o dashboard
- [Recharts](https://recharts.org/) (React) — simples, suficiente para barras/linhas.
- Endpoint `GET /api/metricas/dashboard` no backend retornando os agregados prontos.

## Suíte de testes controlados (pré-demo)

Para que FAR/FRR tenham sentido, executar um conjunto padronizado:
1. **Legítimos:** N logins de pessoas cadastradas, com variações de pose/iluminação.
2. **Impostores:** M tentativas com fotos de pessoas não cadastradas.
3. **Spoofing:** K tentativas com foto de tela de celular da pessoa cadastrada.

Mesmo conjunto aplicado aos 3 motores para comparação justa.

## Evoluções futuras

- Exportar `Biometria_Logs` para uma ferramenta de BI.
- Definir alertas de degradação (ex.: latência p95 acima de X).
