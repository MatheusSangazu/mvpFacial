# Decisões Arquiteturais (ADR)

Registros de Decisão Arquitetural (_Architecture Decision Records_). Cada entrada segue o formato **Contexto → Decisão → Alternativas → Consequências → Status**. Sempre que algo mudar, adicione uma nova entrada (não reescreva a antiga).

Legenda de status: `Proposta` | `Aceita` | `Em debate` | `Depreciada` | `Substituída por ADR-XX`

---

## ADR-001 — Extração de documentos por IA Multimodal (Gemini) em vez de OCR tradicional

- **Status:** Aceita
- **Data:** 2026-07-15

### Contexto
No cadastro, precisamos extrair dados estruturados (nome, CPF, datas, etc.) de fotos de documentos (RG, CNH, comprovantes). Tradicionalmente isso seria feito com OCR (Tesseract, Google Cloud Vision) seguido de parsing.

### Decisão
Usar **IA Multimodal direta (Google Gemini)** para processar a imagem e devolver um JSON estruturado, com um _System Prompt_ rigoroso definindo o schema.

### Alternativas consideradas
1. **OCR clássico (Tesseract)** — descartado: propaga erros caractere a caractere, sem contexto do documento brasileiro, e dobra o pipeline (2 pontos de falha).
2. **Cloud Vision OCR + LLM** — descartado para o MVP: custo e latência adicionais sem benefício claro para documentos curtos.
3. **Azure Document Intelligence** — viável, mas adicionaria outra nuvem; manter só Gemini reduz complexidade.

### Consequências
- **+** A IA usa contexto visual: corrige ruídos físicos (CPF apagado, risco) pela rede neural.
- **+** Pipeline de 1 passo só.
- **−** Custo por token de imagem; necessário validar saída (a IA pode alucinar — ver ADR-006).
- **−** Dependência de um provedor.

### Quando o OCR tradicional voltaria a ser interessante
- Textos longos (PDFs jurídicos) onde o custo de tokens de imagem é proibitivo.
- Caligrafia manuscrita complexa com OCR especializado.

---

## ADR-002 — Manter o Motor 1 (Gemini Liveness) como demonstração intencional de falha

- **Status:** Aceita
- **Data:** 2026-07-15

### Contexto
O MVP tem 3 motores para comparar abordagens. A IA generativa não é adequada para liveness/autenticação (lenta, vulnerável a spoofing por tela de celular).

### Decisão
**Manter o Motor 1** no produto, com _badge_ explícito **"Inseguro — demonstração"** na UI e no código. O objetivo é mostrar à diretoria, empiricamente, por que **não** usar IA generativa para biometria.

### Alternativas
1. Remover o Motor 1 — descartado pela stakeholders (querem a comparação visível).
2. Implementar de verdade sem avisar — descartado: risco reputacional e de segurança.

### Consequências
- **+** Comparação didática clara entre as 3 abordagens.
- **−** Precisa de cuidado na comunicação para ninguém confundir com recurso de produção.
- **−** Custos de API do Gemini só para demonstrar uma falha.

---

## ADR-003 — Arquitetura em 3 serviços (Next.js + C# + Python)

- **Status:** Aceita
- **Data:** 2026-07-15

### Contexto
O escopo envolve frontend com câmera, backend com regras de negócio/integração, e visão computacional pesada (DeepFace/CUDA). Avaliamos se valem os 3 serviços ou uma versão simplificada.

