# Motores Faciais

Detalhamento dos 2 motores de login facial do MVP, com o que cada um demonstra, riscos, thresholds e parâmetros. Para o fluxo completo, veja [arquitetura.md](./arquitetura.md).

## Comparação rápida

| Motor | Tecnologia | Objetivo na demo | Adequado p/ produção? |
|---|---|---|---|
| 1 | IA Generativa (Gemini) | Mostrar **falha** (lento, vulnerável) | **Não** |
| 2 | Visão local (DeepFace + OpenCV) | Mostrar viabilidade CPU vs GPU | Com ressalvas (liveness frágil) |

---

## Motor 1 — IA Generativa (Gemini)

**Propósito:** demonstrar empiricamente por que **não** usar LLM multimodal para autenticação/liveness.

- **Fluxo:** C# envia vídeo/foto ao Gemini pedindo para validar identidade + prova de vida.
- **Marcado na UI como:** `Inseguro — Demonstração`.
- **Problemas esperados (e desejados na demo):**
  - Latência alta (vários segundos).
  - Falsos positivos em ataques de tela de celular (foto/vídeo).
  - Custo de tokens por tentativa.

**Thresholds:** não aplicável (resultado qualitativo do modelo).

**Risco:** alguém achar que é viável → mitigar com comunicação clara e badge.

---

## Motor 2 — Visão Computacional Local (DeepFace + OpenCV)

**Propósito:** mostrar solução autônoma, comparando CPU vs GPU, com custo marginal zero após implantado.

### Cadastro (geração do vetor de referência)
1. Câmera captura **3 fotos** (frente, esquerda, direita) com overlay de guia.
2. DeepFace extrai **3 embeddings**.
3. C# **persiste os 3 embeddings separados** (ADR-004 — não usa média).

### Login (verificação + liveness)
1. Next.js captura a foto atual (ou sequência curta).
2. Vision-service gera embedding atual.
3. Compara (cosseno) contra os **3 cadastrados**, usando o **score máximo**.
4. Liveness caseiro: OpenCV valida um **desafio aleatório** ("vire o rosto", "olhe para cima") por detecção de movimento/pose.

### Thresholds (parâmetros iniciais — calibrar empiricamente)
| Parâmetro | Valor sugerido | Observação |
|---|---|---|
| `limiar` (similaridade cosseno) | **0,60** | Ajustar com dataset de teste; mais alto = mais seletivo |
| `score` para autenticar | máximo entre os 3 vetores | Considerar também média se instável |
| Quadros do desafio de liveness | 3 a 5 | Equilíbrio latência x robustez |
| Resolução da imagem de entrada | 640px (maior face) | Reduzir para acelerar em CPU |

### CPU vs GPU (toggle de demonstração)
- `DEVICE=cpu`: funciona, mas latência alta (documentar na métrica).
- `DEVICE=cuda`: latência baixa; validar `torch.cuda.is_available()`.

### Limites conhecidos
- Liveness baseado em movimento é **burlável** (vídeo do rosto girando).
- DeepFace pode falhar em iluminação extrema / óculos/maquiagem muito diferentes do cadastro.

---

## Recomendação de calibração

Antes da apresentação, rodar um conjunto de **testes controlados**:
1. Mesma pessoa, variações de pose/iluminação → medir **FRR** (falsa rejeição).
2. Fotos/fotos de tela de outras pessoas → medir **FAR** (falsa aceitação) e spoofing.
3. Registrar tudo em `Biometria_Logs` e revisar em [metricas.md](./metricas.md).

Esses números dão credibilidade à apresentação executiva.

## Importância de mostrar as taxas de erro

O valor do MVP está em mostrar **os dois lados**: acertos e **falhas** de cada motor.
- **Motor 1:** espera-se latência alta e falsos positivos em spoofing (é a lição da demo).
- **Motor 2:** pode falhar em iluminação/pose extremas; o liveness caseiro tem limites.

> **Nota:** o ecossistema Google **não possui** uma API de reconhecimento facial gerenciada (ver seção abaixo). Essa ausência vira um ponto de aprendizado na apresentação — o chamado "buraco do Google" — reforçando por que a visão local (Motor 2) é o caminho viável.

Registrar sempre `erro` (código) e `autenticado` (bool) em `Biometria_Logs` para alimentar o dashboard com as **taxas de erro por motor** — dado central na apresentação executiva.

## Por que não há Motor 3 (cloud)?

O **Google Cloud Vision API** realiza apenas **detecção de rosto** (_face detection_), retornando _bounding boxes_, pontos faciais e atributos (emoção, óculos etc.). **Não** oferece **reconhecimento** (_1:N_, identificar quem é a pessoa num catálogo) nem **verificação** (_1:1_, confirmar que duas fotos são da mesma pessoa). Por isso, diferente do Azure Face API ou AWS Rekognition, não existe um serviço Google equivalente para compor um "Motor 3 em nuvem". 

No ecossistema 100% Google adotado por este MVP (ADR-010), a alternativa viável é a **visão local** (Motor 2 com DeepFace), que roda na própria infraestrutura e não depende de um serviço gerenciado de reconhecimento facial.
