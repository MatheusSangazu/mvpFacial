"use client";

// Pagina /admin - painel administrativo do MVP.
// Lista usuarios cadastrados, permite buscar, ver detalhes e excluir (LGPD).
// Mostra tambem metricas gerais (total de contas, vetores, logs) e ultimos logs de auditoria.
//
// AVISO: este painel e um MVP sem autenticacao. O backend expe os endpoints
// /api/admin/* com [AllowAnonymous] apenas para a demo local (AdminController).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type ListarUsuariosResponse,
  type DetalhesUsuarioResponse,
  type ListarLogsResponse,
  type ExcluirUsuarioResponse,
} from "@/lib/api";
import {
  mascararCpfParcial,
  formatarDataHora,
  formatarLatencia,
} from "@/lib/format";

type Aba = "usuarios" | "logs";

export default function AdminPage() {
  const [aba, setAba] = useState<Aba>("usuarios");
  const [busca, setBusca] = useState("");
  const [dados, setDados] = useState<ListarUsuariosResponse | null>(null);
  const [logsData, setLogsData] = useState<ListarLogsResponse | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [detalhe, setDetalhe] = useState<DetalhesUsuarioResponse | null>(null);
  const [exclusao, setExclusao] = useState<ExcluirUsuarioResponse | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const [u, l] = await Promise.all([
        api.listarUsuarios(busca || undefined, 100),
        api.listarLogs(50),
      ]);
      setDados(u);
      setLogsData(l);
    } catch (e: any) {
      setErro(e?.message ?? "Falha ao carregar dados.");
    } finally {
      setCarregando(false);
    }
  }, [busca]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function verDetalhes(id: number) {
    setCarregando(true);
    setErro("");
    try {
      const d = await api.obterUsuario(id);
      setDetalhe(d);
    } catch (e: any) {
      setErro(e?.message ?? "Falha ao carregar detalhes.");
    } finally {
      setCarregando(false);
    }
  }

  async function excluirUsuario(id: number, nome: string) {
    if (!confirm(`Confirmar exclusão de "${nome}"?\n\nIsto remove vetores faciais, documentos e anonimiza logs (LGPD).`))
      return;
    setConfirmando(id);
    setErro("");
    try {
      const r = await api.excluirUsuario(id);
      setExclusao(r);
      setConfirmando(null);
      await carregar();
    } catch (e: any) {
      setErro(e?.message ?? "Falha ao excluir usuário.");
      setConfirmando(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <header className="mb-6 flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Painel administrativo</h1>
          <p className="text-sm text-[var(--fg-secondary)] mt-1">
            MVP · sem autenticação (use apenas em ambiente local).
          </p>
        </div>
        <button onClick={carregar} className="btn-secondary" disabled={carregando}>
          {carregando ? "Atualizando..." : "↻ Atualizar"}
        </button>
      </header>

      {/* Metricas gerais */}
      {dados && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <CardMetrica label="Usuários" valor={dados.total} destaque />
          <CardMetrica label="Vetores faciais" valor={dados.totalVetores} />
          <CardMetrica label="Logs biométricos" valor={dados.totalLogs} />
          <CardMetrica
            label="Média vetores/usuário"
            valor={dados.total > 0 ? (dados.totalVetores / dados.total).toFixed(1) : "—"}
          />
        </div>
      )}

      {/* Aviso / erro */}
      {erro && (
        <div className="mb-4 text-sm text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger)] rounded px-3 py-2">
          {erro}
        </div>
      )}

      {/* Banner de exclusao bem sucedida */}
      {exclusao && (
        <div className="mb-4 p-3 bg-[var(--success-bg)] border border-[var(--success)] rounded text-sm text-[var(--success)] flex items-start justify-between gap-3">
          <div>
            <strong>✓ Conta excluída:</strong> {exclusao.nome} (#{exclusao.usuarioId}).
            {" "}
            {exclusao.vetoresRemovidos} vetores, {exclusao.documentosRemovidos} docs removidos,
            {" "}
            {exclusao.logsAnonimizados} logs anonimizados.
          </div>
          <button
            onClick={() => setExclusao(null)}
            className="text-[var(--success)] hover:underline text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Abas */}
      <div className="card mb-4">
        <div className="flex gap-2 border-b border-[var(--border-subtle)]">
          <AbaBtn
            ativo={aba === "usuarios"}
            onClick={() => setAba("usuarios")}
            label={`Usuários${dados ? ` (${dados.total})` : ""}`}
          />
          <AbaBtn
            ativo={aba === "logs"}
            onClick={() => setAba("logs")}
            label={`Logs de auditoria${logsData ? ` (${logsData.retornados})` : ""}`}
          />
        </div>

        {/* Aba usuarios */}
        {aba === "usuarios" && (
          <div className="p-4">
            <div className="mb-4 flex gap-2">
              <input
                className="input"
                placeholder="Buscar por nome ou CPF..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && carregar()}
              />
              <button onClick={carregar} className="btn-primary">
                Buscar
              </button>
              {busca && (
                <button
                  onClick={() => {
                    setBusca("");
                    setTimeout(carregar, 50);
                  }}
                  className="btn-secondary"
                >
                  Limpar
                </button>
              )}
            </div>

            {carregando && !dados && (
              <div className="text-center py-8 text-[var(--fg-muted)]">
                Carregando usuários...
              </div>
            )}

            {dados && dados.usuarios.length === 0 && (
              <div className="text-center py-8 text-[var(--fg-muted)]">
                Nenhum usuário encontrado.{" "}
                <Link href="/cadastro" className="text-[var(--accent-cyan)] hover:underline">
                  Cadastre o primeiro →
                </Link>
              </div>
            )}

            {dados && dados.usuarios.length > 0 && (
              <div className="overflow-x-auto">
                <TabelaUsuarios
                  usuarios={dados.usuarios}
                  onVerDetalhes={verDetalhes}
                  onExcluir={excluirUsuario}
                  confirmando={confirmando}
                />
              </div>
            )}
          </div>
        )}

        {/* Aba logs */}
        {aba === "logs" && (
          <div className="p-4">
            {carregando && !logsData && (
              <div className="text-center py-8 text-[var(--fg-muted)]">
                Carregando logs...
              </div>
            )}
            {logsData && logsData.logs.length === 0 && (
              <div className="text-center py-8 text-[var(--fg-muted)]">
                Nenhum log biométrico registrado.
              </div>
            )}
            {logsData && logsData.logs.length > 0 && (
              <TabelaLogs logs={logsData.logs} />
            )}
          </div>
        )}
      </div>

      <div className="text-xs text-[var(--fg-muted)] text-center">
        <Link href="/" className="hover:text-[var(--fg-primary)]">
          ← Voltar ao início
        </Link>
      </div>

      {/* Modal de detalhes */}
      {detalhe && (
        <ModalDetalhe
          dados={detalhe}
          onClose={() => setDetalhe(null)}
          onExcluir={(id, nome) => {
            setDetalhe(null);
            excluirUsuario(id, nome);
          }}
        />
      )}
    </div>
  );
}

// --- Tabela de usuarios ---

function TabelaUsuarios({
  usuarios,
  onVerDetalhes,
  onExcluir,
  confirmando,
}: {
  usuarios: ListarUsuariosResponse["usuarios"];
  onVerDetalhes: (id: number) => void;
  onExcluir: (id: number, nome: string) => void;
  confirmando: number | null;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--fg-muted)] border-b border-[var(--border-subtle)]">
          <th className="py-2 px-2">ID</th>
          <th className="py-2 px-2">Nome</th>
          <th className="py-2 px-2">CPF</th>
          <th className="py-2 px-2 text-center">Vetores</th>
          <th className="py-2 px-2 text-center">Docs</th>
          <th className="py-2 px-2 text-center">Logs</th>
          <th className="py-2 px-2">Criado em</th>
          <th className="py-2 px-2 text-right">Ações</th>
        </tr>
      </thead>
      <tbody>
        {usuarios.map((u) => (
          <tr
            key={u.id}
            className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]"
          >
            <td className="py-2 px-2 font-mono text-xs text-[var(--fg-muted)]">
              #{u.id}
            </td>
            <td className="py-2 px-2">
              <div className="font-medium">{u.nome}</div>
              {u.nomeMae && (
                <div className="text-xs text-[var(--fg-muted)]">
                  mãe: {u.nomeMae}
                </div>
              )}
            </td>
            <td className="py-2 px-2 font-mono text-xs">
              {mascararCpfParcial(u.cpf)}
            </td>
            <td className="py-2 px-2 text-center">
              <span
                className={`badge ${u.totalVetores > 0 ? "badge-success" : "badge-muted"}`}
              >
                {u.totalVetores}
              </span>
            </td>
            <td className="py-2 px-2 text-center">
              <span
                className={`badge ${u.totalDocumentos > 0 ? "badge-info" : "badge-muted"}`}
              >
                {u.totalDocumentos}
              </span>
            </td>
            <td className="py-2 px-2 text-center font-mono text-xs text-[var(--fg-muted)]">
              {u.totalLogs}
            </td>
            <td className="py-2 px-2 text-xs text-[var(--fg-secondary)]">
              {formatarDataHora(u.criadoEm)}
            </td>
            <td className="py-2 px-2 text-right space-x-2 whitespace-nowrap">
              <button
                onClick={() => onVerDetalhes(u.id)}
                className="text-xs text-[var(--accent-cyan)] hover:underline"
              >
                Detalhes
              </button>
              <button
                onClick={() => onExcluir(u.id, u.nome)}
                disabled={confirmando === u.id}
                className="text-xs text-[var(--danger)] hover:underline disabled:opacity-50"
              >
                {confirmando === u.id ? "..." : "Excluir"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Tabela de logs ---

function TabelaLogs({ logs }: { logs: ListarLogsResponse["logs"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--fg-muted)] border-b border-[var(--border-subtle)]">
            <th className="py-2 px-2">Log</th>
            <th className="py-2 px-2">Operação</th>
            <th className="py-2 px-2">Usuário</th>
            <th className="py-2 px-2 text-center">Motor</th>
            <th className="py-2 px-2 text-center">Resultado</th>
            <th className="py-2 px-2 text-center">Score</th>
            <th className="py-2 px-2 text-center">Limiar</th>
            <th className="py-2 px-2 text-center">Latência</th>
            <th className="py-2 px-2 text-center">Liveness</th>
            <th className="py-2 px-2">Quando</th>
            <th className="py-2 px-2"></th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr
              key={l.id}
              className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]"
            >
              <td className="py-2 px-2 font-mono text-xs text-[var(--fg-muted)]">
                #{l.id}
              </td>
              <td className="py-2 px-2">
                <span
                  className={`badge ${l.operacao === "login" ? "badge-info" : "badge-muted"}`}
                >
                  {l.operacao}
                </span>
              </td>
              <td className="py-2 px-2 text-xs">
                {l.nomeUsuario ?? (l.usuarioId ? `#${l.usuarioId}` : "—")}
              </td>
              <td className="py-2 px-2 text-center font-mono text-xs">M{l.motor}</td>
              <td className="py-2 px-2 text-center">
                {l.erro ? (
                  <span className="badge badge-danger">ERRO</span>
                ) : l.autenticado ? (
                  <span className="badge badge-success">✓</span>
                ) : l.score != null && l.limiar != null && l.score >= l.limiar ? (
                  <span className="badge badge-warning">INCONCL.</span>
                ) : (
                  <span className="badge badge-danger">✕</span>
                )}
              </td>
              <td className="py-2 px-2 text-center font-mono text-xs">
                {l.score?.toFixed(4) ?? "—"}
              </td>
              <td className="py-2 px-2 text-center font-mono text-xs text-[var(--fg-muted)]">
                {l.limiar?.toFixed(2) ?? "—"}
              </td>
              <td className="py-2 px-2 text-center font-mono text-xs text-[var(--fg-muted)]">
                {formatarLatencia(l.latenciaMs)}
              </td>
              <td className="py-2 px-2 text-center">
                {l.livenessOk == null ? (
                  <span className="text-[var(--fg-muted)] text-xs">—</span>
                ) : l.livenessOk ? (
                  <span className="badge badge-success">OK</span>
                ) : (
                  <span className="badge badge-danger">FAIL</span>
                )}
              </td>
              <td className="py-2 px-2 text-xs text-[var(--fg-secondary)]">
                {formatarDataHora(l.criadoEm)}
              </td>
              <td className="py-2 px-2 text-right">
                <Link
                  href={`/laudo/${l.id}`}
                  className="text-xs text-[var(--accent-cyan)] hover:underline"
                >
                  Laudo →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Modal de detalhes ---

function ModalDetalhe({
  dados,
  onClose,
  onExcluir,
}: {
  dados: DetalhesUsuarioResponse;
  onClose: () => void;
  onExcluir: (id: number, nome: string) => void;
}) {
  const { usuario, vetores, documentos, logs } = dados;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-panel)] border border-[var(--border-strong)] rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between sticky top-0 bg-[var(--bg-panel)] z-10">
          <div>
            <h3 className="text-lg font-bold">{usuario.nome}</h3>
            <p className="text-xs text-[var(--fg-muted)] font-mono">
              ID #{usuario.id} · {mascararCpfParcial(usuario.cpf)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--fg-muted)] hover:text-[var(--fg-primary)] text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Dados pessoais */}
          <section>
            <h4 className="text-xs uppercase tracking-wider text-[var(--fg-muted)] mb-2">
              Dados pessoais
            </h4>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Def titulo="Nascimento" valor={usuario.dataNascimento?.slice(0, 10)} mono />
              <Def titulo="Nome da mãe" valor={usuario.nomeMae} />
              <Def titulo="Termo" valor={usuario.termoVersao} mono />
              <Def titulo="Consentimento" valor={usuario.consentimentoAceito ? "Sim" : "Não"} />
              <Def titulo="Criado em" valor={formatarDataHora(usuario.criadoEm)} mono />
            </dl>
          </section>

          {/* Vetores faciais */}
          <section>
            <h4 className="text-xs uppercase tracking-wider text-[var(--fg-muted)] mb-2">
              Vetores faciais ({vetores.length})
            </h4>
            {vetores.length === 0 ? (
              <p className="text-sm text-[var(--fg-muted)]">
                Nenhum vetor facial cadastrado.
              </p>
            ) : (
              <div className="space-y-1">
                {vetores.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between p-2 bg-[var(--bg-elevated)] rounded text-xs"
                  >
                    <span className="font-mono text-[var(--fg-muted)]">
                      #{v.id} · {v.modelo ?? "Facenet"} · pose {v.pose ?? "—"}
                    </span>
                    <span className="text-[var(--fg-muted)] font-mono">
                      {formatarDataHora(v.criadoEm)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Documentos */}
          <section>
            <h4 className="text-xs uppercase tracking-wider text-[var(--fg-muted)] mb-2">
              Documentos cadastrados ({documentos.length})
            </h4>
            {documentos.length === 0 ? (
              <p className="text-sm text-[var(--fg-muted)]">
                Nenhum documento persistido.
              </p>
            ) : (
              <div className="space-y-2">
                {documentos.map((d) => (
                  <details key={d.id} className="border border-[var(--border-subtle)] rounded">
                    <summary className="p-2 cursor-pointer hover:bg-[var(--bg-elevated)] flex items-center justify-between">
                      <span className="text-sm">
                        <span className="badge badge-info mr-2">
                          {d.tipoDocumento}
                        </span>
                        {d.nomeArquivo ?? "—"}
                      </span>
                      <span className="text-xs text-[var(--fg-muted)] font-mono">
                        confiança {d.confiancaExtracao ?? "—"} · {formatarDataHora(d.criadoEm)}
                      </span>
                    </summary>
                    <pre className="p-2 bg-[var(--bg-input)] text-[10px] font-mono overflow-x-auto max-h-48">
{(() => {
  try {
    return JSON.stringify(JSON.parse(d.dadosExtraidosJson || "{}"), null, 2);
  } catch {
    return d.dadosExtraidosJson;
  }
})()}
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </section>

          {/* Logs */}
          <section>
            <h4 className="text-xs uppercase tracking-wider text-[var(--fg-muted)] mb-2">
              Logs biométricos recentes ({logs.length})
            </h4>
            {logs.length === 0 ? (
              <p className="text-sm text-[var(--fg-muted)]">
                Nenhuma operação biométrica registrada.
              </p>
            ) : (
              <div className="overflow-x-auto max-h-60 overflow-y-auto border border-[var(--border-subtle)] rounded">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--bg-elevated)] sticky top-0">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
                      <th className="py-1.5 px-2">Log</th>
                      <th className="py-1.5 px-2">Op</th>
                      <th className="py-1.5 px-2 text-center">M</th>
                      <th className="py-1.5 px-2 text-center">Result</th>
                      <th className="py-1.5 px-2 text-center">Score</th>
                      <th className="py-1.5 px-2">Quando</th>
                      <th className="py-1.5 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id} className="border-t border-[var(--border-subtle)]">
                        <td className="py-1.5 px-2 font-mono text-[var(--fg-muted)]">#{l.id}</td>
                        <td className="py-1.5 px-2">{l.operacao}</td>
                        <td className="py-1.5 px-2 text-center font-mono">{l.motor}</td>
                        <td className="py-1.5 px-2 text-center">
                          {l.autenticado ? "✓" : l.erro ? "ERR" : "✕"}
                        </td>
                        <td className="py-1.5 px-2 text-center font-mono">
                          {l.score?.toFixed(3) ?? "—"}
                        </td>
                        <td className="py-1.5 px-2 text-[var(--fg-muted)]">
                          {formatarDataHora(l.criadoEm)}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <Link
                            href={`/laudo/${l.id}`}
                            className="text-[var(--accent-cyan)] hover:underline"
                          >
                            laudo
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Acao destrutiva */}
          <section className="pt-3 border-t border-[var(--border-subtle)]">
            <button
              onClick={() => onExcluir(usuario.id, usuario.nome)}
              className="btn-danger"
            >
              Excluir usuário (LGPD)
            </button>
            <p className="text-xs text-[var(--fg-muted)] mt-2">
              Remove vetores faciais, documentos e anonimiza logs (mantém métricas agregadas).
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

// --- Subcomponentes ---

function CardMetrica({
  label,
  valor,
  destaque,
}: {
  label: string;
  valor: number | string;
  destaque?: boolean;
}) {
  return (
    <div className="card-elevated p-4">
      <div className="text-[10px] text-[var(--fg-muted)] uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={`text-2xl font-bold font-mono ${
          destaque ? "text-[var(--accent-cyan)]" : "text-[var(--fg-primary)]"
        }`}
      >
        {valor}
      </div>
    </div>
  );
}

function AbaBtn({
  ativo,
  onClick,
  label,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        ativo
          ? "border-[var(--accent-cyan)] text-[var(--accent-cyan)]"
          : "border-transparent text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
      }`}
    >
      {label}
    </button>
  );
}

function Def({
  titulo,
  valor,
  mono,
}: {
  titulo: string;
  valor?: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] text-[var(--fg-muted)] uppercase tracking-wider mb-0.5">
        {titulo}
      </dt>
      <dd className={`text-sm ${mono ? "font-mono" : ""}`}>{valor || "—"}</dd>
    </div>
  );
}
