"use client";

// Pagina do Laudo Tecnico Biometrico (ADR-014).
// Visual forense/painel: metricas, parecer estruturado, pontos anatomicos, auditoria de liveness.
// Endpoint GET  /api/biometria/laudo/{logId}  - le do DB.
// Endpoint POST /api/biometria/laudo/{logId}/gerar - regenera parecer com Motor 1 (Gemini).
import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import DocumentUploader from "@/components/DocumentUploader";
import {
  api,
  type LaudoResponse,
  type ParecerLaudo,
  type PontoAnatomico,
} from "@/lib/api";
import { formatarDataHora, formatarLatencia } from "@/lib/format";

export default function LaudoPage() {
  const params = useParams();
  const logId = Number(params?.logId);
  const [laudo, setLaudo] = useState<LaudoResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const r = await api.obterLaudo(logId);
      setLaudo(r);
    } catch (e: any) {
      setErro(traduzErro(e));
    } finally {
      setCarregando(false);
    }
  }, [logId]);

  useEffect(() => {
    if (Number.isFinite(logId)) carregar();
  }, [logId, carregar]);

  if (!Number.isFinite(logId)) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="card border-[var(--danger)] text-[var(--danger)]">
          ID de log inválido.
        </div>
      </div>
    );
  }

  if (carregando) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 text-[var(--fg-secondary)]">
          <div className="w-4 h-4 border-2 border-[var(--accent-cyan)] border-t-transparent rounded-full animate-spin" />
          Carregando laudo #{logId}...
        </div>
      </div>
    );
  }

  if (erro || !laudo) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="card mb-4 border-[var(--danger)]">
          <div className="text-[var(--danger)] font-semibold mb-1">
            Não foi possível carregar o laudo
          </div>
          <div className="text-sm text-[var(--fg-secondary)]">
            {erro || "Tente novamente."}
          </div>
        </div>
        <Link href="/" className="btn-secondary">
          ← Voltar ao início
        </Link>
      </div>
    );
  }

  return <LaudoView laudo={laudo} onRegenerado={carregar} />;
}

// --- View principal ---

