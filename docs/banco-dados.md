# Banco de Dados

Banco relacional hospedado em VPS. Vetores faciais ficam em tabela própria, em coluna JSON/array criptografada.

> Este é o schema **inicial** proposto — revisar conforme o SGBD escolhido (Postgres recomendado por suporte a `JSONB` e `pgcrypto`).

## Diagrama de relacionamento (DER)

```text
┌─────────────────┐       ┌─────────────────────┐
│    Usuarios     │ 1───* │   Vetores_Faciais   │
│─────────────────│       │─────────────────────│
│ id (PK)         │◀──────│ id (PK)             │
│ nome            │       │ usuarioId (FK)      │
│ cpf (unico)     │       │ embedding (JSON)    │
│ dadosDocumento  │       │ pose (frente|esq|dir)│
│ consentimento   │       │ criadoEm            │
│ criadoEm        │       └─────────────────────┘
│ atualizadoEm    │
└────────┬────────┘
         │ 1
         │
         │ *
┌────────▼────────────────┐       ┌─────────────────────┐
│     Biometria_Logs      │       │   Termos_Consentim.  │
│─────────────────────────│       │─────────────────────│
│ id (PK)                 │       │ id (PK)             │
│ usuarioId (FK, anulavel)│       │ versao (unica)      │
│ operacao (cad|login)    │       │ texto               │
│ motor (1|2|nulo)        │       │ ativo               │
│ autenticado (bool)      │       └─────────────────────┘
│ score, limiar           │
│ latenciaMs              │
│ device (cpu|cuda|cloud) │
│ livenessOk              │
│ erro (texto)            │
│ criadoEm                │
└─────────────────────────┘
```

## Tabelas

### `Usuarios`
Armazena dados cadastrais e dados extraídos dos documentos.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `nome` | varchar | extraído |
| `cpf` | varchar(14) único | validado em C# (dígitos) |
| `dataNascimento` | date | |
| `nomeMae` | varchar | |
| `dadosDocumento` | JSONB | campos extras por tipo de documento (endereço, RG, etc.) |
| `tipoDocumento` | varchar | RG / CNH / Comprovante |
| `consentimentoAceito` | bool | |
| `termoVersao` | varchar | FK lógica para `Termos_Consentimento` |
| `criadoEm` / `atualizadoEm` | timestamptz | |

### `Vetores_Faciais`
Uma linha por embedding (3 por usuário no cadastro). **Não** armazenar média (ADR-004).

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `usuarioId` | bigint FK → Usuarios | ON DELETE CASCADE |
| `embedding` | JSONB (criptografado) | array de floats; **criptografar em repouso** |
| `pose` | varchar | `frente` / `esquerda` / `direita` |
| `modelo` | varchar | ex.: `Facenet`, `VGG-Face` |
| `criadoEm` | timestamptz | |

### `Biometria_Logs`
Fonte das métricas de demonstração. `usuarioId` anulável para tentativas anônimas.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `usuarioId` | bigint FK, anulável | |
| `operacao` | varchar | `cadastro` / `login` |
| `motor` | smallint | 1 ou 2 |
| `autenticado` | bool | resultado da comparação |
| `score` | float | similaridade (0..1) |
| `limiar` | float | threshold aplicado |
| `latenciaMs` | int | tempo total da operação |
| `device` | varchar | `cpu` / `cuda` / `cloud` |
| `livenessOk` | bool | |
| `erro` | varchar, anulável | código de erro se houve |
| `criadoEm` | timestamptz | |

### `Termos_Consentimento`
Histórico versionado dos termos exibidos no cadastro.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | |
| `versao` | varchar único | ex.: `1.0` |
| `texto` | text | |
| `ativo` | bool | |

## Índices sugeridos

- `Usuarios(cpf)` único.
- `Vetores_Faciais(usuarioId)` — leitura por usuário no login.
- `Biometria_Logs(usuarioId, criadoEm)` e `Biometria_Logs(motor, criadoEm)` — relatórios de métricas.

## Considerações de segurança

- Vetores faciais e colunas sensíveis **criptografados em repouso** (ex.: `pgcrypto` no Postgres, ou criptografia na camada de aplicação no C# antes de gravar).
- Acesso ao banco restrito por usuário/role; o backend usa uma role com privilégios mínimos.
- Backups também precisam ser criptografados (LGPD).
- **Nunca** gravar a foto bruta permanentemente; se necessário temporariamente, definir prazo curto de expurgo.

## Exemplo de JSON do embedding

```json
{
  "dim": 128,
  "valores": [0.0123, -0.0456, 0.0789, "..."]
}
```
O conteúdo é criptografado antes de persistir; a chave vive fora do banco (ver [lgpd-seguranca.md](./lgpd-seguranca.md)).
