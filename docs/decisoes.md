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

- **Status:** Substituída por ADR-010
- **Data:** 2026-07-15

### Contexto
A Microsoft restringiu capacidades da Face API (princípios de IA responsável); o login facial exige aprovação de "Limited Access", que pode demorar. A equipe vai solicitar **trial de 30 dias** e preencher os formulários da Microsoft.

### Decisão (original)
- **Motor 3 será o último a ser testado** no cronograma, dado o risco da aprovação.
- Enquanto a conta não é aprovada, o Motor 3 retorna **_mock_** parametrizado por _feature flag_ (`AZURE_USE_MOCK=true`).
- Assim que aprovado, basta desligar a flag para integrar de verdade.

### Motivo da substituição
Após reunião com a equipe, decidiu-se **concentrar a stack no ecossistema Google** (ver ADR-010). O Azure foi removido do escopo.

### Alternativas
1. Esperar a aprovação antes de começar — descartado (bloqueia o cronograma).
2. Usar AWS Rekognition — alternativa válida, registrar como ADR se migrarmos.

### Consequências (históricas)
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
- Usar **HTTPS/TLS** em todos os hops (frontend↔backend, backend↔vision-service, backend↔Gemini).
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

---

## ADR-010 — Migrar para o ecossistema Google; remover Azure e reduzir para 2 motores

- **Status:** Aceita
- **Data:** 2026-07-15
- **Substitui:** ADR-007

### Contexto
Após reunião com a equipe, decidiu-se que a stack deve ser concentrada **exclusivamente no ecossistema Google**. Isso implica remover o Motor 3 (Azure Face API) e quaisquer soluções baseadas em GPT/AWS. O sistema fica então com **2 motores** de reconhecimento facial.