function LaudoView({
  laudo,
  onRegenerado,
}: {
  laudo: LaudoResponse;
  onRegenerado: () => void;
}) {
  const parecer: ParecerLaudo | null = laudo.parecer ?? null;
  const pontos: PontoAnatomico[] | null = laudo.pontosAnatomicos ?? null;

  const corDecisao = corDeDecisao(laudo.decisao);
  const assinatura = gerarAssinatura(laudo);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Cabecalho - identificacao do documento */}
      <header className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--fg-muted)]">
            Documento Forense · ADR-014
          </span>
          <span className="badge badge-muted font-mono">
            Log #{laudo.logId}
          </span>
        </div>
        <h1 className="text-2xl font-bold mb-1">Laudo Técnico Biométrico</h1>
        <p className="text-sm text-[var(--fg-secondary)]">
          Análise comparativa de biometria facial realizada em{" "}
          <strong className="font-mono text-[var(--fg-primary)]">
            {formatarDataHora(laudo.criadoEm)}
          </strong>{" "}
          via Motor <strong>{laudo.motor}</strong>.
        </p>
      </header>

      {/* Hero - decisao + similaridade */}
      <div
        className="card border-2 mb-6"
        style={{
          borderColor: corDecisao.fg,
          background: corDecisao.bg,
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <div className="text-xs uppercase tracking-wider mb-1 font-mono" style={{ color: corDecisao.fg }}>
              Decisão técnica
            </div>
            <div className="text-4xl font-bold tracking-tight" style={{ color: corDecisao.fg }}>
              {laudo.decisao}
            </div>
            {parecer?.AcaoRecomendada && (
              <div className="mt-2 text-sm" style={{ color: corDecisao.fg }}>
                Ação recomendada: <strong>{parecer.AcaoRecomendada}</strong>
              </div>
            )}
          </div>
          <div className="md:border-l md:pl-4" style={{ borderColor: corDecisao.fg }}>
            <div className="text-xs uppercase tracking-wider mb-1 font-mono text-[var(--fg-muted)]">
              Similaridade
            </div>
            <div className="text-4xl font-bold font-mono" style={{ color: corDecisao.fg }}>
              {laudo.similaridade != null ? `${laudo.similaridade.toFixed(1)}%` : "—"}
            </div>
            {laudo.metricas.score != null && laudo.metricas.limiar != null && (
              <div className="text-xs text-[var(--fg-muted)] font-mono mt-1">
                score {laudo.metricas.score.toFixed(4)} / limiar {laudo.metricas.limiar.toFixed(2)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Barra de similaridade */}
      {laudo.metricas.score != null && laudo.metricas.limiar != null && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-2 text-xs font-mono">
            <span className="text-[var(--fg-muted)]">0.00</span>
            <span className="text-[var(--fg-muted)] uppercase tracking-wider">
              Similaridade vs. limiar
            </span>
            <span className="text-[var(--fg-muted)]">1.00</span>
          </div>
          <BarraSimilaridade
            score={laudo.metricas.score}
            limiar={laudo.metricas.limiar}
          />
          <div className="grid grid-cols-3 mt-2 text-xs text-[var(--fg-muted)] font-mono">
            <div>
             zona cinzenta: <span className="text-[var(--warning)]">[{(laudo.metricas.limiar * 0.85).toFixed(2)} - {laudo.metricas.limiar.toFixed(2)}]</span>
            </div>
            <div className="text-center">
              ▲ limiar: <span className="text-[var(--accent-cyan)]">{laudo.metricas.limiar.toFixed(2)}</span>
            </div>
            <div className="text-right">
              ● score: <span style={{ color: corDecisao.fg }}>{laudo.metricas.score.toFixed(4)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Grid 2 colunas - parecer + metricas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Parecer textual */}
        <div className="card">
          <h3 className="text-xs uppercase tracking-wider mb-3 text-[var(--fg-muted)]">
            Parecer do Motor 1 (Gemini)
          </h3>
          {laudo.parecerPendente ? (
            <ParecerPendente logId={laudo.logId} onRegenerado={onRegenerado} />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--fg-primary)] leading-relaxed">
                {laudo.parecerTexto || parecer?.Resumo || "—"}
              </p>
              {parecer && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs pt-3 border-t border-[var(--border-subtle)]">
                  <Def titulo="Decisão" valor={parecer.Decisao ?? parecer.decisao} />
                  <Def titulo="Ação" valor={parecer.AcaoRecomendada ?? parecer.acaoRecomendada} />
                  <Def titulo="Similaridade (Gemini)" valor={`${parecer.SimilaridadePct ?? parecer.similaridadePct ?? 0}%`} mono />
                </dl>
              )}
              <details className="text-xs">
                <summary className="text-[var(--fg-muted)] cursor-pointer hover:text-[var(--accent-cyan)]">
                  Ver parecer completo (JSON)
                </summary>
                <pre className="mt-2 p-2 bg-[var(--bg-input)] rounded overflow-x-auto font-mono text-[10px]">
{JSON.stringify(parecer ?? laudo.parecerTexto, null, 2)}
                </pre>
              </details>
              <button
                onClick={() => window.scrollTo({ top: 0 })}
                className="text-xs text-[var(--accent-cyan)] hover:underline"
              >
                ↑ Topo
              </button>
            </div>
          )}
        </div>

        {/* Metricas tecnicas */}
        <div className="card">
          <h3 className="text-xs uppercase tracking-wider mb-3 text-[var(--fg-muted)]">
            Métricas técnicas
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Def titulo="Motor" valor={`#${laudo.motor}`} mono destaque />
            <Def titulo="Operação" valor={laudo.operacao} mono />
            <Def titulo="Score" valor={laudo.metricas.score?.toFixed(4) ?? "—"} mono />
            <Def titulo="Limiar aplicado" valor={laudo.metricas.limiar?.toFixed(2) ?? "—"} mono />
            <Def titulo="Latência total" valor={formatarLatencia(laudo.metricas.latenciaMs)} mono />
            <Def titulo="Device fingerprint" valor={laudo.metricas.device ?? "—"} mono />
            <Def titulo="Usuário" valor={laudo.nomeUsuario ?? `#${laudo.usuarioId}`} />
            <Def titulo="ID Usuário" valor={laudo.usuarioId ? `#${laudo.usuarioId}` : "anônimo"} mono />
          </dl>
        </div>
      </div>

      {/* Liveness - auditoria de vivacidade */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">
            Auditoria de vivacidade (Liveness)
          </h3>
          <span
            className={`badge ${
              laudo.liveness.ok === true
                ? "badge-success"
                : laudo.liveness.ok === false
                  ? "badge-danger"
                  : "badge-muted"
            }`}
          >
            {laudo.liveness.ok === true
              ? "✓ Aprovado"
              : laudo.liveness.ok === false
                ? "✕ Rejeitado"
                : "— Não avaliado"}
          </span>
        </div>
        <p className="text-sm text-[var(--fg-secondary)] leading-relaxed">
          {laudo.liveness.detalhe || parecer?.LivenessAuditoria || parecer?.livenessAuditoria || (
            laudo.liveness.ok === false
              ? "Liveness rejeitado. Aplicado veto automático conforme ADR-014: mesmo que score >= limiar, o resultado jamais será AUTENTICADO."
              : "Sem detalhe adicional registrado."
          )}
        </p>
        {laudo.liveness.ok === false && (
          <div className="mt-3 p-3 bg-[var(--danger-bg)] border border-[var(--danger)] rounded text-xs text-[var(--danger)]">
            <strong>Veto ADR-014 aplicado:</strong> captura suspeita de apresentação
            indesejada (presentation attack). Recomenda-se investigação manual ou
            nova tentativa com desafio ativo.
          </div>
        )}
      </div>

      {/* Pontos anatomicos - tabela */}
      {pontos && pontos.length > 0 && (
        <div className="card mb-6">
          <h3 className="text-xs uppercase tracking-wider mb-3 text-[var(--fg-muted)]">
            Pontos anatômicos comparados
          </h3>
          <div className="space-y-1.5">
            <div className="grid grid-cols-12 gap-2 text-[10px] text-[var(--fg-muted)] uppercase tracking-wider px-2 pb-1 border-b border-[var(--border-subtle)]">
              <div className="col-span-4">Ponto</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-6">Observação</div>
            </div>
            {pontos.map((p, idx) => (
              <LinhaPonto key={idx} ponto={p} />
            ))}
          </div>
        </div>
      )}

      {/* Erro tecnico (se houver) */}
      {laudo.erro && (
        <div className="card border-[var(--danger)] mb-6">
          <h3 className="text-xs uppercase tracking-wider mb-2 text-[var(--danger)]">
            Erro técnico registrado
          </h3>
          <pre className="font-mono text-xs text-[var(--danger)] overflow-x-auto">
{laudo.erro}
          </pre>
        </div>
      )}

      {/* Rodape - assinatura digital */}
      <footer className="card-elevated p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-[var(--fg-muted)] uppercase tracking-wider mb-1">
              Sistema
            </div>
            <div className="font-mono">mvpFacial · v0.1.0</div>
          </div>
          <div>
            <div className="text-[var(--fg-muted)] uppercase tracking-wider mb-1">
              Hash do log
            </div>
            <div className="font-mono break-all">{assinatura}</div>
          </div>
          <div>
            <div className="text-[var(--fg-muted)] uppercase tracking-wider mb-1">
              Conformidade
            </div>
            <div className="font-mono">ADR-006 · ADR-009 · ADR-014 · ADR-015</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] text-[10px] text-[var(--fg-muted)]">
          Este laudo foi gerado automaticamente pelos motores biométricos e não
          constitui prova pericial oficial. Para fins legais, consulte perito
          credenciado.
        </div>
      </footer>

      {/* Acoes */}
      <div className="flex flex-wrap gap-2 mt-6">
        <button
          onClick={() => window.print()}
          className="btn-secondary"
        >
          Imprimir / PDF
        </button>
        <Link href="/login" className="btn-secondary">
          Nova verificação
        </Link>
        <Link href="/" className="btn-secondary">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}

// --- Componente: Parecer pendente (gerar parecer) ---

function ParecerPendente({
  logId,
  onRegenerado,
}: {
  logId: number;
  onRegenerado: () => void;
}) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  async function gerar() {
    if (arquivos.length !== 2) {
      setErro("Envie exatamente 2 imagens: referência e atual.");
      return;
    }
    setErro("");
    setEnviando(true);
    try {
      const [ref, atual] = arquivos;
      await api.gerarLaudo(logId, ref, atual);
      onRegenerado();
    } catch (e: any) {
      setErro(traduzErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div ref={scrollRef}>
      <div className="p-3 bg-[var(--warning-bg)] border border-[var(--warning)] rounded text-xs text-[var(--warning)] mb-3">
        <strong>Parecer pendente.</strong> Envie 2 fotos (1 de referência do
        cadastro + 1 atual da verificação) para o Motor 1 (Gemini) gerar o
        parecer textual forense.
        <br />
        <span className="text-[var(--fg-muted)]">
          As fotos <strong>não são persistidas</strong> (ADR-009) — só são usadas
          em memória para gerar o parecer.
        </span>
      </div>

      <DocumentUploader
        arquivos={arquivos}
        onAdd={(novos) =>
          setArquivos([...arquivos, ...novos].slice(0, 2))
        }
        onRemove={(idx) => setArquivos(arquivos.filter((_, i) => i !== idx))}
        max={2}
      />

      {arquivos.length > 0 && (
        <div className="mt-3 text-xs text-[var(--fg-muted)]">
          {arquivos.length === 1
            ? "⚠ Envie mais 1 imagem (a atual da verificação)."
            : "✓ 2 imagens prontas: a primeira será a referência."}
        </div>
      )}

      {erro && (
        <div className="mt-3 text-xs text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger)] rounded px-3 py-2">
          {erro}
        </div>
      )}

      <button
        onClick={gerar}
        disabled={enviando || arquivos.length !== 2}
        className="btn-primary mt-3"
      >
        {enviando
          ? "Gerando parecer com IA..."
          : "Gerar parecer (Motor 1)"}
      </button>
    </div>
  );
}

// --- Componente: Linha de ponto anatomico ---

function LinhaPonto({ ponto }: { ponto: PontoAnatomico }) {
  const status = (ponto.status ?? "").toLowerCase();
  const cor =
    status === "igual"
      ? "success"
      : status === "diferente"
        ? "danger"
        : "warning";
  const observacao = ponto.observacao ?? "";
  return (
    <div className="grid grid-cols-12 gap-2 px-2 py-2 text-sm border-t border-[var(--border-subtle)] items-center">
      <div className="col-span-4 text-[var(--fg-primary)]">
        {ponto.item}
      </div>
      <div className="col-span-2">
        <span className={`badge badge-${cor}`}>
          {ponto.status}
        </span>
      </div>
      <div className="col-span-6 text-xs text-[var(--fg-secondary)]">
        {observacao}
      </div>
    </div>
  );
}

// --- Componente: Barra de similaridade visual ---

function BarraSimilaridade({ score, limiar }: { score: number; limiar: number }) {
  const pct = (n: number) => `${Math.min(100, Math.max(0, n * 100))}%`;
  const zonaCinzentaStart = limiar * 0.85;

  return (
    <div className="relative h-8 bg-[var(--bg-input)] rounded border border-[var(--border-subtle)] overflow-hidden">
      {/* Zona de rejeicao (vermelho) */}
      <div
        className="absolute inset-y-0 left-0 bg-[var(--danger-bg)]"
        style={{ width: pct(zonaCinzentaStart) }}
      />
      {/* Zona cinzenta (amarelo) */}
      <div
        className="absolute inset-y-0 bg-[var(--warning-bg)]"
        style={{
          left: pct(zonaCinzentaStart),
          width: `calc(${pct(limiar)} - ${pct(zonaCinzentaStart)})`,
        }}
      />
      {/* Zona de aprovacao (verde) */}
      <div
        className="absolute inset-y-0 bg-[var(--success-bg)]"
        style={{
          left: pct(limiar),
          right: 0,
        }}
      />
      {/* Linha do limiar */}
      <div
        className="absolute inset-y-0 w-0.5 bg-[var(--accent-cyan)]"
        style={{ left: pct(limiar) }}
      />
      {/* Marcador do score */}
      <div
        className="absolute inset-y-0 w-1 bg-[var(--fg-primary)] shadow-lg"
        style={{ left: `calc(${pct(score)} - 2px)` }}
      />
    </div>
  );
}

// --- Helpers / Subcomponents ---

function Def({
  titulo,
  valor,
  mono,
  destaque,
}: {
  titulo: string;
  valor?: string | null;
  mono?: boolean;
  destaque?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] text-[var(--fg-muted)] uppercase tracking-wider mb-0.5">
        {titulo}
      </dt>
      <dd
        className={`${mono ? "font-mono" : ""} ${
          destaque ? "text-[var(--accent-cyan)] font-semibold" : ""
        }`}
      >
        {valor || "—"}
      </dd>
    </div>
  );
}

function corDeDecisao(decisao: string): { fg: string; bg: string } {
  const d = decisao.toUpperCase();
  if (d === "AUTENTICADO")
    return { fg: "var(--success)", bg: "var(--success-bg)" };
  if (d === "REJEITADO" || d === "ERRO")
    return { fg: "var(--danger)", bg: "var(--danger-bg)" };
  if (d === "INCONCLUSIVO")
    return { fg: "var(--warning)", bg: "var(--warning-bg)" };
  return { fg: "var(--fg-primary)", bg: "var(--bg-elevated)" };
}

function gerarAssinatura(laudo: LaudoResponse): string {
  // Hash pseudo-aleatorio deterministico a partir dos dados do laudo (so para display).
  const s = `${laudo.logId}:${laudo.motor}:${laudo.criadoEm}:${laudo.decisao}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return (
    Math.abs(h).toString(16).padStart(8, "0") +
    "-" +
    laudo.logId.toString(16).padStart(4, "0")
  ).toUpperCase();
}

function traduzErro(e: any): string {
  const codigo = e?.codigo ?? "";
  const map: Record<string, string> = {
    LOG_NAO_ENCONTRADO: "Log biométrico não encontrado.",
    GEMINI_NAO_CONFIGURADO:
      "Motor 1 (Gemini) não configurado. Defina a API key.",
    MOTOR1_FALHOU: "Falha ao chamar Motor 1 (Gemini).",
    REFERENCIA_AUSENTE: "Envie a imagem de referência.",
    ATUAL_AUSENTE: "Envie a imagem atual.",
    MIME_NAO_SUPORTADO: "Formato não suportado (use JPG/PNG/WEBP).",
    IMAGEM_MUITO_GRANDE: "Imagem maior que 10 MB.",
  };
  return map[codigo] ?? e?.message ?? "Erro inesperado.";
}
