# Diretrizes para Agentes de IA

> Este é o documento **obrigatório** que todo agente de IA (Claude, GPT, Cursor, Copilot etc.) deve ler **antes** de propor ou realizar qualquer alteração neste projeto. Ele define regras de comportamento, fluxos obrigatórios e onde encontrar cada informação.

## 1. Princípio número 1 — Decisões devem ser registradas

**Nenhuma decisão técnica ou de produto pode ser aplicada sem antes registrá-la com o motivo.**

- Toda decisão (escolha de biblioteca, arquitetura, padrão, troca de motor, etc.) deve gerar uma entrada em [docs/decisoes.md](./docs/decisoes.md) seguindo o formato ADR:
  - **Contexto** — por que precisamos decidir.
  - **Decisão** — o que foi decidido.
  - **Alternativas consideradas** — quais opções foram descartadas e por quê.
  - **Consequências** — impactos (positivos e negativos).
  - **Status** — `Proposta` | `Aceita` | `Em debate` | `Depreciada` | `Substituída por ADR-XX`.
- O agente **sugere** o ADR; a decisão final é do humano.
- Se uma decisão mudar, **não reescreva** o ADR antigo. Crie um novo ADR que substitui o anterior e marque o antigo como `Substituída por ADR-XX`.

## 2. Princípio número 2 — Tudo que é criado deve ser documentado

- Antes de criar uma feature, endpoint, tabela, serviço ou componente, o agente deve:
  1. Verificar se já existe documentação correspondente em `/docs`.
  2. Atualizar (ou propor) a documentação relevante **junto** com o código.
- Arquivos criados devem ter comentário de cabeçalho curto explicando sua responsabilidade (1–3 linhas).
- **Nunca** criar arquivos redundantes. Se a informação já vive em `docs/X.md`, referencie em vez de duplicar.

## 3. Princípio número 3 — Idioma e comunicação

- Todo conteúdo (código, comentários, docs, commits) deve estar em **Português do Brasil**, exceto termos técnicos consagrados em inglês (ex.: _embedding_, _liveness_, _threshold_).
- Respostas do agente ao usuário também em Português do Brasil.

## 4. Ordem de leitura obrigatória (mapa da documentação)

Antes de agir, leia nesta ordem:

1. [README.md](./README.md) — visão geral do projeto.
2. [docs/decisoes.md](./docs/decisoes.md) — **ADRs vigentes**; o que está decidido e o que está em debate.
3. [docs/arquitetura.md](./docs/arquitetura.md) — componentes e fluxos.
4. Demais docs conforme a área de atuação:
   - [docs/setup.md](./docs/setup.md) — como rodar localmente.
   - [docs/api.md](./docs/api.md) — contrato de endpoints.
   - [docs/banco-dados.md](./docs/banco-dados.md) — schema de tabelas.
   - [docs/motores-faciais.md](./docs/motores-faciais.md) — os 2 motores e thresholds.
   - [docs/metricas.md](./docs/metricas.md) — o que medir e dashboard.
   - [docs/lgpd-seguranca.md](./docs/lgpd-seguranca.md) — dados sensíveis.
   - [docs/glossario.md](./docs/glossario.md) — termos do domínio.

## 5. Regras de implementação

### Estrutura de pastas
- **Frontend:** `/frontend` (Next.js). Componentes em `/components`, páginas em `/pages`.
- **Backend:** `/backend` (C# .NET). Controllers em `/Controllers`, serviços em `/Services`.
- **Vision service:** `/vision-service` (Python FastAPI).
- Não criar novas pastas raiz sem justificativa + ADR.

### Nomenclatura
- **Frontend/JS/TS:** `camelCase` para variáveis/funções, `PascalCase` para componentes/tipos.
- **C#:** `PascalCase` para classes/métodos públicos, `camelCase` para parâmetros/locais.
- **Python:** `snake_case` para funções/variáveis, `PascalCase` para classes.
- **Banco:** tabelas em `PascalCase` (ex.: `Usuarios`, `Biometria_Logs`); colunas em `camelCase`.

### Validações
- Dados extraídos por IA **nunca** são gravados sem validação (ver ADR-006): dígitos de CPF, plausibilidade de datas, API externa e consistência entre documentos.

### Segurança (ver [docs/lgpd-seguranca.md](./docs/lgpd-seguranca.md))
- Vetores faciais **devem** ser criptografados com AES-256 no C# antes de gravar (ADR-009).
- Fotos brutas **não** são persistidas — só embeddings.
- Vision-service **não** pode ser exposto à internet.
- Logs **nunca** devem conter CPF completo, vetores faciais ou imagens em texto.

### Métricas (ver [docs/metricas.md](./docs/metricas.md))
- Toda operação de cadastro/login facial deve gerar uma linha em `Biometria_Logs` com latência, score, motor, device, resultado e código de erro (se houver).
- Log estruturado em todos os serviços com `traceId` compartilhado.

## 6. Fluxo obrigatório ao propor mudança técnica

Quando o usuário pedir uma mudança que envolva arquitetura, biblioteca, motor ou padrão:

1. **Leia os ADRs vigentes** em [docs/decisoes.md](./docs/decisoes.md).
2. Verifique se a mudança **conflita** com algum ADR `Aceita`.
3. Se conflitar:
   - Apresente o conflito ao usuário e proponha **novo ADR** substituindo o anterior.
4. Se não conflitar:
   - Proponha um **novo ADR** (ou atualização) justificando a mudança.
5. **Só implemente após aprovação** do usuário.

## 7. Checklist antes de finalizar uma tarefa

- [ ] Li os ADRs relevantes.
- [ ] Minha mudança está alinhada com as decisões `Aceita`.
- [ ] Atualizei a documentação afetada (`/docs` ou ADRs).
- [ ] Não deixei CPFs/vetores faciais em logs ou código.
- [ ] Registrei a operação em `Biometria_Logs` (se aplicável).
- [ ] Comentei o cabeçalho de arquivos novos (1–3 linhas).
- [ ] Mensagens, comentários e docs em Português do Brasil.

## 8. O que o agente **não** deve fazer

- ❌ Instalar dependências sem justificativa + ADR.
- ❌ Criar arquivos `*.md` não solicitados (exceto ADRs propostos ao usuário).
- ❌ Persistir fotos brutas faciais.
- ❌ Gravar dados extraídos sem validar (ADR-006).
- ❌ Pular o registro de métricas em operações biométricas.
- ❌ Reescrever ADRs antigos (crie novos substituindo).
- ❌ Mudar linguagem dos comentários/docs para inglês sem ordem expressa.

---

> Este documento é o contrato entre o time e os agentes de IA. Alterações aqui só com aprovação do humano responsável.
