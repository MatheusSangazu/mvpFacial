"use client";

// Pagina de Cadastro / Pre-matricula - wizard de 4 etapas.
// Etapa 1: Dados pessoais (apenas memoria, sem persistencia)
// Etapa 2: RG/CNH -> extrai identidade e compara com dados da etapa 1
// Etapa 3: Comprovante de residencia -> extrai endereco e titular
// Etapa 4: Captura facial + submit final:
//          a) POST /api/auth/cadastro (cria usuario + JWT + persiste documentos)
//          b) POST /api/biometria/cadastrar (cadastra vetores)
//
// Justificativa: nada persiste antes do submit final. Voltar entre etapas
// nao deixa residuo no banco (bug de CPF_JA_CADASTRADO corrigido).
import { useState } from "react";
import Link from "next/link";
import DocumentUploader from "@/components/DocumentUploader";
import CameraCapture, { type FotoCapturada } from "@/components/CameraCapture";
import {
  api,
  setToken,
  type Usuario,
  type DocumentoExtraido,
  type DocumentoCadastradoDto,
} from "@/lib/api";
import { mascararCpf, normalizarCpf, validarCpf, formatarData } from "@/lib/format";

type Step = 1 | 2 | 3 | 4 | 5;

interface DadosForm {
  nome: string;
  cpf: string;
  dataNascimento: string;
  nomeMae: string;
  consentimento: boolean;
}

export default function CadastroPage() {
  const [step, setStep] = useState<Step>(1);
  const [dados, setDados] = useState<DadosForm>({
    nome: "",
    cpf: "",
    dataNascimento: "",
    nomeMae: "",
    consentimento: false,
  });
  const [identidade, setIdentidade] = useState<DocumentoExtraido | null>(null);
  const [comprovante, setComprovante] = useState<DocumentoExtraido | null>(null);
  const [fotos, setFotos] = useState<FotoCapturada[]>([]);
  const [pose, setPose] = useState<"frente" | "esquerda" | "direita">("frente");
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [resultadoBiometria, setResultadoBiometria] = useState<any>(null);

  function irPara(s: Step) {
    setStep(s);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Stepper step={step} />

      {step === 1 && (
        <StepDados
          dados={dados}
          setDados={setDados}
          onProximo={() => irPara(2)}
        />
      )}

      {step === 2 && (
        <StepIdentidade
          dados={dados}
          identidade={identidade}
          setIdentidade={setIdentidade}
          onAnterior={() => irPara(1)}
          onProximo={() => irPara(3)}
        />
      )}

      {step === 3 && (
        <StepComprovante
          dados={dados}
          identidade={identidade}
          comprovante={comprovante}
          setComprovante={setComprovante}
          onAnterior={() => irPara(2)}
          onProximo={() => irPara(4)}
        />
      )}

      {step === 4 && (
        <StepBiometria
          dados={dados}
          identidade={identidade}
          comprovante={comprovante}
          fotos={fotos}
          setFotos={setFotos}
          pose={pose}
          setPose={setPose}
          onAnterior={() => irPara(3)}
          onConcluido={(u, r) => {
            setUsuario(u);
            setResultadoBiometria(r);
            irPara(5);
          }}
        />
      )}

      {step === 5 && usuario && resultadoBiometria && (
        <StepSucesso
          usuario={usuario}
          identidade={identidade}
          comprovante={comprovante}
          resultadoBiometria={resultadoBiometria}
          onReiniciar={() => {
            setDados({
              nome: "",
              cpf: "",
              dataNascimento: "",
              nomeMae: "",
              consentimento: false,
            });
            setIdentidade(null);
            setComprovante(null);
            setFotos([]);
            setUsuario(null);
            setResultadoBiometria(null);
            irPara(1);
          }}
        />
      )}
    </div>
  );
}

// --- Stepper ---

