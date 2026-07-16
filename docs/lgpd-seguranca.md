# LGPD e Segurança

> **Atenção:** biometria facial é **dado sensível** pela LGPD (Lei nº 13.709/2018, art. 5º, II). Mesmo em MVP de demonstração, o tratamento precisa de base legal e cuidados. Este documento serve de _checklist_ para a equipe e stakeholders.

## Princípios gerais

1. **Finalidade:** o tratamento existe apenas para o propósito declarado (cadastro/login do MVP).
2. **Necessidade:** coletar só o estritamente necessário.
3. **Transparência:** o titular precisa saber o que acontece com seus dados.
4. **Segurança:** medidas técnicas contra acesso não autorizado.
5. **Prevenção:** evitar vazamento e uso indevido.

## Consentimento

- Tela de cadastro deve ter **termo de consentimento específico** para coleta de biometria e de documentos, antes de qualquer captura.
- Consentimento deve ser **livre, informado, inequívoco** e **registrado** (quem, quando, versão do termo).
- Direito de **revogação** a qualquer momento → botão "Excluir minha biometria/dados".

## Dados coletados

| Dado | Sensível? | Tratamento |
|---|---|---|
| Nome, CPF, datas do documento | Sim (pessoal/sensível) | Criptografia em repouso; acesso restrito |
| Imagem do documento | Sim | Retenção curta após extração; avaliar descarte |
| Vetor facial (embedding) | **Sim (biométrico)** | **Criptografado**; nunca armazenar a foto bruta além do necessário |
| Foto facial bruta | Sim | Usar só para gerar embedding; excluir após (definir prazo) |
| Logs de métricas | Não sensível se anonimizado | Anonimizar por padrão (hash do usuário) |

## Criptografia

> Decisão detalhada em [ADR-009](./decisoes.md#adr-009).

### Em trânsito (dados viajando entre serviços)
- **HTTPS/TLS** em todos os hops: frontend↔backend, backend↔vision-service, backend↔Gemini.
- Nenhum endpoint em `http://` em ambientes não locais. O TLS criptografa automaticamente; nada precisa ser feito manualmente além de garantir certificados válidos.

### Em repouso (dados guardados no banco)
- Criptografia em **nível de aplicação**: o **C# criptografa o embedding com AES-256** antes de gravar, usando chave em variável de ambiente ou cofre (nunca no código/repositório).
- Fluxo de cadastro: DeepFace gera embedding → C# serializa para JSON → C# criptografa (AES-256) → grava no banco.
- Fluxo de login: C# lê do banco → descriptografa → compara com embedding atual.
- A **foto bruta da face não é guardada** — só o embedding criptografado.
- Camada adicional (defesa em profundidade): `pgcrypto` no Postgres pode cifrar colunas no nível do banco, mas **não substitui** a camada de aplicação (o DBA ainda leria os dados sem ela).

### Gestão de chaves (checklist)
- [ ] Chave AES fora do repositório (variável de ambiente do servidor ou cofre).
- [ ] Backup seguro da chave (se perdida, **todos** os embeddings tornam-se indecifráveis).
- [ ] Definir política de rotação de chaves.
- [ ] Restringir quem tem acesso à variável/cofre (princípio do menor privilégio).

### Isolamento de rede
- **Comunicação backend↔vision-service:** segredo compartilhado (header `X-Internal-Token`) ou rede privada; o serviço Python **não** pode ficar exposto à internet.

## Retenção e exclusão

- Definir e documentar prazos: por quanto tempo guardamos foto bruta vs embedding vs dados extraídos.
- Implementar endpoint/rotina de **exclusão definitiva** acionada pelo titular ou por política de retenção.
- Softhouse/Stakeholders devem aprovar a política de retenção antes da demonstração.

## Segurança da aplicação

- **Autenticação:** tokens JWT com expiração curta após login; armazenamento seguro no frontend (não `localStorage` se evitável).
- **Autorização entre serviços:** validar origem das chamadas internas.
- **Validação de input:** limitar tamanho/tipo MIME das imagens; rejeitar payloads absurdos.
- **Rate limiting:** nos endpoints de IA (custo $ e abuso) e de login (brute force).
- **Anti-spoofing na borda do Motor 2:** liveness caseiro é frágil — deixar claro que é MVP.
- **Logs:** nunca logar vetores faciais, CPFs completos ou imagens em texto.

## Riscos conhecidos (transparência para a diretoria)

| Risco | Mitigação no MVP |
|---|---|
| Vazamento de vetores faciais | Criptografia em repouso + acesso restrito |
| Ataque de tela (spoofing) no Motor 1 | É proposital; marcado como inseguro |
| Uso indevido de fotos de documentos | Retenção curta + acesso auditado |
| Custo/cloud abuse | Rate limiting + chaves com cota |

## Compliance mínima para a demo

- [ ] Termo de consentimento visível e registrado
- [ ] Mecanismo de exclusão pelo titular
- [ ] TLS em todos os hops
- [ ] Vetores faciais criptografados em repouso
- [ ] Vision-service não exposto à internet
- [ ] Política de retenção aprovada
- [ ] Logs sem dados sensíveis em texto claro
- [ ] Registro de quem acessa dados (trilha de auditoria)

> Para dados de colaboradores/stakeholders usados nos testes da demo: preferir **consentimento explícito individual** e oferecer exclusão imediata após a apresentação.