### Decisão
Manter **3 serviços**: `frontend` (Next.js), `backend` (C# .NET), `vision-service` (Python FastAPI). O C# orquestra e chama o Python por HTTP quando precisa de visão. **Setup será bem documentado** para mitigar a fricção.

### Justificativa técnica (por que Python para visão, não C#)
Embora fosse possível fazer o que o Python faz usando C# (via ML.NET + ONNX), o Python é **significativamente mais fácil** para esta tarefa:
- **DeepFace** é nativo do Python (1 linha gera o embedding); não há equivalente direto em C#.
- **OpenCV** (`opencv-python`) é mais maduro que os bindings C# (Emgu CV, OpenCvSharp).
- **CUDA/GPU** funciona nativamente com PyTorch/TensorFlow; ML.NET tem suporte mais limitado.
- **Modelos pré-treinados** (Facenet, VGG-Face, ArcFace) nascem em Python; em C# exigiria export para ONNX e carga manual.
- **Comunidade/exemplos** de ML/CV em Python são massivos.

Logo, a divisão atual (C# orquestra, Python faz visão) é a mais racional. Fazer tudo em C# aumentaria a complexidade.

### Alternativas consideradas
1. **C# chama Python via CLI/library** (sem serviço HTTP) — menos um processo, mas acopla deploy e dificulta escalar a GPU separadamente.
2. **Consolidar tudo em Node/Next.js** — descartado: DeepFace/CUDA e bom SDK C# do Gemini favorecem a divisão atual.
3. **Backend em Python + frontend em Next.js (sem C#)** — viável para MVP, mas a equipe/proposta original usa C#.

### Consequências
- **+** Separação de responsabilidades clara; GPU fica isolada no Python.
- **+** Mais realista para um caminho de produção.
- **−** Mais fricção de setup/deploy — mitigada com documentação detalhada em [setup.md](./setup.md) e (futuro) docker-compose.
- **−** Observabilidade precisa cobrir 3 processos — logs estruturados com `traceId` compartilhado.

---

## ADR-004 — Vetor facial: múltiplos embeddings + comparação por score (em vez de média)

- **Status:** Aceita
- **Data:** 2026-07-15

### Contexto
No cadastro (Motor 2) capturamos 3 fotos (frente + lados). O documento original sugeria tirar a **média** dos 3 embeddings para gerar um "Vetor Mestre".

### Decisão
**Não usar média.** Armazenar os 3 embeddings separadamente e, no login, comparar a foto atual contra cada um, considerando o **score máximo** com threshold. Detalhes em [motores-faciais.md](./motores-faciais.md).

### Alternativas
1. **Média dos embeddings (proposta original)** — dilui sinais discriminativos e pode reduzir a acurácia em ângulos extremos.
2. **1 embedding só (a foto frontal)** — mais simples, porém perde robustez a variação de pose.

### Consequências
- **+** Maior acurácia e tolerância a poses.
- **−** Mais armazenamento e 3 comparações por login (custo computacional baixo, porém).

---

## ADR-005 — Modelo Gemini: 2.0 Flash como referência padrão

- **Status:** Aceita
- **Data:** 2026-07-15

### Contexto
O documento original cita Gemini 1.5 Flash. Desde então o Gemini 2.0 Flash oferece melhor relação custo/latência com capacidades multimodais equivalentes ou superiores.

### Decisão
Adotar **Gemini 2.0 Flash** como modelo padrão (documentos e Motor 1), parametrizável por variável de ambiente (`GEMINI_MODEL`) para troca fácil.

### Consequências
- **+** Latência e custo menores na demonstração.
- **−** Requer confirmação de cota/disponibilidade atual.

---

## ADR-006 — Validação em múltiplas camadas pós-extração de documentos

- **Status:** Aceita
- **Data:** 2026-07-15

### Contexto
O Gemini pode alucinar campos. Não podemos confiar cegamente na saída para gravar no banco. Além disso, a equipe quer garantir que o CPF pertence realmente à pessoa declarada.

### Decisão
Após a extração, o C# executa **3 camadas de validação** em sequência (fail-fast):

**Camada 1 — Validação sintática (local, instantânea)**
- CPF: dígitos verificadores válidos.
- Datas: plausibilidade (não futuras, não absurdas); idade mínima razoável.
- Nome: só letras/espaços, sem números.
- Campos obrigatórios presentes.

**Camada 2 — Validação oficial (API externa de CPF)**
- Confirma que o CPF **existe** e o **nome bate** com o cadastro da Receita.
- Candidatos: BrasilAPI/ReceitaWS (gratuito com limite) ou Serpro (oficial, pago).
- Seleção final da API registrada em [setup.md](./setup.md).

**Camada 3 — Consistência semântica**
- Se o usuário enviar RG **e** CNH, os nomes extraídos de ambos devem bater.
- Endereço presente quando comprovante enviado.

Dados inválidos retornam erro **específico** (qual camada falhou) para revisão do usuário. Nada é gravado silenciosamente.

### Alternativas consideradas
- Apenas validação de dígitos (sem API externa) — descartado: não garante que o CPF pertence à pessoa.
- Apenas API externa (sem validar dígitos) — descartado: desperdiça chamada de API em CPFs obviamente inválidos.

### Consequências
- **+** Qualidade de dados garantida no ponto de entrada (3 barreiras).
- **+** Camada 1 (dígitos) evita custo de API em entradas obviamente erradas.
- **−** Camada 2 adiciona dependência externa e latência; tratar indisponibilidade da API com clareza.
- **−** Pode exigir fluxo de re-tentativa quando a extração falha.

---

## ADR-007 — Azure Face API com _mock_ temporário (Limited Access)

- **Status:** Aceita
- **Data:** 2026-07-15

### Contexto
A Microsoft restringiu capacidades da Face API (princípios de IA responsável); o login facial exige aprovação de "Limited Access", que pode demorar. A equipe vai solicitar **trial de 30 dias** e preencher os formulários da Microsoft.

### Decisão
- **Motor 3 será o último a ser testado** no cronograma, dado o risco da aprovação.
- Enquanto a conta não é aprovada, o Motor 3 retorna **_mock_** parametrizado por _feature flag_ (`AZURE_USE_MOCK=true`).
- Assim que aprovado, basta desligar a flag para integrar de verdade.

### Alternativas
1. Esperar a aprovação antes de começar — descartado (bloqueia o cronograma).
2. Usar AWS Rekognition — alternativa válida, registrar como ADR se migrarmos.

### Consequências
- **+** Não bloqueia o MVP; métricas reais do Cloud virão quando a aprovação sair.
- **−** Comparação do Motor 3 fica parcial até a aprovação.
- **−** Risco de a aprovação demorar mais que o trial de 30 dias.

---

## ADR-008 — Apresentação de métricas: card por motor + dashboard final

- **Status:** Aceita
- **Data:** 2026-07-15

### Contexto
A diretoria quer ver, na prática, como cada motor se sai. O valor do MVP está na **comparação visual e empírica** entre as 3 abordagens.

### Decisão
A exibição das métricas acontece em dois momentos:

**1. Cards em tempo real (por tentativa de login)**
- Ao executar um login, o frontend mostra **um card por motor** com: tempo de resposta, score, autenticado? (sim/não), device (CPU/GPU/cloud), livenessOk.
- Cria o efeito imediato "olha como cada um se sai" para a diretoria.

**2. Dashboard final (agregado)**
- Página `/dashboard` lendo a tabela `Biometria_Logs` e exibindo:
  - Latência média (p50/p95) por motor (gráfico de barras — Recharts).
  - Taxa de sucesso/falha por motor.
  - Comparação CPU vs GPU (Motor 2).
  - Volume de tentativas.
- Dados sempre **agregados/anonimizados** (LGPD).

### Alternativas
1. Só números no console — descartado: não comunica valor para diretoria.
2. Só dashboard final — descartado: perde o impacto visual durante a demo ao vivo.

### Consequências
- **+** Impacto visual forte na apresentação; diretoria "sente" a diferença entre motores.
- **+** Dashboard agrega evidência quantitativa para discussão posterior.
- **−** Pequeno esforço extra de frontend (Recharts é simples).

---

## ADR-009 — Criptografia de embeddings em nível de aplicação (AES-256)

- **Status:** Aceita
- **Data:** 2026-07-15

### Contexto
Vetores faciais são dados biométricos sensíveis (LGPD). Se alguém acessar o banco diretamente, não pode conseguir reconstituir/roubar a biometria. Precisamos definir a estratégia de criptografia em **repouso** e **trânsito**.

### Decisão

**Em trânsito (dados viajando entre serviços)**
- Usar **HTTPS/TLS** em todos os hops (frontend↔backend, backend↔vision-service, backend↔Gemini/Azure).
- Nenhum endpoint em `http://` em ambientes não locais. O TLS cuida da criptografia automaticamente; nada manual.

**Em repouso (dados guardados no banco)**
- Criptografar em **nível de aplicação**: o **C# criptografa o embedding com AES-256** antes de enviar ao banco, usando chave guardada em local seguro (variável de ambiente ou cofre, nunca no código/repositório).
- Fluxo de cadastro: DeepFace gera embedding → C# serializa para JSON → C# criptografa (AES-256) → grava no banco.
- Fluxo de login: C# lê do banco → descriptografa → compara com embedding atual.
- A **foto bruta da face não é guardada** — só o embedding criptografado.

### Alternativas consideradas
1. **Criptografia só no nível do banco** (`pgcrypto`) — descartado como camada única: o DBA com acesso ao banco consegue ler os dados. Mantém como camada adicional (defesa em profundidade).
2. **Não criptografar** (apenas confiar no isolamento de rede) — descartado: incompatível com LGPD e bom senso.

### Consequências
- **+** Mesmo quem acessar o banco direto não consegue ler a biometria.
- **+** Atende ao princípio de segurança da LGPD.
- **−** C# precisa gerenciar a chave de criptografia com cuidado (rotação, backup seguro da chave).
- **−** Pequeno overhead de CPU no backend para cifrar/decifrar (desprezível).
