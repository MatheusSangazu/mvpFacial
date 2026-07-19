"use client";

// Pagina de Login Facial.
// Fluxo: CPF -> captura 1 foto frontal -> seleciona motor -> POST /api/biometria/verificar.
// Modo comparativo (ADR-017): mesma 1 foto passa por Motor 1 (liveness) e Motor 2 (identidade).
// Resultado: AUTENTICADO | INCONCLUSIVO | REJETIADO com metricas + link para o Laudo Tecnico.
//
// ADR-014: livenessOk=false veta AUTENTICADO (mesmo se score >= limiar).
// ADR-015: enforce_detection=False no /verificar (mais permissivo para login).
// ADR-017: verificacao comparativa usa 1 foto so. Motor 1 faz liveness, Motor 2 faz identidade.
import { useState } from "react";
import Link from "next/link";
import CameraCapture, { type FotoCapturada } from "@/components/CameraCapture";
import {
  api,
  setToken,
  type VerificarResponse,
  type VerificarComparativoResponse,
} from "@/lib/api";
import {
  mascararCpf,
  normalizarCpf,
  validarCpf,
  formatarLatencia,
} from "@/lib/format";

type Motor = 1 | 2 | "comparativo";

export default function LoginPage() {
  const [cpf, setCpf] = useState("");
  const [motor, setMotor] = useState<Motor>(2); // DeepFace por padrao (local)
  const [limiar, setLimiar] = useState<string>(""); // opcional, vazio usa default do backend
  const [foto, setFoto] = useState<FotoCapturada | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<VerificarResponse | null>(null);
  const [resultadoComp, setResultadoComp] =
    useState<VerificarComparativoResponse | null>(null);

  const cpfValido = validarCpf(cpf);
  const podeVerificar = cpfValido && !enviando && foto !== null;

  async function verificar() {
    setErro("");
    setEnviando(true);
    try {
      if (!foto) return;
      const limiarNum = limiar.trim()
        ? Number(limiar.replace(",", "."))
        : undefined;

      if (motor === "comparativo") {
        const r = await api.verificarComparativo(
          foto.file,
          normalizarCpf(cpf),
          limiarNum,
        );
        setResultadoComp(r);
        if (r.token) setToken(r.token);
      } else {
        const r = await api.verificar(foto.file, normalizarCpf(cpf), limiarNum);
        setResultado(r);
        if (r.token) setToken(r.token);
      }
    } catch (e: any) {
      setErro(traduzErro(e));
      setResultado(null);
      setResultadoComp(null);
    } finally {
      setEnviando(false);
    }
  }

  function reiniciar() {
    setResultado(null);
    setResultadoComp(null);
    setFoto(null);
    setErro("");
  }

  // --- Tela de resultado comparativo (ADR-016) ---
  if (resultadoComp) {
    return (
      <ResultadoComparativo
        resultado={resultadoComp}
        cpf={cpf}
        onReiniciar={reiniciar}
      />
    );
  }

  // --- Tela de resultado unico ---
  if (resultado) {
    return <ResultadoLogin resultado={resultado} cpf={cpf} onReiniciar={reiniciar} />;
  }

  // --- Form de login ---
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Login facial</h1>
        <p className="text-sm text-[var(--fg-secondary)] mt-1">
          Autenticação por biometria. Informe o CPF e capture uma foto frontal.
        </p>
      </header>

      {/* Passo 1: CPF + Motor */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-4">
          <PassoBadge n={1} ativo />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
            Identificação
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-1.5">
              CPF
            </label>
            <input
              className="input font-mono"
              value={cpf}
              onChange={(e) => setCpf(mascararCpf(e.target.value))}
              placeholder="000.000.000-00"
              inputMode="numeric"
              disabled={enviando}
            />
            {cpf && !cpfValido && (
              <p className="text-xs text-[var(--warning)] mt-1">CPF inválido</p>
            )}
          </div>

          <div>
            <label className="block text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-1.5">
              Limiar (opcional)
            </label>
            <input
              className="input font-mono"
              value={limiar}
              onChange={(e) => setLimiar(e.target.value)}
              placeholder="default (0.60)"
              inputMode="decimal"
              disabled={enviando}
            />
            <p className="text-xs text-[var(--fg-muted)] mt-1">
              Deixe vazio para usar o limiar padrão do motor.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-2">
            Motor de comparação
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <MotorCard
              n={1}
              selecionado={motor === 1}
              onClick={() => setMotor(1)}
              titulo="Motor 1 — Gemini"
              desc="Visão multimodal na nuvem. Comparador explicador."
              badge="Cloud"
            />
            <MotorCard
              n={2}
              selecionado={motor === 2}
              onClick={() => setMotor(2)}
              titulo="Motor 2 — DeepFace"
              desc="Facenet 128-dim local. Comparação determinística."
              badge="On-prem"
            />
            <MotorCard
              n="C"
              selecionado={motor === "comparativo"}
              onClick={() => setMotor("comparativo")}
              titulo="Comparar ambos"
              desc="Mesma 1 foto passa pelos 2 motores comparando identidade (ADR-018)."
              badge="Comparativo"
              destaque
            />
          </div>
        </div>
      </div>

      {/* Passo 2: Captura facial unificada (1 foto para qualquer motor) */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-4">
          <PassoBadge n={2} ativo={cpfValido} />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
            Captura facial
          </h2>
        </div>

        {!cpfValido && (
          <div className="p-3 bg-[var(--bg-elevated)] rounded border border-[var(--border-subtle)] text-sm text-[var(--fg-muted)]">
            Informe um CPF válido para liberar a captura.
          </div>
        )}

        {cpfValido && (
          <>
            <div className="mb-4 p-3 bg-[var(--bg-elevated)] rounded border border-[var(--border-subtle)] text-xs">
              <p className="text-[var(--fg-muted)] mb-2 font-mono uppercase tracking-wider">
                Orientações
              </p>
              <ul className="space-y-1 text-[var(--fg-secondary)]">
                <li>• Olhe diretamente para a câmera</li>
                <li>• Rosto centralizado no oval cyan</li>
                <li>• Ambientes iluminados, sem reflexos</li>
                <li>• Sem óculos escuros ou máscaras</li>
              </ul>
              {motor === "comparativo" && (
                <p className="mt-2 text-[var(--accent-cyan)]">
                  Modo comparativo: a mesma foto será analisada pelo Motor 1 (liveness) e pelo Motor 2 (identidade).
                </p>
              )}
            </div>

            <CameraCapture
              maxFotos={1}
              fotos={foto ? [foto] : []}
              onAdd={(f) => setFoto(f)}
              onRemove={() => setFoto(null)}
              onClear={() => setFoto(null)}
              aspectRatio="1:1"
            />
          </>
        )}
      </div>

      {/* Acao */}
      {erro && (
        <div className="mb-4 text-sm text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger)] rounded px-3 py-2">
          {erro}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Link
          href="/"
          className="text-sm text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
        >
          ← Voltar ao início
        </Link>
        <button
          onClick={verificar}
          className="btn-primary"
          disabled={!podeVerificar}
        >
          {enviando
            ? "Verificando..."
            : motor === "comparativo"
              ? "Comparar M1 + M2 →"
              : `Verificar com Motor ${motor} →`}
        </button>
      </div>

      <p className="mt-6 text-xs text-[var(--fg-muted)] text-center">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="text-[var(--accent-cyan)] hover:underline">
          Cadastre-se
        </Link>
      </p>
    </div>
  );
}

// --- Tela de resultado comparativo (ADR-016) ---

function ResultadoComparativo({
  resultado,
  cpf,
  onReiniciar,
}: {
  resultado: VerificarComparativoResponse;
  cpf: string;
  onReiniciar: () => void;
}) {
  const m1 = resultado.motor1;
  const m2 = resultado.motor2;

  // ADR-018: M1 faz comparacao + liveness.
  // Regra de aprovacao no M1:
  //   - Se tem similaridade: precisa ser >= limiar.
  //   - Se tem liveness classificado: precisa ser "live" (nao "printed/screen/mask").
  //   - Se algum dos dois campos e null, nao penaliza (so exige o que veio).
  const m1TemSimilaridade = m1.similaridadePct != null;
  const m1TemLiveness = !!m1.liveness?.classificacao && m1.liveness.classificacao.trim() !== "";
  const m1LivenessOk = m1.liveness?.classificacao?.toLowerCase() === "live";
  const m1LivenessSpoofing = m1TemLiveness && !m1LivenessOk;

  const m1SimilaridadeOk = !m1TemSimilaridade || m1.similaridadePct! >= m2.limiar * 100;
  const m1Aprovado = m1.ok && m1SimilaridadeOk && !m1LivenessSpoofing;

  const m2Aprovado = m2.autenticado;
  const concordaram = resultado.concordancia;
  const houveVeto = m2.vetoSpoofing === true;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <header className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold">Comparativo de motores</h1>
          <span
            className={`badge ${
              concordaram ? "badge-success" : "badge-warning"
            } font-mono`}
          >
            {concordaram
              ? "✓ Motores concordaram"
              : "⚠ Motores divergiram"}
          </span>
        </div>
        <p className="text-sm text-[var(--fg-secondary)] mt-1">
          Olá, <strong>{resultado.nome}</strong> · CPF{" "}
          <span className="font-mono">{mascararCpf(cpf)}</span> · latência total{" "}
          <span className="font-mono">{formatarLatencia(resultado.latenciaTotalMs)}</span>
          {" "}· Log #{m2.logId}
        </p>
      </header>

      {/* Hero - banner de concordancia */}
      <div
        className="card border-2 mb-6"
        style={{
          borderColor: concordaram ? "var(--success)" : "var(--warning)",
          background: concordaram
            ? "var(--success-bg)"
            : "var(--warning-bg)",
        }}
      >
        <div className="text-xs uppercase tracking-wider font-mono mb-1"
          style={{ color: concordaram ? "var(--success)" : "var(--warning)" }}
        >
          1 foto · 2 motores
        </div>
        <div
          className="text-2xl font-bold"
          style={{ color: concordaram ? "var(--success)" : "var(--warning)" }}
        >
          {concordaram
            ? (m1Aprovado ? "Ambos motores aprovaram" : "Ambos motores rejeitaram")
            : "Motores divergiram"}
        </div>
        <div
          className="text-sm mt-1"
          style={{ color: concordaram ? "var(--success)" : "var(--warning)" }}
        >
          {concordaram
            ? (m1Aprovado
                ? "Motor 1 (Gemini) e Motor 2 (DeepFace) concordam: mesma identidade + pessoa real."
                : "Nenhum dos motores reconheceu/spoofing detectado.")
            : `Motor 1 ${m1Aprovado ? "aprovou" : "rejeitou"} · Motor 2 ${m2Aprovado ? "autenticou" : "rejeitou"}.`}
        </div>
        {houveVeto && (
          <div className="mt-3 p-2 bg-[var(--danger-bg)] border border-[var(--danger)] rounded text-xs text-[var(--danger)]">
            <strong>Veto de liveness (ADR-018):</strong> Motor 2 teria autenticado pela identidade, mas Motor 1 detectou spoofing ({m1.liveness?.classificacao}). Sessão negada.
          </div>
        )}
      </div>

      {/* Grid 2 colunas - cards dos motores */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Motor 1 - Gemini (COMPARACAO + LIVENESS - ADR-018) */}
        <CardMotor
          motorLabel="Motor 1"
          subtitulo={
            m1TemSimilaridade
              ? "Gemini · Comparação + Liveness"
              : "Gemini · Liveness (sem foto de ref.)"
          }
          corFg={m1Aprovado ? "var(--success)" : "var(--danger)"}
          corBg={m1Aprovado ? "var(--success-bg)" : "var(--danger-bg)"}
          decisao={m1Aprovado ? "APOVOU" : "REJEITOU"}
          icone={m1Aprovado ? "✓" : "✕"}
          ok={m1.ok}
          erro={m1.erro}
        >
          {m1TemSimilaridade && (
            <>
              <RowMetric
                label="Similaridade"
                valor={`${m1.similaridadePct!.toFixed(1)}%`}
                mono
                destaque
              />
              <RowMetric
                label="Limiar comparado"
                valor={`${(m2.limiar * 100).toFixed(0)}%`}
                mono
              />
              <RowMetric
                label="Confiança"
                valor={
                  m1.confianca != null
                    ? `${(m1.confianca * 100).toFixed(0)}%`
                    : "—"
                }
              />
            </>
          )}
          <RowMetric
            label="Liveness"
            valor={m1.liveness?.classificacao ?? "—"}
            cor={
              m1.liveness?.classificacao === "live"
                ? "var(--success)"
                : m1.liveness?.classificacao &&
                  m1.liveness.classificacao !== "indeterminado"
                  ? "var(--danger)"
                  : undefined
            }
            destaque={!m1TemSimilaridade}
          />
          {!m1TemSimilaridade && (
            <RowMetric
              label="Confiança liveness"
              valor={
                m1.liveness?.confianca != null
                  ? `${(m1.liveness.confianca * 100).toFixed(0)}%`
                  : "—"
              }
            />
          )}
          <RowMetric
            label="ICAO conformidade"
            valor={
              m1.icaoConformidade?.conforme == null
                ? "—"
                : m1.icaoConformidade.conforme
                  ? "OK"
                  : "FALHOU"
            }
            cor={
              m1.icaoConformidade?.conforme === false
                ? "var(--danger)"
                : m1.icaoConformidade?.conforme
                  ? "var(--success)"
                  : undefined
            }
          />
          {m1.qualidade?.score != null && (
            <RowMetric
              label="Qualidade da foto"
              valor={`${m1.qualidade.score}/100`}
              cor={
                m1.qualidade.score < 50
                  ? "var(--danger)"
                  : undefined
              }
            />
          )}
          <RowMetric
            label="Latência"
            valor={formatarLatencia(m1.latenciaMs)}
            mono
          />
          {m1.justificativa && (
            <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--fg-muted)] uppercase tracking-wider mb-1">
                Justificativa (Gemini)
              </div>
              <p className="text-xs text-[var(--fg-secondary)] leading-relaxed">
                {m1.justificativa}
              </p>
            </div>
          )}
          {m1.liveness?.indicadores && m1.liveness.indicadores.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
              <div className="text-[10px] text-[var(--fg-muted)] uppercase tracking-wider mb-1">
                Indicadores de spoofing
              </div>
              <ul className="text-xs text-[var(--fg-secondary)] space-y-0.5">
                {m1.liveness.indicadores.map((ind, i) => (
                  <li key={i}>• {ind}</li>
                ))}
              </ul>
            </div>
          )}
          {m1.icaoConformidade?.falhas &&
            m1.icaoConformidade.falhas.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
                <div className="text-[10px] text-[var(--fg-muted)] uppercase tracking-wider mb-1">
                  Falhas ICAO
                </div>
                <ul className="text-xs text-[var(--fg-secondary)] space-y-0.5">
                  {m1.icaoConformidade.falhas.map((f, i) => (
                    <li key={i}>• {f}</li>
                  ))}
                </ul>
              </div>
            )}
        </CardMotor>

        {/* Motor 2 - DeepFace (IDENTIDADE) */}
        <CardMotor
          motorLabel="Motor 2"
          subtitulo="DeepFace / Facenet · Identidade"
          corFg={m2.autenticado ? "var(--success)" : "var(--danger)"}
          corBg={m2.autenticado ? "var(--success-bg)" : "var(--danger-bg)"}
          decisao={m2.autenticado ? "AUTÊNTICO" : "REJEITADO"}
          icone={m2.autenticado ? "✓" : "✕"}
          ok={m2.ok}
          erro={m2.erro}
        >
          <RowMetric
            label="Score"
            valor={m2.score?.toFixed(4) ?? "—"}
            mono
            destaque
          />
          <RowMetric
            label="Limiar aplicado"
            valor={m2.limiar.toFixed(2)}
            mono
          />
          <RowMetric
            label="Liveness (DeepFace)"
            valor={
              m2.livenessOk == null ? "—" : m2.livenessOk ? "OK" : "FALHOU"
            }
            cor={
              m2.livenessOk === false
                ? "var(--danger)"
                : m2.livenessOk
                  ? "var(--success)"
                  : undefined
            }
          />
          <RowMetric label="Device" valor={m2.device ?? "—"} mono />
          <RowMetric
            label="Latência"
            valor={formatarLatencia(m2.latenciaMs)}
            mono
          />
          <RowMetric label="Log ID" valor={`#${m2.logId}`} mono />

          {!m2.autenticado &&
            m2.score != null &&
            m2.score >= m2.limiar &&
            houveVeto && (
              <div className="mt-3 p-2 bg-[var(--danger-bg)] border border-[var(--danger)] rounded text-xs text-[var(--danger)]">
                <strong>Veto M1→M2:</strong> score ≥ limiar, mas Motor 1 detectou {m1.liveness?.classificacao}. Identidade bate, mas sessão negada.
              </div>
            )}
          {!m2.autenticado &&
            m2.score != null &&
            m2.score < m2.limiar &&
            !houveVeto && (
              <div className="mt-3 p-2 bg-[var(--danger-bg)] border border-[var(--danger)] rounded text-xs text-[var(--danger)]">
                <strong>Identidade não reconhecida:</strong> score &lt; limiar.
              </div>
            )}
        </CardMotor>
      </div>

      {/* Tabela comparativa de metricas (densa) */}
      <div className="card mb-6">
        <h3 className="text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-3">
          Comparativo direto
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--fg-muted)] border-b border-[var(--border-subtle)]">
              <th className="py-2 px-2">Dimensão</th>
              <th className="py-2 px-2">Motor 1 (Gemini)</th>
              <th className="py-2 px-2">Motor 2 (DeepFace)</th>
            </tr>
          </thead>
          <tbody>
            <TrCompar
              metrica="Decisão"
              m1Valor={m1Aprovado ? "APOVOU" : "REJEITOU"}
              m2Valor={m2.autenticado ? "AUTÊNTICO" : "REJEITADO"}
              m1Cor={m1Aprovado ? "success" : "danger"}
              m2Cor={m2.autenticado ? "success" : "danger"}
            />
            <TrCompar
              metrica="Score bruto"
              m1Valor={
                m1.similaridadePct != null
                  ? `${m1.similaridadePct.toFixed(1)}%`
                  : "—"
              }
              m2Valor={m2.score != null ? `${(m2.score * 100).toFixed(1)}%` : "—"}
            />
            <TrCompar
              metrica="Limiar"
              m1Valor={`${(m2.limiar * 100).toFixed(0)}%`}
              m2Valor={`${(m2.limiar * 100).toFixed(0)}%`}
            />
            <TrCompar
              metrica="Liveness"
              m1Valor={m1.liveness?.classificacao ?? "—"}
              m2Valor={
                m2.livenessOk == null ? "—" : m2.livenessOk ? "live" : "fail"
              }
              m1Cor={
                m1.liveness?.classificacao === "live"
                  ? "success"
                  : m1.liveness?.classificacao &&
                    m1.liveness.classificacao !== "indeterminado"
                    ? "danger"
                    : undefined
              }
              m2Cor={
                m2.livenessOk == null
                  ? undefined
                  : m2.livenessOk
                    ? "success"
                    : "danger"
              }
            />
            <TrCompar
              metrica="Latência"
              m1Valor={formatarLatencia(m1.latenciaMs)}
              m2Valor={formatarLatencia(m2.latenciaMs)}
            />
          </tbody>
        </table>
      </div>

      {/* Nota tecnica */}
      <div className="card-elevated p-4 mb-6 text-xs text-[var(--fg-secondary)] leading-relaxed">
        <h3 className="text-[var(--fg-muted)] uppercase tracking-wider mb-2">
          Nota técnica (ADR-018)
        </h3>
        <ul className="space-y-1">
          <li>
            • <strong>ADR-018</strong>: 1 foto é processada pelos 2 motores em paralelo. <strong>Ambos comparam identidade</strong> (Motor 1 usa foto de referência cifrada do cadastro; Motor 2 usa vetores).
          </li>
          <li>
            • <strong>ADR-014 estendido</strong>: se Motor 1 detectar <code>printed_photo</code>, <code>screen_replay</code> ou <code>mask</code>, veto automático no Motor 2 — mesmo que a identidade bata, a sessão é negada.
          </li>
          <li>
            • <strong>ADR-013</strong>: só o Motor 2 pode emitir JWT. Motor 1 é auditor de liveness.
          </li>
          <li>
            • <strong>ADR-009</strong>: a foto <strong>não foi persistida</strong> — só trafegou em memória para gerar este comparativo.
          </li>
        </ul>
      </div>

      {/* Acoes */}
      <div className="flex flex-wrap gap-2">
        <Link href={`/laudo/${m2.logId}`} className="btn-primary">
          Ver Laudo Técnico #{m2.logId}
        </Link>
        <button onClick={onReiniciar} className="btn-secondary">
          Nova verificação
        </button>
        <Link href="/" className="btn-secondary">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}