Pesquisa confirmou que **o Google não oferece um serviço gerenciado equivalente ao Azure Face API**. O Google Cloud Vision API faz apenas _detecção_ de rostos (atributos, emoções, marcos), mas **explicitamente não suporta reconhecimento/verificação facial 1:1 ou 1:N** (fonte: [documentação oficial](https://docs.cloud.google.com/vision/docs/detecting-faces) — "Specific individual Facial Recognition is not supported").

### Decisão
1. **Remover o Motor 3 (Azure)** e todo o código/configuração/mock associado.
2. O projeto passa a ter **2 motores**:
   - **Motor 1:** IA Generativa (Gemini) — demo de falha (mantido, ADR-002).
   - **Motor 2:** Visão computacional local (DeepFace + OpenCV) — CPU vs GPU (mantido).
3. **A ausência de um Motor 3 cloud vira um ponto de aprendizado** na apresentação executiva (narrativa do "buraco do Google"): explicar que o ecossistema Google não tem biometria facial gerenciada por princípios de IA responsável, e por isso a visão local (Motor 2) é o caminho viável no Google.
4. Extração de documentos continua com **Gemini 2.0 Flash** (ADR-005), já é Google.

### Alternativas consideradas (e por que descartadas)
1. **Hospedar Facenet/ArcFace no Vertex AI como "Motor 3 cloud"** — descartado: usa o mesmo modelo do Motor 2, só mudando o local de execução; a comparação viraria "mesmo algoritmo, local vs nuvem", não traz aprendizado novo. Consome tempo precioso do cronograma de 5 dias.
2. **Usar Gemini para comparação facial 1:1 como Motor 3** — descartado: redundante com o Motor 1 (mesma lição: IA generativa não serve para biometria), só que em modo matching em vez de liveness.
3. **Manter 3 motores com outro provedor (AWS Rekognition)** — descartado pela decisão de ficar só no ecossistema Google.

### Consequências
- **+** Stack 100% Google; alinhado com a decisão da equipe.
- **+** Menos complexidade (sem Azure, sem _mock_, sem _feature flags_ de aprovação).
- **+** Cronograma de 5 dias mais factível.
- **+** Narrativa do "buraco do Google" vira diferencial educativo na apresentação.
- **−** Comparativo passa de 3 para 2 motores.
- **−** Perde-se a demonstração de um serviço cloud enterprise de biometria.

---

## ADR-011 — SGBD MySQL com EF Core (Pomelo) em vez de Postgres

- **Status:** Aceita
- **Data:** 2026-07-15

### Contexto
O documento original sugeria Postgres (por causa do `pgcrypto`) e Entity Framework. Em revisão, a equipe definiu usar **MySQL** (já disponível na VPS) e confirmou **EF Core** como ORM.

### Decisão
1. **SGBD:** MySQL (8.0+).
2. **ORM:** Entity Framework Core com **Pomelo Provider** (`Pomelo.EntityFrameworkCore.MySql`).
3. **Criptografia de embeddings** continua em **nível de aplicação** (AES-256 no C# — ADR-009), não depende de extensão do banco. MySQL oferece `AES_ENCRYPT`/`AES_DECRYPT` como camada adicional opcional, mas não substitui a camada de aplicação.

### Alternativas consideradas
1. **Postgres com pgcrypto** — descartado pela preferência/experiência da equipe com MySQL.
2. **Prisma** — descartado: Prisma é exclusivo de Node.js/TypeScript; não há client para C# .NET. Adotar Prisma exigiria trocar o backend para Node, conflitando com o ADR-003.
3. **Dapper (micro-ORM)** — viável para quem prefere SQL manual, mas EF Core reduz boilerplate e é o padrão do .NET.

### Consequências
- **+** Alinhado com a stack da equipe/VPS.
- **+** EF Core + Pomelo é maturamente suportado e produtivo.
- **+** Criptografia independe do SGBD (camada de aplicação).
- **−** MySQL tem diferenças pequenas em tipos JSON e funções em relação ao Postgres.
- **−** `pgcrypto` deixa de estar disponível como camada adicional (mitigado pela camada de aplicação).

---

## ADR-012 — Stack .NET 9 + Pomelo 9.0.0 estável; `schema.sql` como fonte de verdade

- **Status:** Aceita
- **Data:** 2026-07-18

### Contexto
Ao subir o backend pela primeira vez contra o MySQL da VPS (banco já criado via `backend/Data/schema.sql`), detectamos dois bloqueios técnicos:
1. O SDK instalado na máquina de desenvolvimento é o **.NET SDK 9.0.x**; o `backend.csproj` estava targetando `net10.0`, impedindo o build (`NETSDK1045`).
2. O provider Pomelo estava fixado em `9.0.0-preview.1`, que **não implementa** membros da interface adicionados no EF Core 9 RTM (`LockReleaseBehavior`), quebrando em runtime com `TypeLoadException`.

Adicionalmente, o `schema.sql` já havia sido executado manualmente no MySQL da VPS, criando as 4 tabelas no padrão definido no `AGENTS.md` (tabelas PascalCase/`_`, colunas em `camelCase`). Isso torna a primeira migration EF um tanto redundante — e, se gerada sem cuidado, pode divergir do `schema.sql`.

### Decisão
1. **Target framework:** `.NET 9` (`net9.0`) até que o SDK 10 esteja instalado e o Pomelo valide compatibilidade.
2. **Versões de pacotes (todas estáveis):**
   - `Pomelo.EntityFrameworkCore.MySql` **9.0.0**
   - `Microsoft.EntityFrameworkCore` (+ `.Design`) **9.0.0**
   - `Microsoft.AspNetCore.OpenApi` **9.0.0**
3. **`schema.sql` como fonte de verdade** do schema do banco para o MVP. O EF Core não cria/migra tabelas automaticamente; ele apenas mapeia as entidades às tabelas existentes.
4. **Migrations EF desativadas no startup** (sem `db.Database.Migrate()` no `Program.cs`). Evoluções de schema para o MVP serão feitas editando o `schema.sql` (idempotente).
5. **Convenção de naming em runtime**: usar o pacote `EFCore.NamingConventions` com `UseCamelCaseNamingConvention()` para que o EF gere nomes de colunas em `camelCase` (alinhado ao `AGENTS.md`), mantendo os nomes de tabelas explícitos por `DbSet` (`Usuarios`, `Vetores_Faciais`, `Biometria_Logs`, `Termos_Consentimento`).

### Alternativas consideradas
1. **Subir para .NET 10 agora** — descartado: exigiria instalar SDK 10 + validar compatibilidade do Pomelo, atrasando o MVP sem ganho real.
2. **Manter Pomelo `9.0.0-preview.1`** — descartado: quebra em runtime (`TypeLoadException`).
3. **Usar EF migrations como fonte de verdade** (gerar `Inicial` e deprecurar o `schema.sql`) — viável, mas adiciona complexidade e um segundo local de definição de schema para um MVP de 4 tabelas. Reconsiderar se o schema crescer.
4. **Renomear colunas do `schema.sql` para PascalCase** (alinhamento default do EF) — descartado: quebra a convenção documentada no `AGENTS.md` (colunas em `camelCase`).
5. **Configurar `camelCase` via Fluent API manual (`HasColumnName`)** — descartado: verboso e repetitivo para 4 entidades; o pacote `EFCore.NamingConventions` resolve em 1 linha.

### Consequências
- **+** Build e runtime estáveis contra o MySQL da VPS.
- **+** Fonte de schema única (`schema.sql`), simples de revisar/aplicar via Workbench.
- **+** Mapeamento `camelCase` automático, alinhado ao `AGENTS.md`.
- **−** Mudanças de schema exigem editar o `schema.sql` **e** validar se o modelo C# continua espelhando as tabelas (disciplina do time).
- **−** Pacote extra `EFCore.NamingConventions` (minúsculo, maduro, amplamente usado).
- **−** Quando/quando o schema crescer muito, reconsiderar adoção de EF migrations como fonte de verdade (novo ADR substituindo este item 3–4).

---

## ADR-013 — Modelo Gemini 3.5 Flash; Motor 1 como "explicador" do Motor 2 (não só demo)

- **Status:** Aceita
- **Data:** 2026-07-18

### Contexto
Ao subir a integração com o Gemini (Passo 3 do MVP), descobriu-se que **`gemini-2.0-flash` foi descontinuado para novas chaves do free tier** do Google AI Studio. A chamada devolve `429 RESOURCE_EXHAUSTED` (mesmo com billing em "Free tier") para os modelos 2.x. Os modelos disponíveis no free tier passaram a ser apenas os da série 3.x.

Testes empíricos confirmaram que `gemini-3.5-flash` funciona corretamente no free tier com a chave do projeto. O modelo mantém suporte a:
- `responseMimeType = application/json` (saída JSON estrita)
- `inline_data` (entrada multimodal — imagens base64)
- Capacidade de análise facial, ICAO e liveness conforme descrição do AI Studio.

Adicionalmente, ao testar o Motor 1 com imagens reais, observou-se que o Gemini tem capacidade real de **explicar** uma decisão biométrica em linguagem natural — capacidade que o Motor 2 (DeepFace) não possui (apenas devolve um score numérico). O protótipo do "Laudo Técnico" (ADR-014) reforça esse papel.

### Decisão
1. **Modelo Gemini**: usar `gemini-3.5-flash` em produção e desenvolvimento (não mais `gemini-2.0-flash`).
2. **Papel duplo do Motor 1 (Gemini)**:
   - **(a) Demo comparativa** (conforme ADR-002 original): mostra por que LLM não serve para decidir biometria 1:1.
   - **(b) Explicador para o Laudo Técnico** (ADR-014): após o Motor 2 decidir, o Motor 1 gera o parecer textual forense com base nas 2 fotos, explicando a decisão numérica.
3. **Limitação de GPU no Windows com TensorFlow ≥ 2.11**: o vision-service Python roda em CPU no Windows. Para usar GPU NVIDIA, exige WSL2 ou `tensorflow-directml-plugin`. Mantém-se em CPU para o MVP (latência 270ms no Facenet é aceitável); ADR futuro pode revisar.
4. **`tf-keras` como dependência obrigatória** no `vision-service/requirements.txt`: Keras 3 (default no TF ≥ 2.16) quebra o DeepFace/RetinaFace; o pacote `tf-keras` restaura a API Keras 2 esperada.

### Alternativas consideradas
1. **Voltar para TF 2.18** para ter GPU no Windows — descartado: TF ≥ 2.11 **nunca** suportou GPU nativa no Windows (problema estrutural, não de versão).
2. **Migrar vision-service para PyTorch** (que tem CUDA no Windows) — descartado por enquanto: DeepFace é TF-first; trocar implica reescrever pipeline de embeddings.
3. **Usar `gemini-2.5-flash`** — descartado: também descontinuado no free tier.
4. **Cancelar o Motor 1** (deixar só DeepFace) — descartado: o Motor 1 agora tem papel de **explicador** no Laudo Técnico (ADR-014), agregando valor ao MVP.

### Consequências
- **+** Motor 1 deixa de ser "só demo" e passa a compor o Laudo Técnico (diferencial da apresentação).
- **+** Modelo 3.5 Flash é mais barato e rápido que os 2.x.
- **+** Latência CPU do Motor 2 (270ms) é viável para o MVP.
- **−** Para escalar em GPU, será preciso migrar para WSL2/Linux (decisão futura).
- **−** Dependência de `tf-keras` para manter compatibilidade com DeepFace (a acompanhar nas próximas versões).

---

## ADR-014 — Laudo Técnico Biométrico (relatório de cada verificação facial)

- **Status:** Aceita
- **Data:** 2026-07-18

### Contexto
O protótipo do produto traz um artefato chamado **Laudo Técnico Biométrico** que é exibido após cada verificação facial. Ele apresenta, de forma estruturada e legível para leigos:

1. **Score de similaridade** (0–100%) com rótulo (`AUTENTICADO` / `INCONCLUSIVO` / `REJEITADO`).
2. **Parecer biométrico** (texto corrido explicando a decisão).
3. **Pontos de verificação anatômica** (lista com: distância interocular, nariz, sobrancelhas, lábios, mandíbula) — cada um marcado como `Igual` / `Diferente` / `Inconclusivo`.
4. **Auditoria de Vivacidade (Liveness Check)** (texto explicando se a imagem é live, foto de tela, foto impressa, máscara etc.).

Esse laudo atende requisitos reais de auditoria e justificativa (para diretoria/forense), e diferencia o produto de sistemas que só devolvem "match/no-match".

### Decisão
1. **Adotar o Laudo Técnico como artefato oficial do produto**, gerado em cada verificação facial.
2. **Composição híbrida dos 2 motores**:
   - **Motor 2 (DeepFace)**: fornece o **score numérico** (`similaridade_cosseno`) e o **liveness** (`liveness.py` via movimento entre frames). Decisão (autenticado/inconclusivo/rejeitado) deriva do threshold (ADR-004).
   - **Motor 1 (Gemini 3.5 Flash)**: fornece o **parecer textual**, os **pontos anatômicos** e a **auditoria de liveness descritiva**.
3. **Persistência**: o laudo é materializado sob demanda a partir dos dados já gravados em `Biometria_Logs` (`motor`, `score`, `livenessOk`, `device`, `latenciaMs`, `criadoEm`, `usuarioId`) **mais** os campos textuais gerados pelo Gemini e guardados em uma coluna JSON adicional (`parecerJson`).
4. **Schema adicional** (próxima evolução do `schema.sql`):
   ```sql
   ALTER TABLE Biometria_Logs
     ADD COLUMN parecerTexto TEXT NULL,
     ADD COLUMN parecerJson JSON NULL,
     ADD COLUMN pontosAnatomicosJson JSON NULL;
   ```
5. **Endpoint de consulta**: `GET /api/biometria/laudo/{logId}` devolve o JSON estruturado. Front-end converte para layout estilo "laudo paper" (a definir no Passo frontend).
6. **Idioma**: Português Brasil em todos os textos do laudo (incluindo saídas do Gemini).

### Alternativas consideradas
1. **Usar só o score numérico** (sem laudo textual) — descartado: perde o diferencial de auditoria e explicabilidade.
2. **Usar só o Gemini para tudo** (score + parecer) — descartado: conflita com ADR-002/ADR-004 (sem score calibrável, não determinístico).
3. **Gerar laudo como PDF server-side** — postergado: para o MVP, JSON + renderização no front-end é suficiente. PDF pode virar fluxo futuro.
4. **Guardar fotos analisadas** para o Gemini re-analisar no laudo — **descartado**: viola ADR-009 e LGPD (não persistir fotos brutas). O laudo é gerado **no momento da verificação**, com as fotos em memória; só persistimos o texto.

### Consequências
- **+** Produto com diferencial claro de auditabilidade e explicabilidade.
- **+** Aproveita os 2 motores de forma complementar (decisão numérica + explicação textual).
- **+** Material para apresentação executiva fica mais rico (parecer é "foto do producto").
- **−** Latência extra: cada verificação passa a chamar 2 serviços (DeepFace + Gemini para laudo). Mitigação: chamar o Gemini em background após a resposta do DeepFace (`Task.Run` + gravar `parecerJson` posteriormente).
- **−** Schema do `Biometria_Logs` cresce (3 colunas novas) — aceitável dado o valor de auditoria.
- **−** Custo de tokens Gemini por verificação (~800 tokens por laudo) — dentro do free tier para volume de MVP.

### Exemplo de saída (referência do protótipo)

Estrutura visual que o front-end deve reproduzir e que o `parecerJson` precisa materializar:

```
Laudo Técnico Biométrico
────────────────────────
Similaridade: 85%
Decisão:      ANÁLISE INCONCLUSIVA (RE-VALIDAR)

[Parecer Biométrico]
A análise comparativa entre as duas imagens revela forte compatibilidade
morfologica nos principais pontos de referência facial (sobrancelhas,
estrutura nasal, lábios, padrão de cabelo). No entanto, a Imagem 2 é
categoricamente uma recaptura de tela (foto de uma tela de celular), o
que compromete severamente a qualidade da imagem, introduzindo reflexos,
distorções cromaticas e perda total de detalhes de textura de pele.
Embora os traços fisionômicos apontem para a mesma pessoa, o processo
forense de comparação fica prejudicado pela violação das regras de
vivacidade. Por isto, a decisão é classificada como inconclusiva.

[Pontos de Verificação Anatômica]
- Distância Interocular .......... Igual     (proporção e posição orbital congruentes)
- Estrutura do Nariz ............. Igual     (base nasal larga, dorso compatível)
- Arco das Sobrancelhas .......... Igual     (espessura, curvatura arqueada)
- Formato dos Lábios ............. Igual     (lábio inferior proeminente)
- Linha do Maxilar e Barba ....... Igual     (padrão de crescimento igual)

[Auditoria de Vivacidade (Liveness Check)]
Imagem 1: captura legitima e de alta qualidade.
Imagem 2: falha grave no liveness — trata-se de foto de tela de smartphone
         (re-presentation attack), evidenciada por bordas do aparelho,
         dedos segurando o celular e forte reflexo luminoso central.
```

Observações importantes derivadas do protótipo:

1. **Rótulo de decisão composto**: o laudo não traz só `AUTENTICADO/REJEITADO`, mas também a **ação recomendada** — ex.: `ANÁLISE INCONCLUSIVA (RE-VALIDAR)`. A coluna `resultado` (já existente em `Biometria_Logs`) continua armazenando o código canônico (`AUTENTICADO`, `INCONCLUSIVO`, `REJEITADO`); o parêntese com a ação faz parte do `parecerJson`.
2. **Liveness é determinante para a decisão**: mesmo com score alto (85%), a falha de liveness **força** resultado `INCONCLUSIVO`. Regra de negócio: `livenessOk = false` => resultado != `AUTENTICADO` (reforço de ADR-006/LGPD).
3. **Tipos de ataque que o Gemini deve identificar no parecer**: re-presentation attack (foto de tela), foto impressa, máscara, deepfake. O `liveness.py` (Motor 2) cobre movimento entre frames; o Gemini complementa com análise descritiva (não decisão).
4. **5 pontos anatômicos canônicos** (a serem devolvidos pelo Gemini no `pontosAnatomicosJson`):
   - `distanciaInterocular`
   - `estruturaNasal`
   - `arcoSobrancelhas`
   - `formatoLabios`
   - `linhaMaxilarBarba`

   Cada um com `status` (`Igual` | `Diferente` | `Inconclusivo`) e `observacao` (texto curto).

---

## ADR-015 — `enforce_detection` distinto entre cadastro e login

**Status:** Aceita (2026-07-19)

### Contexto
Durante os testes do fluxo de cadastro facial (ADR-009), descobriu-se que o `DeepFace.represent()` em [vision-service/main.py](../vision-service/main.py) estava sendo chamado com `enforce_detection=False`. Isso faz o DeepFace, quando não encontra rosto na imagem, **gerar um embedding de "ruído"** a partir da imagem inteira (como se fosse uma thumbprint visual) em vez de falhar.

Impacto medido em teste: ao cadastrar uma **imagem cinza 200x200** sem nenhum rosto, o vision-service devolveu um embedding 128-dim legítimo — foi possível até fazer login comparando o mesmo ruído, com `score=1.0`. Situação inaceitável para biometria: cadastra lixo, autentica lixo.

### Decisão
Adotar estratégia **híbrida**:

- **`POST /embeddings`** (cadastro): `enforce_detection=True`. Se a OpenCV não detectar rosto, o vision-service devolve **`422 SEM_ROSTO`** (código consistente com `docs/api.md`). Cadastro fica estrito: nada de vetor de ruído.
- **`POST /verificar`** (login): `enforce_detection=False`. Mantém permissivo para não quebrar sessões legítimas em condições adversas (ângulo, iluminação, óculos novos). O backend já aplica a regra do ADR-014 (`livenessOk=false` ⇒ nunca `AUTENTICADO`), que cobre o risco de foto sem rosto no login.

### Alternativas consideradas

1. **`enforce_detection=True` em ambos os endpoints** — mais seguro, mas risco de **falsos negativos no login** em fotos reais com ângulos/condições adversas. Agra os usuários legítimos. Rejeitada por enquanto; pode voltar a debate se métricas mostrarem ataque via login.
2. **Manter `False` + filtro de confiança da detecção** — adicionar camada que valida se o detector facial retornou confiança razoável antes de aceitar o embedding. Mais complexo e o DeepFace não expõe facilmente esse score na API `represent`. Rejeitada por complexidade.
3. **Manter `False` como hoje** — aceitar o risco. Rejeitada: cadastro é a porta de entrada, não pode ter falso positivo estrutural.

### Consequências
- **+** Cadastro facial não aceita mais imagens sem rosto (fecha porta de entrada de lixo).
- **+** Login continua tolerante a variações legítimas (alinhado com experiência de usuário).
- **+** Erro `422 SEM_ROSTO` já estava previsto no `docs/api.md` e tratado pelo `BiometriaController.Cadastrar`.
- **−** Possível frustração do usuário se a foto de cadastro tiver qualidade muito ruim (solução: orientação de captura no front via overlay facial).
- **−** Decisão assimétrica (cadastro estrito, login permissivo) requer documentação clara para futuros mantenedores — suprida por este ADR.

### Implementação
- [vision-service/main.py](../vision-service/main.py): `/embeddings` com `enforce_detection=True`; captura `ValueError` "face could not be detected" e converte para `HTTPException(422, "SEM_ROSTO")`.
- `/verificar` permanece com `enforce_detection=False` (sem alteração).

### Revisão futura
Reabrir o debate se:
- Métricas de `Biometria_Logs` mostrarem tentativas de login com fotos sem rosto que passaram no `score >= limiar` (ataque via login).
- Frontend começar a usar modelo de overlay facial que garanta rosto na captura — aí `enforce=True` no login passa a ser viável sem perda de UX.

---

## ADR-016 — Verificação comparativa (Motor 1 + Motor 2 em paralelo no login)

**Status:** **Substituída por ADR-017** (2026-07-19). A implementação original exigia 2 fotos (referência + atual), o que confundia o usuário e tornava o fluxo inviável para demo de login real. ADR-017 reformula para 1 foto só, separando claramente os papéis (M1=liveness, M2=identidade).

### Contexto
Durante o MVP, usuários (demo/diretoria) querem ver, na mesma tentativa de login, a diferença de resposta entre o **Motor 1 (Gemini 3.5 Flash — comparador multimodal)** e o **Motor 2 (DeepFace/Facenet — comparador determinístico)**. O objetivo é materializar empiricamente o argumento do ADR-002 (LLM não serve para biometria 1:1) e do ADR-013 (Motor 1 só vale como "explicador" do Motor 2).

Limitação técnica: o Motor 1 compara **2 imagens**, enquanto o Motor 2 compara **1 imagem vs. vetor facial cadastrado (cifrado)**. O ADR-009 veta persistir fotos brutas — então não temos a foto de referência guardada para alimentar o Motor 1.

### Decisão
Criar um endpoint novo `POST /api/biometria/verificar-comparativo` que recebe **3 entradas** (sem auth):
- `cpf` (string) — localiza o usuário e os vetores cifrados (Motor 2);
- `fotoReferencia` (IFormFile) — foto do rosto do mesmo usuário (para o Motor 1);
- `fotoAtual` (IFormFile) — selfie do momento da tentativa de login.

O backend roda os 2 motores **em paralelo** (`Task.WhenAll`) e devolve os 2 resultados num único payload:

```json
{
  "usuarioId": 11,
  "nome": "...",
  "motor1": { "similaridadePct": 95.0, "confianca": "alta", "liveness": { ... }, "latenciaMs": 1834, "justificativa": "..." },
  "motor2": { "score": 0.7821, "limiar": 0.60, "autenticado": true, "livenessOk": true, "latenciaMs": 144, "device": "cpu", "logId": 42 },
  "concordancia": true
}
```

`concordancia` indica se ambos os motores chegaram à mesma conclusão (ambos aprovam ou ambos rejeitam), útil para destaque visual na UI.

**Nenhuma foto é persistida** (ADR-009). Apenas o log do Motor 2 é gravado em `Biometria_Logs` (já que Motor 1 é demo/explicador — ADR-013).

### Alternativas consideradas
1. **Persistir foto de referência no cadastro** — descartado: viola ADR-009 (fotos brutas não persistidas) e exigiria novo ADR substituindo-o.
2. **Reusar a foto de cadastro via cache volátil no backend** — descartado: adiciona estado em memória, complexidade de TTL e risco de vazar foto bruta em dump.
3. **Não oferecer comparação no login; só no Laudo posterior** — descartado pela stakeholder: a demonstração ao vivo é o propósito do MVP.
4. **Chamar `/verificar` + `/gemini/comparar` em paralelo do frontend** — funciona, mas espalha lógica de orquestração no cliente e impede calcular `concordancia` atomicamente.

### Consequências
- **+** UX: usuário vê lado a lado, na mesma tela, a diferença entre LLM e determinístico.
- **+** Mantém ADR-009 intacto (fotos só trafegam, não persistem).
- **+** `concordancia` vira métrica valiosa para dashboard futura (inter-rater agreement entre motores).
- **−** Custa 2x banda no login comparativo (2 fotos).
- **−** Latência total = max(M1, M2) ≈ Motor 1 (~2-4s) — Gemini é mais lento que DeepFace (~150ms).
- **−** Exige do usuário 2 uploads no modo comparativo (referência + atual).

### Implementação
- `BiometriaController.VerificarComparativo` (novo action) com `[AllowAnonymous]` e `multipart/form-data`.
- Reusa `PythonVisionService.VerificarAsync` (Motor 2) e `Motor1GeminiService.CompararAsync` (Motor 1).
- Só grava log do Motor 2 (consistente com ADR-013: Motor 1 é explicador).
- `docs/api.md` documenta o novo endpoint.
- Frontend `/login` ganha 3ª opção de motor "Comparar ambos (M1+M2)" com 2 uploads e tela de resultado comparativa.

### Revisão futura
Reabrir o debate se:
- O custo de Gemini 3.5 Flash por chamada se tornar proibitivo em volume de demo.
- A persistência de fotos brutas vier a ser reavaliada (novo ADR substituindo ADR-009).

---

## ADR-017 — Verificação comparativa com 1 foto (substitui ADR-016)

**Status:** Aceita (2026-07-19)

### Contexto
A implementação do ADR-016 obrigava o usuário a enviar **2 fotos** no modo comparativo (referência + atual). Em testes reais isso se mostrou confuso e contraproducente:
- O usuário esperava enviar **1 selfie** e ver os 2 motores responderem.
- Não ficava claro que a "referência" deveria ser uma foto do cadastro — o usuário mandava qualquer foto.
- O Motor 1 (Gemini) fazia **comparação de identidade** sobre 2 imagens diretas, mas o Motor 2 já faz isso melhor com vetores — sobreposição inútil de responsabilidade.

**Insight adicional:** o Motor 1 (Gemini) é muito melhor em **liveness** (detectar foto de foto, tela, máscara) do que em **identidade 1:1** (sem score calibrável, ADR-002). Já o Motor 2 (DeepFace) é determinístico em identidade mas **não detecta spoofing** — uma foto de celular mostrada na webcam passa com score alto porque a geometria bate.

### Decisão
**Refatorar `/api/biometria/verificar-comparativo` para receber 1 foto só** (`foto` + `cpf` + `limiar?`) e dividir responsabilidades:

| Motor | Papel no comparativo | Método |
|---|---|---|
| Motor 1 (Gemini) | **Liveness + ICAO + Qualidade** | `AnalisarLivenessAsync(foto)` — novo método, prompt dedicado, 1 imagem |
| Motor 2 (DeepFace) | **Identidade 1:1** | `VerificarAsync(foto, vetoresCadastrados, limiar)` — sem mudança |

**Veto anti-spoofing (ADR-014 estendido):** se Motor 1 classificar a foto como `printed_photo`, `screen_replay` ou `mask`, o backend **vetoa automaticamente** o Motor 2 mesmo que `score >= limiar`. Sem isso, o DeepFace aprovaria uma foto de celular mostrada na webcam — exatamente o bug que motivou este ADR.

`autenticado` no payload final = `m2.autenticado && !vetoM1`. JWT só é emitido se `autenticado=true`.

### Payload

```
POST /api/biometria/verificar-comparativo
multipart/form-data:
  - foto: IFormFile (1 imagem)
  - cpf: string
  - limiar?: string (decimal, opcional)
```

Resposta (resumida):
```json
{
  "motor1": { "papel": "liveness", "liveness": { "classificacao": "live" }, "qualidade": { "score": 78 } },
  "motor2": { "papel": "identidade", "score": 0.81, "limiar": 0.60, "autenticado": true, "vetoSpoofing": false },
  "concordancia": true
}
```

### Alternativas consideradas
1. **Persistir foto de referência cifrada no cadastro** — descartado: viola ADR-009 e abre superfície de vazamento (mesmo cifrada, a foto bruta existe em disco).
2. **Adicionar liveness detection ao DeepFace (Motor 2)** — descartado: exigiria modelo anti-spoofing adicional (Silent-Face-Anti-Spoofing, MiniFASNet) e GPU. Mais barato reaproveitar o Gemini que já está no pipeline.
3. **Manter comparação de identidade no Gemini (ADR-016)** — descartado: LLM não devolve score calibrável; não há como aplicar veto automático sem critério objetivo.

### Consequências
- **+** UX alinhada com expectativa: usuário envia 1 selfie e vê os 2 motores responderem.
- **+** Veto anti-spoofing fecha o buraco da foto de foto (DeepFace aprovar por geometria).
- **+** Cada motor fica com sua especialidade: Gemini no que é bom (semântica visual), DeepFace no que é bom (geometria determinística).
- **+** Latência total = `max(M1, M2)` ≈ Gemini (~2-4s). DeepFace (~150ms) fica "de brinde".
- **−** Motor 1 deixa de mostrar `similaridadeFacial` no comparativo — mas isso era número não calibrável e confuso.
- **−** Se o Gemini classificar erroneamente como `printed_photo` um rosto verdadeiro (falso positivo de spoofing), o usuário legítimo é barrado. Mitigação: prompt com `indeterminado` quando inseguro (não vetoa).

### Implementação
- `Motor1GeminiService.AnalisarLivenessAsync` (novo) — prompt dedicado para 1 foto.
- `BiometriaController.VerificarComparativo` reformulado: 1 foto, veto M1→M2, loga `VETO_M1_SPOOFING:{classe}` no campo `Erro` quando vetoado.
- `frontend/src/app/login/page.tsx` unificado: 1 `CameraCapture` serve para qualquer modo (motor 1, 2 ou comparativo).
- `ResultadoComparativo` mostra papéis distintos ("LIVE / SUSPEITO" no M1, "AUTÊNTICO / REJEITADO" no M2) e badge de veto quando aplicável.

### Revisão futura
Reabrir o debate se:
- Falsos positivos de spoofing do Gemini se tornarem frequente (rebaixar para `indeterminado` classes adicionais).
- Surgir modelo de liveness on-prem leve (Silent-Face-Anti-Spoofing) que dispense o Gemini para essa tarefa.

---

## ADR-018 — Motor 1 volta a comparar identidade (persistência cifrada de foto de referência)

**Status:** Aceita (2026-07-19). Substitui parcialmente o ADR-009.

### Contexto
O ADR-017 designou o Motor 1 apenas como detector de liveness no modo comparativo, sob o argumento de que o LLM não tem score calibrável para identidade. No entanto, o usuário do MVP quis ver **ambos os motores comparando identidade** lado a lado no mesmo payload, para validar empiricamente a tese do ADR-002 (LLM não serve para biometria 1:1).

Para o Motor 1 comparar identidade, é preciso uma **foto de referência**. O ADR-009 veta persistir fotos brutas. As alternativas eram:
1. Reativar ADR-016 (2 fotos no login) — descartado: UX confusa já descartada pelo usuário.
2. **Abrir exceção ao ADR-009** para persistir **apenas** a foto de referência do Motor 1, **cifrada com AES-256-GCM** (mesma cifra dos vetores faciais). É a opção escolhida.

### Decisão
1. **Criar tabela `Fotos_Referencia`** com 1 linha por usuário (unique index), guardando a foto **cifrada** (`AES-256-GCM`, mesmo `AES_EMBEDDING_KEY`) da primeira foto frontal do cadastro.
2. **No `Cadastrar`**: além de criar vetores, persistir/atualizar a `FotoReferencia` do usuário.
3. **No `VerificarComparativo`**: decifrar a foto em memória e chamar `Motor1.CompararAsync(fotoReferencia, fotoAtual)` — Motor 1 agora devolve **similaridade + liveness + ICAO** completos.
4. **Fallback**: se o usuário for anterior ao ADR-018 (não tem foto de referência), Motor 1 faz apenas liveness (`AnalisarLivenessAsync`), com `papel="liveness"`. Usuários novos ficam com `papel="comparacao+liveness"`.
5. **Veto anti-spoofing mantido** (ADR-014 estendido): `screen_replay`/`printed_photo`/`mask` continua vetoando o Motor 2.
6. **Endpoint `/health/migrate`** criado para aplicar `schema.sql` (incluindo a nova tabela) de forma idempotente.

### Por que cifrar a foto de referência
- **Mesma chave** dos vetores (`AES_EMBEDDING_KEY`, 32 bytes): sem nova superfície de keys.
- AES-256-GCM dá **confidencialidade + integridade**: se o DB for vazado, as fotos continuam ilegíveis sem a chave.
- Em memória, a foto decifrada só existe durante o `/verificar-comparativo` (nunca é logada, nunca é devolvida na API).

### Consequências
- **+** Motor 1 volta a mostrar `similaridadeFacial` (0-100%) no comparativo — objetivo central do usuário.
- **+** Tabela de comparação volta a ter 2 scores para comparar (LLM vs DeepFace).
- **+** Mantém veto anti-spoofing que fecha o buraco da "foto de celular".
- **−** **Violação parcial do ADR-009**: agora persistimos 1 foto (cifrada) por usuário. LGPD: dado sensível em repouso, mas protegido por criptografia forte e removível via `DELETE /api/biometria/vetores`.
- **−** Storage: ~100KB-1MB por usuário (foto JPEG cifrada) vs 1KB dos vetores. Aceitável para MVP.
- **−** Usuários cadastrados antes desta mudança não terão foto de referência; Motor 1 cai no fallback de liveness-only.

### Implementação
- `backend/Data/AppDbContext.cs`: entidade `FotoReferencia` + mapeamento `Fotos_Referencia`.
- `backend/Data/schema.sql`: novo bloco `CREATE TABLE IF NOT EXISTS Fotos_Referencia`.
- `backend/Services/CriptografiaService.cs`: overloads `CriptografarBytes` / `DescriptografarBytes` (para foto, não UTF-8).
- `backend/Controllers/BiometriaController.cs`:
  - `Cadastrar`: persiste/atualiza foto de referência após gravar vetores.
  - `RemoverVetores`: também remove `Fotos_Referencia` (LGPD).
  - `VerificarComparativo`: decifra foto de ref, chama `Motor1.CompararAsync` quando existir; fallback para `AnalisarLivenessAsync` caso contrário.
- `backend/Controllers/HealthController.cs`: novo `POST /health/migrate` idempotente.
- `frontend/src/lib/api.ts`: `VerificarComparativoResponse.motor1` volta a ter `similaridadePct?` e `confianca?`.
- `frontend/src/app/login/page.tsx`: card do Motor 1 volta a mostrar Similaridade + Limiar + Confiança (condicional, se existir).

### Revisão futura
Reabrir o debate se:
- Volume de storage se tornar problema (considerar downsizing para 256x256 JPEG antes de cifrar).
- Surgir modelo LLM on-prem equivalente (Llama-Vision, Qwen-VL) que dispense Gemini e reduza custo por chamada.
- Decisão de cifrar a foto precisar ser auditada por DPO (LGPD): eventuais ajustes no termo de consentimento.

