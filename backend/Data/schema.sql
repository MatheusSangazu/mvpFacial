-- =====================================================================
-- MVP Reconhecimento Facial - Schema MySQL (ADR-011)
-- Executar no MySQL 8.0+
-- Script idempotente (pode rodar mais de uma vez)
-- =====================================================================

-- Cria o banco se nao existir
CREATE DATABASE IF NOT EXISTS mvp_facial
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mvp_facial;

-- =====================================================================
-- Tabela: Termos_Consentimento
-- Historico versionado dos termos LGPD exibidos no cadastro
-- =====================================================================
CREATE TABLE IF NOT EXISTS Termos_Consentimento (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  versao       VARCHAR(20) NOT NULL UNIQUE,
  texto        TEXT NOT NULL,
  ativo        BOOLEAN NOT NULL DEFAULT TRUE,
  criadoEm     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- =====================================================================
-- Tabela: Usuarios
-- Dados cadastrais + dados extraidos dos documentos (Gemini)
-- =====================================================================
CREATE TABLE IF NOT EXISTS Usuarios (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  nome                 VARCHAR(255) NOT NULL,
  cpf                  VARCHAR(14) NOT NULL UNIQUE,
  dataNascimento       DATE NULL,
  nomeMae              VARCHAR(255) NULL,
  dadosDocumento       JSON NULL,
  tipoDocumento        VARCHAR(50) NULL,
  consentimentoAceito  BOOLEAN NOT NULL DEFAULT FALSE,
  termoVersao          VARCHAR(20) NULL,
  criadoEm             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizadoEm         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_usuarios_cpf (cpf),
  CONSTRAINT fk_usuarios_termo
    FOREIGN KEY (termoVersao) REFERENCES Termos_Consentimento(versao)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- Tabela: Vetores_Faciais
-- Embeddings faciais (3 por usuario no cadastro - ADR-004)
-- O campo embedding e criptografado em nivel de aplicacao (C# AES-256 - ADR-009)
-- =====================================================================
CREATE TABLE IF NOT EXISTS Vetores_Faciais (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuarioId    BIGINT NOT NULL,
  embedding    LONGTEXT NOT NULL,  -- JSON criptografado (AES-256)
  pose         VARCHAR(20) NULL,    -- frente | esquerda | direita
  modelo       VARCHAR(50) NULL,    -- ex.: Facenet, VGG-Face
  criadoEm     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vetores_usuario (usuarioId),
  CONSTRAINT fk_vetores_usuario
    FOREIGN KEY (usuarioId) REFERENCES Usuarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- Tabela: Biometria_Logs
-- Metricas de cada operacao de cadastro/login facial
-- Fonte dos dados do dashboard (ADR-008) e do Laudo Tecnico (ADR-014)
-- =====================================================================
CREATE TABLE IF NOT EXISTS Biometria_Logs (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuarioId     BIGINT NULL,         -- NULL para tentativas anonimas
  operacao      VARCHAR(20) NOT NULL,  -- cadastro | login
  motor         TINYINT NOT NULL,      -- 1 ou 2
  autenticado   BOOLEAN NOT NULL,
  score         DOUBLE NULL,           -- similaridade 0..1
  limiar        DOUBLE NULL,           -- threshold aplicado
  latenciaMs    INT NULL,
  device        VARCHAR(20) NULL,      -- cpu | cuda | cloud
  livenessOk    BOOLEAN NULL,
  erro          VARCHAR(100) NULL,     -- codigo de erro
  -- Colunas do Laudo Tecnico (ADR-014): geradas pelo Motor 1 (Gemini) apos o Motor 2 decidir.
  parecerTexto         TEXT NULL,        -- parecer forense em linguagem natural
  parecerJson          JSON NULL,        -- estrutura completa do laudo (decisao, acao, resumo)
  pontosAnatomicosJson JSON NULL,        -- 5 pontos anatomicos canonicos com status + observacao
  criadoEm     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_logs_usuario (usuarioId, criadoEm),
  INDEX idx_logs_motor (motor, criadoEm),
  CONSTRAINT fk_logs_usuario
    FOREIGN KEY (usuarioId) REFERENCES Usuarios(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- Seed: Termo de consentimento inicial (versao 1.0)
-- =====================================================================
INSERT INTO Termos_Consentimento (versao, texto, ativo)
SELECT '1.0',
       'Consinto com a coleta e tratamento dos meus dados pessoais e biometricos (vetor facial) para fins de cadastro e autenticacao no sistema, conforme a LGPD (Lei 13.709/2018). Sei que posso solicitar a exclusao a qualquer momento.',
       TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM Termos_Consentimento WHERE versao = '1.0'
);

-- =====================================================================
-- Migracao incremental: colunas do Laudo Tecnico (ADR-014)
-- Idempotente: so adiciona se ainda nao existirem. Rodar em base ja criada.
-- =====================================================================
-- Detecta se a coluna parecerTexto ja existe; se nao, aplica os 3 ALTER TABLE.
-- MySQL 8 nao suporta IF NOT EXISTS em ADD COLUMN antes da 8.0.29; para compatibilidade
-- ampla usamos o padrao information_schema + prepared statement.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Biometria_Logs'
    AND COLUMN_NAME = 'parecerTexto'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE Biometria_Logs
     ADD COLUMN parecerTexto TEXT NULL,
     ADD COLUMN parecerJson JSON NULL,
     ADD COLUMN pontosAnatomicosJson JSON NULL',
  'SELECT "Laudo columns ja existem" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================================
-- Migracao incremental: tabela Documentos_Cadastrados (multi-doc por usuario)
-- =====================================================================
CREATE TABLE IF NOT EXISTS Documentos_Cadastrados (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuarioId            BIGINT NOT NULL,
  tipoDocumento        VARCHAR(30) NOT NULL,    -- RG | CNH | Comprovante
  nomeArquivo          VARCHAR(255) NULL,       -- somente metadata, sem binario
  dadosExtraidosJson   JSON NOT NULL,           -- dados extraidos pela IA
  confiancaExtracao    VARCHAR(10) NULL,        -- "0.92" como string p/ evitar cultura
  criadoEm             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_docs_usuario (usuarioId, tipoDocumento),
  CONSTRAINT fk_docs_usuario
    FOREIGN KEY (usuarioId) REFERENCES Usuarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- Migracao ADR-018: tabela Fotos_Referencia (1 foto cifrada por usuario, para Motor 1)
-- Justificativa: o Motor 1 (Gemini) so consegue comparar identidade se tiver uma
-- foto de referencia. ADR-009 veta persistir fotos brutas; ADR-018 abre excecao
-- para a foto de referencia do Motor 1, cifrada com AES-256-GCM (mesma cifra dos vetores).
-- =====================================================================
CREATE TABLE IF NOT EXISTS Fotos_Referencia (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuarioId            BIGINT NOT NULL,
  conteudoCifrado      LONGBLOB NOT NULL,        -- bytes cifrados (AES-256-GCM)
  mime                 VARCHAR(30) NULL,         -- image/jpeg | image/png | image/webp
  origem               VARCHAR(30) NULL,         -- cadastro | atualizacao
  criadoEm             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fotos_ref_usuario (usuarioId),   -- 1 foto por usuario
  CONSTRAINT fk_fotos_ref_usuario
    FOREIGN KEY (usuarioId) REFERENCES Usuarios(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- Verificacao (rodar depois para confirmar)
-- =====================================================================
-- SHOW TABLES;
-- DESCRIBE Usuarios;
-- DESCRIBE Vetores_Faciais;
-- DESCRIBE Biometria_Logs;
-- DESCRIBE Termos_Consentimento;
-- DESCRIBE Documentos_Cadastrados;