// --- Tela de resultado unico (motor 1 ou 2 isolado) ---

function ResultadoLogin({
  resultado,
  cpf,
  onReiniciar,
}: {
  resultado: VerificarResponse;
  cpf: string;
  onReiniciar: () => void;
}) {
  const cor =
    resultado.resultado === "AUTENTICADO"
      ? "success"
      : resultado.resultado === "INCONCLUSIVO"
        ? "warning"
        : "danger";

  const corBg =
    cor === "success"
      ? "var(--success-bg)"
      : cor === "warning"
        ? "var(--warning-bg)"
        : "var(--danger-bg)";

  const corFg =
    cor === "success" ? "var(--success)" : cor === "warning" ? "var(--warning)" : "var(--danger)";

  const icone = cor === "success" ? "✓" : cor === "warning" ? "?" : "✕";

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Resultado da verificação</h1>
        <p className="text-sm text-[var(--fg-secondary)] mt-1">
          Log #{resultado.logId} · {new Date().toLocaleString("pt-BR")}
        </p>
      </header>

      {/* Hero resultado */}
      <div
        className="card mb-6 border-2"
        style={{
          borderColor: corFg,
          background: corBg,
        }}
      >
        <div className="flex items-start gap-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-3xl font-bold shrink-0 border-2"
            style={{ borderColor: corFg, color: corFg }}
          >
            {icone}
          </div>
          <div className="flex-1">
            <div
              className="text-3xl font-bold tracking-tight"
              style={{ color: corFg }}
            >
              {resultado.resultado}
            </div>
            <div className="text-sm mt-1" style={{ color: corFg }}>
              {resultado.autenticado
                ? `Bem-vindo(a), ${resultado.nome}. Sessão autenticada.`
                : `Olá, ${resultado.nome}. A autenticação falhou.`}
            </div>
          </div>
        </div>
      </div>

      {/* Metricas */}
      <div className="card mb-6">
        <h3 className="text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-3">
          Métricas da verificação
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metrica
            label="Score"
            valor={resultado.metricas.score.toFixed(4)}
            destaque
          />
          <Metrica
            label="Limiar"
            valor={resultado.metricas.limiar.toFixed(2)}
          />
          <Metrica
            label="Latência"
            valor={formatarLatencia(resultado.metricas.latenciaMs)}
          />
          <Metrica
            label="Motor"
            valor={`#${resultado.metricas.motor}`}
          />
          <Metrica
            label="Liveness"
            valor={resultado.metricas.livenessOk ? "OK" : "FALHOU"}
            cor={resultado.metricas.livenessOk ? "success" : "danger"}
          />
          <Metrica label="Device" valor={resultado.metricas.device} mono />
          <Metrica label="Usuário" valor={`#${resultado.usuarioId}`} mono />
          <Metrica label="CPF" valor={mascararCpf(cpf)} mono />
        </div>

        {!resultado.metricas.livenessOk && (
          <div className="mt-4 p-3 bg-[var(--danger-bg)] border border-[var(--danger)] rounded text-xs text-[var(--danger)]">
            <strong>livenessOk = false</strong> → veto aplicado (ADR-014). Mesmo
            que score &gt;= limiar, o resultado nunca será AUTENTICADO.
          </div>
        )}
      </div>

      {/* Interpretacao */}
      <div className="card-elevated p-4 mb-6">
        <h3 className="text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-2">
          Interpretação
        </h3>
        <p className="text-sm text-[var(--fg-secondary)]">
          {resultado.resultado === "AUTENTICADO" && (
            <>
              Score <span className="font-mono text-[var(--success)]">{resultado.metricas.score.toFixed(4)}</span>{" "}
              &ge; limiar <span className="font-mono">{resultado.metricas.limiar.toFixed(2)}</span> e
              liveness aprovado. Sessão válida por{" "}
              <strong>{resultado.expiraEmHoras ?? "?"}h</strong>.
            </>
          )}
          {resultado.resultado === "INCONCLUSIVO" && (
            <>
              Score <span className="font-mono text-[var(--warning)]">{resultado.metricas.score.toFixed(4)}</span>{" "}
              está na zona cinzenta (entre rejeição e limiar). Recomendado nova
              captura com melhor iluminação.
            </>
          )}
          {resultado.resultado === "REJEITADO" && (
            <>
              Score <span className="font-mono text-[var(--danger)]">{resultado.metricas.score.toFixed(4)}</span>{" "}
              &lt; limiar <span className="font-mono">{resultado.metricas.limiar.toFixed(2)}</span>.
              Biometria não confere.
            </>
          )}
        </p>
      </div>

      {/* Acoes */}
      <div className="flex flex-wrap gap-2">
        <Link href={`/laudo/${resultado.logId}`} className="btn-primary">
          Ver Laudo Técnico #{resultado.logId}
        </Link>
        <button onClick={onReiniciar} className="btn-secondary">
          Nova verificação
        </button>
        <Link href="/" className="btn-secondary">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}

