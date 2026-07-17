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
-- Fonte dos dados do dashboard (ADR-008)
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
  criadoEm      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
-- Verificacao (rodar depois para confirmar)
-- =====================================================================
-- SHOW TABLES;
-- DESCRIBE Usuarios;
-- DESCRIBE Vetores_Faciais;
-- DESCRIBE Biometria_Logs;
-- DESCRIBE Termos_Consentimento;
