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
| **Motor 1/2/3** | Os três motores de login facial deste MVP (ver [motores-faciais.md](./motores-faciais.md)) |
| **Limited Access (Azure)** | Política da Microsoft que exige aprovação para capacidades restritas da Face API |
| **Burst** | Captura rápida de várias fotos em sequência |
| **System Prompt** | Instrução de sistema que define o comportamento/saída esperada do LLM |