// --- Subcomponentes ---

function CardMotor({
  motorLabel,
  subtitulo,
  corFg,
  corBg,
  decisao,
  icone,
  ok,
  erro,
  children,
}: {
  motorLabel: string;
  subtitulo: string;
  corFg: string;
  corBg: string;
  decisao: string;
  icone: string;
  ok: boolean;
  erro?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="card border-2" style={{ borderColor: corFg, background: corBg }}>
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-2xl font-bold shrink-0 border-2"
          style={{ borderColor: corFg, color: corFg }}
        >
          {icone}
        </div>
        <div className="flex-1">
          <div className="text-xs font-mono uppercase tracking-wider" style={{ color: corFg }}>
            {motorLabel}
          </div>
          <div className="text-base font-semibold">{subtitulo}</div>
          <div className="text-xl font-bold" style={{ color: corFg }}>
            {decisao}
          </div>
        </div>
      </div>

      {!ok && (
        <div className="mb-3 p-2 bg-[var(--danger-bg)] border border-[var(--danger)] rounded text-xs text-[var(--danger)]">
          <strong>Erro:</strong> {erro ?? "falha interna"}
        </div>
      )}

      <div className="space-y-2">{children}</div>
    </div>
  );
}

function RowMetric({
  label,
  valor,
  mono,
  destaque,
  cor,
}: {
  label: string;
  valor: string;
  mono?: boolean;
  destaque?: boolean;
  cor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-xs text-[var(--fg-muted)] uppercase tracking-wider">
        {label}
      </span>
      <span
        className={`${mono ? "font-mono" : ""} ${destaque ? "font-semibold" : ""}`}
        style={{ color: cor ?? "var(--fg-primary)" }}
      >
        {valor}
      </span>
    </div>
  );
}