function Stepper({ step }: { step: Step }) {
  const labels: Record<Step, string> = {
    1: "Dados pessoais",
    2: "RG / CNH",
    3: "Comprovante",
    4: "Biometria facial",
    5: "Concluído",
  };
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="flex-1 flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono border shrink-0 ${
                step === n
                  ? "bg-[var(--accent-cyan)] text-[#00141a] border-[var(--accent-cyan)]"
                  : step > n
                    ? "bg-[var(--success-bg)] text-[var(--success)] border-[var(--success)]"
                    : "bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border-subtle)]"
              }`}
            >
              {step > n ? "✓" : n}
            </div>
            {n < 5 && (
              <div
                className={`flex-1 h-px ${step > n ? "bg-[var(--success)]" : "bg-[var(--border-subtle)]"}`}
              />
            )}
          </div>
        ))}
      </div>
      <div className="text-sm font-medium">{labels[step]}</div>
    </div>
  );
}

// --- Etapa 1: Dados ---

function StepDados({
  dados,
  setDados,
  onProximo,
}: {
  dados: DadosForm;
  setDados: (d: DadosForm) => void;
  onProximo: () => void;
}) {
  const cpfValido = validarCpf(dados.cpf);
  const podeAvancar =
    dados.nome.trim().length >= 3 && cpfValido && dados.consentimento;

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-1">Dados pessoais</h2>
      <p className="text-sm text-[var(--fg-secondary)] mb-6">
        Estes dados serão cruzados com o RG/CNH na próxima etapa. Nada é salvo
        ainda — você pode voltar e corrigir quando quiser.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Nome completo" className="md:col-span-2">
          <input
            className="input"
            value={dados.nome}
            onChange={(e) => setDados({ ...dados, nome: e.target.value })}
            placeholder="Ex.: Maria Silva"
          />
        </Field>
        <Field
          label="CPF"
          hint={dados.cpf && !cpfValido ? "CPF inválido" : undefined}
        >
          <input
            className="input font-mono"
            value={dados.cpf}
            onChange={(e) => setDados({ ...dados, cpf: mascararCpf(e.target.value) })}
            placeholder="000.000.000-00"
            inputMode="numeric"
          />
        </Field>
        <Field label="Data de nascimento">
          <input
            type="date"
            className="input"
            value={dados.dataNascimento}
            onChange={(e) =>
              setDados({ ...dados, dataNascimento: e.target.value })
            }
          />
        </Field>
        <Field label="Nome da mãe" className="md:col-span-2">
          <input
            className="input"
            value={dados.nomeMae}
            onChange={(e) => setDados({ ...dados, nomeMae: e.target.value })}
            placeholder="Nome completo da mãe"
          />
        </Field>
      </div>

      <label className="flex items-start gap-3 mt-6 cursor-pointer">
        <input
          type="checkbox"
          checked={dados.consentimento}
          onChange={(e) =>
            setDados({ ...dados, consentimento: e.target.checked })
          }
          className="mt-1 w-4 h-4 accent-[var(--accent-cyan)]"
        />
        <span className="text-sm text-[var(--fg-secondary)]">
          Li e aceito o{" "}
          <a href="#" className="text-[var(--accent-cyan)] hover:underline">
            termo de consentimento LGPD (v1.0)
          </a>
          . Autorizo a coleta e tratamento dos meus dados pessoais, documentos e
          biométricos (vetor facial cifrado) para fins de cadastro e
          autenticação.
        </span>
      </label>

      <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--border-subtle)]">
        <Link
          href="/"
          className="text-sm text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
        >
          ← Cancelar
        </Link>
        <button
          onClick={onProximo}
          className="btn-primary"
          disabled={!podeAvancar}
        >
          Continuar para documentos →
        </button>
      </div>
    </div>
  );
}

// --- Etapa 2: Identidade (RG/CNH) ---

function StepIdentidade({
  dados,
  identidade,
  setIdentidade,
  onAnterior,
  onProximo,
}: {
  dados: DadosForm;
  identidade: DocumentoExtraido | null;
  setIdentidade: (d: DocumentoExtraido | null) => void;
  onAnterior: () => void;
  onProximo: () => void;
}) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function extrair() {
    setErro("");
    setEnviando(true);
    setIdentidade(null);
    try {
      const r = await api.extrairIdentidade(arquivos);
      setIdentidade(r);
    } catch (e: any) {
      if (e.codigo === "VALIDACAO_CAMADA1" && e.data?.documento) {
        setIdentidade(e.data.documento);
        setErro("A extração encontrou problemas. Verifique os campos com 'X' e tente enviar fotos mais nítidas (frente e verso).");
      } else {
        setErro(traduzErro(e));
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-1">Documento de identidade</h2>
      <p className="text-sm text-[var(--fg-secondary)] mb-6">
        Envie fotos do seu <strong>RG</strong> ou <strong>CNH</strong>. É altamente recomendado enviar <strong>frente e verso</strong> para capturar todos os dados. A IA (Gemini 3) vai extrair nome, CPF, nascimento e nome da mãe para comparar com o que você digitou.
      </p>

      <DocumentUploader
        arquivos={arquivos}
        onAdd={(novos) => setArquivos([...arquivos, ...novos])}
        onRemove={(idx) => setArquivos(arquivos.filter((_, i) => i !== idx))}
        max={3}
      />

      {arquivos.length > 0 && !identidade && (
        <button
          onClick={extrair}
          disabled={enviando || arquivos.length === 0}
          className="btn-primary mt-4"
        >
          {enviando
            ? "Extraindo com IA..."
            : `Extrair dados de ${arquivos.length} imagem(ns)`}
        </button>
      )}

      {identidade && (
        <ComparacaoIdentidade dados={dados} doc={identidade} />
      )}

      {erro && (
        <div className="mt-4 text-sm text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger)] rounded px-3 py-2">
          {erro}
        </div>
      )}

      <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--border-subtle)]">
        <button onClick={onAnterior} className="btn-secondary">
          ← Voltar
        </button>
        <button 
          onClick={onProximo} 
          className="btn-primary"
          disabled={!identidade || erro !== ""}
        >
          Continuar para comprovante →
        </button>
      </div>
    </div>
  );
}

function ComparacaoIdentidade({
  dados,
  doc,
}: {
  dados: DadosForm;
  doc: DocumentoExtraido;
}) {
  const comparacoes = [
    {
      campo: "Nome",
      esperado: dados.nome,
      extraido: doc.nome,
    },
    {
      campo: "CPF",
      esperado: normalizarCpf(dados.cpf),
      extraido: doc.cpf?.replace(/\D/g, "") ?? "",
    },
    {
      campo: "Nascimento",
      esperado: dados.dataNascimento,
      extraido: doc.dataNascimento?.slice(0, 10) ?? "",
    },
    {
      campo: "Nome da mãe",
      esperado: dados.nomeMae,
      extraido: doc.nomeMae,
    },
  ];

  return (
    <div className="mt-6 card-elevated p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Dados extraídos pela IA</h3>
        <span className="badge badge-info">
          Confiança: {((doc.confianca ?? 0) * 100).toFixed(0)}%
        </span>
      </div>

      <div className="space-y-1.5 mb-3">
        <div className="grid grid-cols-12 gap-2 text-xs text-[var(--fg-muted)] uppercase tracking-wider px-2">
          <div className="col-span-3">Campo</div>
          <div className="col-span-4">Você digitou</div>
          <div className="col-span-4">IA extraiu</div>
          <div className="col-span-1 text-right">OK?</div>
        </div>
        {comparacoes.map((c) => {
          const match =
            c.esperado.trim().toLowerCase() ===
            (c.extraido ?? "").trim().toLowerCase();
          return (
            <div
              key={c.campo}
              className="grid grid-cols-12 gap-2 px-2 py-1.5 text-sm border-t border-[var(--border-subtle)] items-center"
            >
              <div className="col-span-3 text-[var(--fg-muted)]">{c.campo}</div>
              <div className="col-span-4 font-mono text-xs truncate">
                {c.esperado || "—"}
              </div>
              <div className="col-span-4 font-mono text-xs truncate">
                {c.extraido || "—"}
              </div>
              <div className="col-span-1 text-right">
                {match ? (
                  <span className="badge badge-success">✓</span>
                ) : (
                  <span className="badge badge-danger">✕</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <details className="text-xs">
        <summary className="text-[var(--fg-muted)] cursor-pointer hover:text-[var(--accent-cyan)]">
          Ver todos os campos extraídos
        </summary>
        <pre className="mt-2 p-2 bg-[var(--bg-input)] rounded overflow-x-auto font-mono text-[10px]">
{JSON.stringify(doc, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// --- Etapa 3: Comprovante de residencia ---

function StepComprovante({
  dados,
  identidade,
  comprovante,
  setComprovante,
  onAnterior,
  onProximo,
}: {
  dados: DadosForm;
  identidade: DocumentoExtraido | null;
  comprovante: DocumentoExtraido | null;
  setComprovante: (d: DocumentoExtraido | null) => void;
  onAnterior: () => void;
  onProximo: () => void;
}) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function extrair() {
    setErro("");
    setEnviando(true);
    setComprovante(null);
    try {
      const r = await api.extrairComprovante(arquivos);
      setComprovante(r);
    } catch (e: any) {
      if (e.codigo === "VALIDACAO_CAMADA1" && e.data?.documento) {
        setComprovante(e.data.documento);
        setErro("A extração encontrou problemas. Verifique os campos com 'X' e tente enviar uma foto mais nítida.");
      } else {
        setErro(traduzErro(e));
      }
    } finally {
      setEnviando(false);
    }
  }

  // Comparar titular do comprovante com nome do usuario ou nome da mae
  const titularEsperado = [dados.nome, dados.nomeMae, identidade?.nome]
    .filter(Boolean)
    .map((s) => (s as string).toLowerCase());

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-1">Comprovante de residência</h2>
      <p className="text-sm text-[var(--fg-secondary)] mb-6">
        Envie uma conta de <strong>água, luz, gás, telefone, internet</strong>,
        IPTU ou similar. A IA vai extrair o endereço e o titular da conta.
      </p>

      <DocumentUploader
        arquivos={arquivos}
        onAdd={(novos) => setArquivos([...arquivos, ...novos])}
        onRemove={(idx) => setArquivos(arquivos.filter((_, i) => i !== idx))}
        max={3}
      />

      {arquivos.length > 0 && !comprovante && (
        <button
          onClick={extrair}
          disabled={enviando || arquivos.length === 0}
          className="btn-primary mt-4"
        >
          {enviando
            ? "Extraindo com IA..."
            : `Extrair dados de ${arquivos.length} imagem(ns)`}
        </button>
      )}

      {comprovante && (
        <ResultadoComprovante
          dados={dados}
          doc={comprovante}
          titularEsperado={titularEsperado}
        />
      )}

      {erro && (
        <div className="mt-4 text-sm text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger)] rounded px-3 py-2">
          {erro}
        </div>
      )}

      <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--border-subtle)]">
        <button onClick={onAnterior} className="btn-secondary">
          ← Voltar
        </button>
        <button 
          onClick={onProximo} 
          className="btn-primary"
          disabled={!comprovante || erro !== ""}
        >
          Continuar para biometria →
        </button>
      </div>
    </div>
  );
}

function ResultadoComprovante({
  dados,
  doc,
  titularEsperado,
}: {
  dados: DadosForm;
  doc: DocumentoExtraido;
  titularEsperado: string[];
}) {
  const titularMatch = doc.titular
    ? titularEsperado.some(
        (t) => t.includes(doc.titular!.toLowerCase()) || doc.titular!.toLowerCase().includes(t)
      )
    : false;

  const cpfMatch = doc.cpfTitular
    ? doc.cpfTitular.replace(/\D/g, "") === normalizarCpf(dados.cpf)
    : false;

  const temEndereco = !!(doc.endereco && (doc.endereco.logradouro || doc.endereco.cep));

  return (
    <div className="mt-6 card-elevated p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Comprovante extraído</h3>
        <div className="flex gap-2">
          {doc.tipoComprovante && (
            <span className="badge badge-info uppercase">
              {doc.tipoComprovante}
            </span>
          )}
          <span className="badge badge-info">
            Confiança: {((doc.confianca ?? 0) * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
        <Definicao titulo="Titular" valor={doc.titular} ok={titularMatch} />
        <Definicao titulo="CPF titular" valor={doc.cpfTitular} mono ok={doc.cpfTitular ? cpfMatch : undefined} />
        <Definicao titulo="Emissão" valor={formatarData(doc.dataEmissao)} mono ok={!!doc.dataEmissao} />
        <Definicao titulo="Vencimento" valor={formatarData(doc.dataVencimento)} mono ok={!!doc.dataVencimento} />
        <Definicao titulo="Emitente" valor={doc.emitente} ok={!!doc.emitente} />
        <Definicao titulo="Valor" valor={doc.valor} mono ok={!!doc.valor} />
      </dl>

      {doc.endereco && (
        <div className="mb-3 p-3 bg-[var(--bg-input)] rounded border border-[var(--border-subtle)] relative">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-[var(--fg-muted)] uppercase tracking-wider">
              Endereço
            </div>
            <span className={`badge ${temEndereco ? "badge-success" : "badge-danger"} !py-0 !px-1 text-[10px]`}>
              {temEndereco ? "✓" : "✕"}
            </span>
          </div>
          <div className="text-sm">
            {[
              doc.endereco.logradouro,
              doc.endereco.numero && `, ${doc.endereco.numero}`,
              doc.endereco.complemento,
            ]
              .filter(Boolean)
              .join(" ")}
            <br />
            {[
              doc.endereco.bairro,
              doc.endereco.cidade && ` - ${doc.endereco.cidade}`,
              doc.endereco.uf && `/${doc.endereco.uf}`,
              doc.endereco.cep && ` · CEP ${doc.endereco.cep}`,
            ]
              .filter(Boolean)
              .join(" ")}
          </div>
        </div>
      )}

      <div
        className={`text-xs px-3 py-2 rounded border ${
          titularMatch
            ? "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]"
            : "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning)]"
        }`}
      >
        {titularMatch
          ? "✓ Titular da conta confere com o nome informado"
          : "⚠ Titular da conta NÃO confere com o nome informado — verifique"}
      </div>

      <details className="text-xs mt-3">
        <summary className="text-[var(--fg-muted)] cursor-pointer hover:text-[var(--accent-cyan)]">
          Ver JSON completo
        </summary>
        <pre className="mt-2 p-2 bg-[var(--bg-input)] rounded overflow-x-auto font-mono text-[10px]">
{JSON.stringify(doc, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// --- Etapa 4: Biometria + submit final ---

function StepBiometria({
  dados,
  identidade,
  comprovante,
  fotos,
  setFotos,
  pose,
  setPose,
  onAnterior,
  onConcluido,
}: {
  dados: DadosForm;
  identidade: DocumentoExtraido | null;
  comprovante: DocumentoExtraido | null;
  fotos: FotoCapturada[];
  setFotos: (f: FotoCapturada[]) => void;
  pose: "frente" | "esquerda" | "direita";
  setPose: (p: "frente" | "esquerda" | "direita") => void;
  onAnterior: () => void;
  onConcluido: (usuario: Usuario, resultado: any) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [enviandoMsg, setEnviandoMsg] = useState("");
  const [erro, setErro] = useState("");

  async function submitFinal() {
    setErro("");
    setEnviando(true);
    let usuarioCriadoId: number | null = null;
    try {
      // 1. Monta payload de cadastro incluindo os documentos extraidos
      setEnviandoMsg("Criando conta + persistindo documentos...");
      const documentos: DocumentoCadastradoDto[] = [];
      if (identidade) {
        documentos.push({
          tipoDocumento: identidade.tipoDocumento ?? "Identidade",
          dadosExtraidosJson: JSON.stringify(identidade),
          confianca: identidade.confianca ?? undefined,
        });
      }
      if (comprovante) {
        documentos.push({
          tipoDocumento: "Comprovante",
          dadosExtraidosJson: JSON.stringify(comprovante),
          confianca: comprovante.confianca ?? undefined,
        });
      }

      const cadstroResp = await api.cadastro({
        nome: dados.nome.trim(),
        cpf: normalizarCpf(dados.cpf),
        dataNascimento: dados.dataNascimento || undefined,
        nomeMae: dados.nomeMae.trim() || undefined,
        consentimentoAceito: true,
        documentos,
      });
      usuarioCriadoId = cadstroResp.usuario.id;  // para rollback se a biometria falhar
      setToken(cadstroResp.token);

      // 2. Cadastra biometria facial
      setEnviandoMsg("Processando biometria facial...");
      // Passa poses por foto (na ordem de captura); fallback para a pose "avulsa" se houver
      const posesArr = fotos.map((f) => f.pose ?? pose);
      const bioResp = await api.cadastrarBiometria(
        fotos.map((f) => f.file),
        posesArr.length === 1 ? posesArr[0] : undefined,
        posesArr.length > 1 ? posesArr : undefined,
      );

      onConcluido(
        {
          id: cadstroResp.usuario.id,
          nome: cadstroResp.usuario.nome,
          cpf: cadstroResp.usuario.cpf,
          termoVersao: cadstroResp.usuario.termoVersao,
        },
        bioResp,
      );
    } catch (e: any) {
      // Rollback atomicidade: se o usuario foi criado mas a biometria falhou,
      // exclui a propria conta recem-criada para nao deixar CPF "fantasma" (LGPD + UX).
      // Usa api.excluirConta() (DELETE /api/auth/usuario) com o JWT recem-emitido.
      if (usuarioCriadoId !== null) {
        setEnviandoMsg("Revertendo cadastro (biometria falhou)...");
        try {
          await api.excluirConta();
        } catch {
          // nao tem muito o que fazer se o rollback tambem falhar
        }
      }
      setErro(traduzErro(e));
    } finally {
      setEnviando(false);
      setEnviandoMsg("");
    }
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-1">Captura facial</h2>
      <p className="text-sm text-[var(--fg-secondary)] mb-4">
        Vamos cadastrar <strong>3 fotos</strong> com ângulos diferentes para melhorar
        a precisão do reconhecimento. Os embeddings serão cifrados com AES-256-GCM
        antes de serem gravados (ADR-009).
      </p>

      {/* Guia de sequencia de poses */}
      <div className="mb-4 p-3 bg-[var(--bg-elevated)] rounded border border-[var(--border-subtle)] text-xs">
        <p className="text-[var(--fg-muted)] mb-2 font-mono uppercase tracking-wider">
          Orientações gerais
        </p>
        <ul className="space-y-1 text-[var(--fg-secondary)]">
          <li>• Ambiente iluminado, sem reflexos no rosto</li>
          <li>• Sem óculos escuros, boné ou máscara</li>
          <li>• Expressão neutra na foto frontal; sorriso suave é OK nas laterais</li>
          <li>• A câmera captura sozinha quando o rosto estiver estável</li>
        </ul>
      </div>

      <GuiaPoseAtual totalCapturadas={fotos.length} maxFotos={3} />

      <CameraCapture
        fotos={fotos}
        onAdd={(f) => {
          // Atribui a pose sugerida conforme a ordem de captura (frontal -> esquerda -> direita)
          const ordemPoses = ["frente", "esquerda", "direita"];
          const proximaPose = ordemPoses[fotos.length] ?? "extra";
          setFotos([...fotos, { ...f, pose: proximaPose }]);
        }}
        onRemove={(idx) => setFotos(fotos.filter((_, i) => i !== idx))}
        maxFotos={3}
        autoCapture
        aspectRatio="1:1"
      />

      <p className="mt-3 text-xs text-[var(--fg-muted)]">
        {fotos.length === 0 && "Posição atual: frontal, olhando direto para a câmera."}
        {fotos.length === 1 && "Posição atual: vire levemente a cabeça para a ESQUERDA (~15°)."}
        {fotos.length === 2 && "Posição atual: vire levemente a cabeça para a DIREITA (~15°)."}
        {fotos.length >= 3 && "Você já tem 3 fotos. Pode finalizar o cadastro."}
      </p>

      {erro && (
        <div className="mt-4 text-sm text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger)] rounded px-3 py-2">
          {erro}
        </div>
      )}

      <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--border-subtle)]">
        <button onClick={onAnterior} className="btn-secondary" disabled={enviando}>
          ← Voltar
        </button>
        <button
          onClick={submitFinal}
          className="btn-primary"
          disabled={fotos.length === 0 || enviando}
        >
          {enviando
            ? enviandoMsg || "Processando..."
            : "Criar conta e finalizar cadastro →"}
        </button>
      </div>
    </div>
  );
}

// --- Etapa 5: Sucesso ---

function StepSucesso({
  usuario,
  identidade,
  comprovante,
  resultadoBiometria,
  onReiniciar,
}: {
  usuario: Usuario;
  identidade: DocumentoExtraido | null;
  comprovante: DocumentoExtraido | null;
  resultadoBiometria: any;
  onReiniciar: () => void;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-full bg-[var(--success-bg)] border border-[var(--success)] flex items-center justify-center">
          <span className="text-[var(--success)] text-2xl">✓</span>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Cadastro completo</h2>
          <p className="text-sm text-[var(--fg-secondary)]">
            Conta criada, documentos persistidos e biometria ativa.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="card-elevated p-4">
          <h3 className="text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-3">
            Conta
          </h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Definicao titulo="ID" valor={`#${usuario.id}`} mono />
            <Definicao titulo="Nome" valor={usuario.nome} />
            <Definicao titulo="CPF" valor={mascararCpf(usuario.cpf)} mono />
            <Definicao titulo="Termo" valor={usuario.termoVersao} mono />
          </dl>
        </div>

        <div className="card-elevated p-4">
          <h3 className="text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-3">
            Biometria
          </h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Definicao titulo="Modelo" valor={resultadoBiometria?.modelo} mono />
            <Definicao titulo="Device" valor={resultadoBiometria?.device} mono />
            <Definicao titulo="Vetores" valor={String(resultadoBiometria?.vetoresCriados ?? 0)} mono />
            <Definicao titulo="Latência" valor={`${resultadoBiometria?.latenciaMs ?? 0}ms`} mono />
          </dl>
        </div>
      </div>

      <div className="card-elevated p-4 mb-4">
        <h3 className="text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-3">
          Documentos persistidos
        </h3>
        <div className="flex flex-wrap gap-2">
          {identidade && (
            <span className="badge badge-info">
              ✓ {identidade.tipoDocumento ?? "Identidade"}
            </span>
          )}
          {comprovante && (
            <span className="badge badge-info">
              ✓ Comprovante · {comprovante.tipoComprovante ?? "—"}
            </span>
          )}
          {!identidade && !comprovante && (
            <span className="badge badge-muted">Nenhum documento</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/login" className="btn-primary">
          Testar login facial
        </Link>
        <Link href="/admin" className="btn-secondary">
          Ver no painel admin
        </Link>
        <button onClick={onReiniciar} className="btn-secondary">
          Novo cadastro
        </button>
      </div>
    </div>
  );
}

