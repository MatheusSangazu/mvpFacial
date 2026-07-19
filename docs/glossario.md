# Glossário

Termos do domínio para onboarding de equipe e agentes de IA.

| Termo | Definição |
|---|---|
| **Biometria facial** | Identificação/autenticação por características do rosto |
| **Embedding (vetor facial)** | Array de números que representa um rosto; gerado por um modelo (ex.: DeepFace) |
| **Vetor Mestre** | Termo do documento original para o embedding de referência do cadastro; neste projeto guardamos **múltiplos** embeddings (ADR-004) |
| **DeepFace** | Framework Python de reconhecimento facial sobre modelos como Facenet, VGG-Face |
| **Similaridade por cosseno** | Medida (0..1) de quão próximos dois embeddings são |
| **Threshold / Limiar** | Valor mínimo de similaridade para aceitar o match |
| **FAR** (_False Acceptance Rate_) | Taxa de falsa aceitação (impostor liberado) |
| **FRR** (_False Rejection Rate_) | Taxa de falsa rejeição (legítimo negado) |
| **Liveness (prova de vida)** | Verificação de que o alvo é uma pessoa real, não foto/vídeo |
| **Spoofing** | Ataque usando foto/tela/máscara para enganar a biometria |
| **OCR** | Reconhecimento óptico de caracteres (texto puro, sem contexto) |
| **IA Multimodal** | Modelo que processa múltiplas mídias (imagem+texto), ex.: Gemini |
| **CUDA** | Plataforma NVIDIA para processamento em GPU |
| **LGPD** | Lei Geral de Proteção de Dados (Brasil); biometria é dado sensível |
| **ADR** | _Architecture Decision Record_ — registro de decisão arquitetural |
| **Motor 1/2** | Os dois motores de login facial deste MVP (ver [motores-faciais.md](./motores-faciais.md)) |
| **Burst** | Captura rápida de várias fotos em sequência |
| **System Prompt** | Instrução de sistema que define o comportamento/saída esperada do LLM |

## Limiar (Threshold) — explicação detalhada

O **limiar** é o valor mínimo de similaridade (entre 0 e 1) que o sistema exige para considerar que duas fotos pertencem à mesma pessoa. Funciona como uma "nota de corte":

- **Score abaixo do limiar** → identidade rejeitada (não autentica)
- **Score ≥ limiar** → identidade aceita (passou pela comparação)

### Valores típicos

| Limiar | O que significa | Trade-off |
|---|---|---|
| `0.40` | Muito permissivo | Poucos falsos negativos (FRR baixo), muitos falsos positivos (FAR alto) — impostores passam |
| `0.60` | **Padrão do projeto** | Equilíbrio prático para DeepFace/Facenet |
| `0.80` | Rigoroso | Poucos falsos positivos, mas pessoas legítimas podem ser negadas se a foto estiver ruim |

### Por que não dá para "acertar sempre"

Aumentando o limiar, você fica mais seguro contra impostores, mas mais usuarios legítimos são barrados por causa de pequenas variações (iluminação, expressão, ângulo). É o trade-off **FAR × FRR**:

- **FAR** (_False Acceptance Rate_): taxa de impostores que passam — quanto **menor** o limiar, **maior** o FAR.
- **FRR** (_False Rejection Rate_): taxa de legítimos negados — quanto **maior** o limiar, **maior** o FRR.

Não existe limiar "perfeito"; o ponto ideal é calibrado empiricamente para o modelo usado (Facenet, VGG-Face, ArcFace etc.).

### Como ajustar no mvpFacial

- **Padrão**: `0.60` (hardcoded no `BiometriaController.cs` se não vier da request).
- **Sobrescrever**: campo opcional `limiar` no `/api/biometria/verificar` (form-data).
- **Tela de login**: há um input "Limiar (opcional)" na página `/login` — deixe vazio para usar o padrão.

### Limiar sozinho não basta

O limiar só mede **identidade** (geometria do rosto). Ele **não detecta foto de foto** — por isso existe o pilar de **liveness** (Motor 1 / Gemini), que vetoa a autenticação mesmo se o score for alto (ADR-014 e ADR-017).