function TrCompar({
  metrica,
  m1Valor,
  m2Valor,
  m1Cor,
  m2Cor,
}: {
  metrica: string;
  m1Valor: string;
  m2Valor: string;
  m1Cor?: "success" | "danger" | "warning";
  m2Cor?: "success" | "danger" | "warning";
}) {
  const corFg = (c?: "success" | "danger" | "warning") =>
    c === "success"
      ? "var(--success)"
      : c === "danger"
        ? "var(--danger)"
        : c === "warning"
          ? "var(--warning)"
          : "var(--fg-primary)";
  return (
    <tr className="border-b border-[var(--border-subtle)]">
      <td className="py-2 px-2 text-[var(--fg-secondary)] text-xs uppercase tracking-wider">
        {metrica}
      </td>
      <td className="py-2 px-2 font-mono" style={{ color: corFg(m1Cor) }}>
        {m1Valor}
      </td>
      <td className="py-2 px-2 font-mono" style={{ color: corFg(m2Cor) }}>
        {m2Valor}
      </td>
    </tr>
  );
}

function PassoBadge({ n, ativo }: { n: number | string; ativo: boolean }) {
  return (
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono border ${
        ativo
          ? "bg-[var(--accent-cyan)] text-[#00141a] border-[var(--accent-cyan)]"
          : "bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border-subtle)]"
      }`}
    >
      {n}
    </div>
  );
}

function MotorCard({
  n,
  selecionado,
  onClick,
  titulo,
  desc,
  badge,
  destaque,
}: {
  n: number | string;
  selecionado: boolean;
  onClick: () => void;
  titulo: string;
  desc: string;
  badge: string;
  destaque?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded border transition-all relative ${
        selecionado
          ? "border-[var(--accent-cyan)] bg-[rgba(34,211,238,0.05)]"
          : destaque
            ? "border-[var(--border-strong)] hover:border-[var(--accent-cyan)]"
            : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
      }`}
    >
      {destaque && (
        <span className="absolute -top-2 right-2 text-[9px] font-mono uppercase tracking-wider bg-[var(--accent-cyan)] text-[#00141a] px-1.5 py-0.5 rounded">
          novo
        </span>
      )}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-[var(--fg-muted)]">
          {typeof n === "number" ? `M${n}` : n}
        </span>
        <span className="badge badge-muted">{badge}</span>
      </div>
      <div className="text-sm font-semibold mb-1">{titulo}</div>
      <div className="text-xs text-[var(--fg-secondary)]">{desc}</div>
    </button>
  );
}