// --- Helpers ---

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[var(--warning)] mt-1">{hint}</p>}
    </div>
  );
}

// Guia visual da pose esperada na proxima captura do cadastro.
function GuiaPoseAtual({
  totalCapturadas,
  maxFotos,
}: {
  totalCapturadas: number;
  maxFotos: number;
}) {
  const ordem: Array<{ pose: string; titulo: string; desc: string; icone: string }> = [
    { pose: "frente", titulo: "Frontal", desc: "Olho reto, queixo reto", icone: "◉" },
    { pose: "esquerda", titulo: "Esquerda", desc: "Vire ~15° para a esquerda", icone: "←" },
    { pose: "direita", titulo: "Direita", desc: "Vire ~15° para a direita", icone: "→" },
  ];
  const idxAtual = Math.min(totalCapturadas, ordem.length - 1);

  return (
    <div className="mb-4">
      <div className="text-[10px] text-[var(--fg-muted)] uppercase tracking-wider mb-2">
        Sequência de poses ({totalCapturadas}/{maxFotos} capturadas)
      </div>
      <div className="grid grid-cols-3 gap-2">
        {ordem.slice(0, maxFotos).map((p, i) => {
          const capturada = i < totalCapturadas;
          const ehAtual = i === idxAtual && !capturada;
          return (
            <div
              key={p.pose}
              className="p-2 rounded border text-center text-xs"
              style={{
                borderColor: capturada
                  ? "var(--success)"
                  : ehAtual
                    ? "var(--accent-cyan)"
                    : "var(--border-subtle)",
                background: capturada
                  ? "var(--success-bg)"
                  : ehAtual
                    ? "rgba(34,211,238,0.05)"
                    : "transparent",
              }}
            >
              <div className="text-lg font-mono mb-0.5" style={{
                color: capturada ? "var(--success)" : ehAtual ? "var(--accent-cyan)" : "var(--fg-muted)",
              }}>
                {capturada ? "✓" : p.icone}
              </div>
              <div className="font-semibold uppercase tracking-wider"
                style={{ color: capturada || ehAtual ? "var(--fg-primary)" : "var(--fg-muted)" }}
              >
                {p.titulo}
              </div>
              <div className="text-[10px] mt-0.5 text-[var(--fg-secondary)]">
                {p.desc}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Definicao({
  titulo,
  valor,
  mono,
  ok,
}: {
  titulo: string;
  valor?: string | null;
  mono?: boolean;
  ok?: boolean;
}) {
  return (
    <div>
      <dt className="flex items-center gap-2 text-xs text-[var(--fg-muted)] uppercase tracking-wider mb-0.5">
        {titulo}
        {ok !== undefined && (
          <span className={`badge ${ok ? "badge-success" : "badge-danger"} !py-0 !px-1 text-[10px]`}>
            {ok ? "✓" : "✕"}
          </span>
        )}
      </dt>
      <dd className={`text-sm ${mono ? "font-mono" : ""}`}>{valor || "—"}</dd>
    </div>
  );
}

function traduzErro(e: any): string {
  const codigo = e?.codigo ?? "";
  const map: Record<string, string> = {
    CPF_INVALIDO: "CPF inválido (dígitos verificadores não conferem).",
    CPF_JA_CADASTRADO: "Este CPF já está cadastrado no sistema.",
    NOME_OBRIGATORIO: "Nome é obrigatório.",
    CONSENTIMENTO_OBRIGATORIO:
      "Você precisa aceitar o termo de consentimento.",
    TERMO_INDISPONIVEL: "Termo LGPD indisponível. Contate o suporte.",
    MIME_NAO_SUPORTADO: "Tipo de arquivo não suportado.",
    IMAGEM_MUITO_GRANDE: "Arquivo maior que 10 MB.",
    VETORES_JA_EXISTEM: "Este usuário já possui biometria cadastrada.",
    SEM_ROSTO:
      "Nenhum rosto detectado na foto. Tente novamente com melhor iluminação.",
    VISION_FALHOU: "Serviço de visão indisponível. Tente novamente.",
    EXTRACAO_FALHOU: "Não foi possível extrair dados dos documentos enviados.",
    IMAGENS_AUSENTES: "Envie pelo menos uma imagem do documento.",
    VALIDACAO_CAMADA1: "Documento falhou na validação sintática (Camada 1 ADR-006).",
  };
  return map[codigo] ?? e?.message ?? "Erro inesperado. Tente novamente.";
}