function Metrica({
  label,
  valor,
  mono,
  destaque,
  cor,
}: {
  label: string;
  valor: string;
  mono?: boolean;
  destaque?: boolean;
  cor?: "success" | "warning" | "danger";
}) {
  const corFg =
    cor === "success"
      ? "var(--success)"
      : cor === "warning"
        ? "var(--warning)"
        : cor === "danger"
          ? "var(--danger)"
          : destaque
            ? "var(--accent-cyan)"
            : "var(--fg-primary)";
  return (
    <div className="card-elevated p-3">
      <div className="text-[10px] text-[var(--fg-muted)] uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={`text-lg font-semibold ${mono ? "font-mono" : ""}`}
        style={{ color: corFg }}
      >
        {valor}
      </div>
    </div>
  );
}

function traduzErro(e: any): string {
  const codigo = e?.codigo ?? "";
  const map: Record<string, string> = {
    CPF_INVALIDO: "CPF inválido.",
    USUARIO_NAO_ENCONTRADO:
      "CPF não cadastrado. Verifique ou cadastre-se primeiro.",
    SEM_VETORES:
      "Usuário não possui biometria cadastrada. Faça o cadastro facial.",
    SEM_ROSTO:
      "Nenhum rosto detectado na foto. Tente novamente em local mais iluminado.",
    VISION_FALHOU: "Serviço de visão indisponível. Tente novamente.",
    LIMIAR_INVALIDO: "Limiar informado é inválido (use 0 a 1).",
    FOTO_REFERENCIA_AUSENTE: "Envie a foto de referência.",
    FOTO_ATUAL_AUSENTE: "Envie a foto atual (selfie).",
    MIME_NAO_SUPORTADO: "Formato não suportado (use JPG/PNG/WEBP).",
    IMAGEM_MUITO_GRANDE: "Imagem maior que 10 MB.",
    GEMINI_NAO_CONFIGURADO:
      "Motor 1 (Gemini) não configurado. Defina a API key para usar o modo comparativo.",
  };
  return map[codigo] ?? e?.message ?? "Erro inesperado. Tente novamente.";
}
