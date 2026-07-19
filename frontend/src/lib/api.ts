// Cliente HTTP para o backend (http://localhost:5251).
// Gerencia JWT em localStorage e expoe tipos canônicos alinhados a docs/api.md.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5251";
const TOKEN_KEY = "mvpfacial.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

// Erro canônico: { erro: "CODIGO", mensagem: "..." } ou cai num fallback
export class ApiError extends Error {
  codigo: string;
  status: number;
  data?: any;
  constructor(codigo: string, mensagem: string, status: number, data?: any) {
    super(mensagem || codigo);
    this.codigo = codigo;
    this.status = status;
    this.data = data;
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { auth?: boolean },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.auth !== false) {
    const t = getToken();
    if (t) headers.set("Authorization", `Bearer ${t}`);
  }
  if (!(init?.body instanceof FormData)) {
    headers.set("Accept", "application/json");
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }
  }

  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (resp.status === 204) return undefined as T;

  const text = await resp.text();
  const data = text ? safeJson(text) : null;

  if (!resp.ok) {
    const codigo = data?.erro ?? `HTTP_${resp.status}`;
    const mensagem = data?.mensagem ?? data?.detail ?? resp.statusText;
    throw new ApiError(codigo, mensagem, resp.status, data);
  }

  return data as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// --- Tipos canônicos (alinhados com docs/api.md) ---

export interface Usuario {
  id: number;
  nome: string;
  cpf: string;
  dataNascimento?: string | null;
  nomeMae?: string | null;
  consentimentoAceito?: boolean;
  termoVersao?: string;
  criadoEm?: string;
  temVetoresFaciais?: boolean;
}

export interface CadastroResponse {
  usuario: Pick<Usuario, "id" | "nome" | "cpf" | "termoVersao">;
  documentosPersistidos?: number;
  token: string;
  expiraEmHoras: number;
}

export interface DocumentoExtraido {
  // Campos comuns
  tipoDocumento?: string | null; // RG | CNH | Comprovante
  confianca?: number;
  // Campos RG/CNH
  nome?: string | null;
  cpf?: string | null;
  dataNascimento?: string | null;
  nomeMae?: string | null;
  nomePai?: string | null;
  rgNumero?: string | null;
  rgOrgaoEmissor?: string | null;
  rgUf?: string | null;
  rgDataEmissao?: string | null;
  cnhNumero?: string | null;
  cnhCategoria?: string | null;
  cnhValidade?: string | null;
  cnhUf?: string | null;
  // Campos Comprovante
  titular?: string | null;
  cpfTitular?: string | null;
  tipoComprovante?: string | null;
  endereco?: {
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
    cep?: string | null;
  } | null;
  dataEmissao?: string | null;
  dataVencimento?: string | null;
  valor?: string | null;
  emitente?: string | null;
  // Generico
  camposExtras?: Record<string, unknown>;
}

export interface DocumentoCadastradoDto {
  tipoDocumento: string;
  nomeArquivo?: string;
  dadosExtraidosJson: string; // JSON serializado
  confianca?: number;
}

export interface CadastroBiometriaResponse {
  usuarioId: number;
  modelo: string;
  device: string;
  latenciaMs: number;
  vetoresCriados: number;
  vetoresIds: number[];
  pose: string;
}

export interface MetricasVerificacao {
  motor: number;
  score: number;
  limiar: number;
  latenciaMs: number;
  device: string;
  livenessOk: boolean;
}

export interface VerificarResponse {
  usuarioId: number;
  nome: string;
  resultado: "AUTENTICADO" | "INCONCLUSIVO" | "REJEITADO";
  autenticado: boolean;
  metricas: MetricasVerificacao;
  logId: number;
  token?: string | null;
  expiraEmHoras?: number | null;
  laudoUrl: string;
}

// ADR-018: verificacao comparativa com 1 foto.
// Motor 1 (Gemini) compara identidade + liveness (usando foto de referencia cifrada do cadastro).
// Motor 2 (DeepFace) compara identidade contra vetores.
// Se Motor 1 detectar spoofing, veto em Motor 2 (autenticado=false).
export interface VerificarComparativoResponse {
  usuarioId: number;
  nome: string;
  concordancia: boolean;
  latenciaTotalMs: number;
  motor1: {
    motor: string;
    papel: "comparacao+liveness" | "liveness";  // depende se tem foto de referencia
    ok: boolean;
    erro?: string | null;
    similaridadePct?: number | null;            // int 0-100 (so vem se tiver foto de referencia)
    confianca?: number | null;                  // double 0-1
    liveness?: {
      classificacao?: string | null;            // "live" | "printed_photo" | "screen_replay" | "mask" | "indeterminado"
      confianca?: number | null;
      indicadores?: string[] | null;
    } | null;
    icaoConformidade?: {
      conforme?: boolean | null;
      falhas?: string[] | null;
    } | null;
    qualidade?: {
      score?: number | null;                    // 0-100
      problemas?: string[] | null;
    } | null;
    justificativa?: string | null;
    latenciaMs: number;
  };
  motor2: {
    motor: string;
    papel: "identidade";
    ok: boolean;
    erro?: string | null;
    score?: number | null;
    limiar: number;
    autenticado: boolean;                       // ja com veto M1 aplicado
    vetoSpoofing?: boolean | null;              // true se M1 detectou spoofing e vetoou
    livenessOk?: boolean | null;
    device?: string | null;
    latenciaMs: number;
    logId: number;
  };
  laudoUrl: string;
  token?: string | null;
}

export interface VetorFacial {
  id: number;
  pose: string;
  modelo: string;
  criadoEm: string;
}

export interface PontoAnatomico {
  item: string;
  status: "Igual" | "Diferente" | "Inconclusivo" | string;
  observacao?: string;
}

export interface ParecerLaudo {
  Decisao?: string;
  AcaoRecomendada?: string;
  SimilaridadePct?: number;
  Resumo?: string;
  LivenessAuditoria?: string;
  // Alias em lowercase (se vier direto do JSON serializado pelo C#)
  decisao?: string;
  acaoRecomendada?: string;
  similaridadePct?: number;
  resumo?: string;
  livenessAuditoria?: string;
}

export interface LaudoResponse {
  logId: number;
  usuarioId?: number | null;
  nomeUsuario?: string | null;
  criadoEm: string;
  operacao: string;
  motor: number;
  similaridade?: number | null;
  decisao: string;
  parecerPendente: boolean;
  parecerTexto?: string | null;
  parecer?: ParecerLaudo | null;
  pontosAnatomicos?: PontoAnatomico[] | null;
  liveness: { ok: boolean | null; detalhe?: string | null };
  metricas: {
    score?: number | null;
    limiar?: number | null;
    latenciaMs?: number | null;
    device?: string | null;
    motor: number;
  };
  erro?: string | null;
}

// --- Tipos admin (painel /admin) ---
// Campos em camelCase (alinhados com o JSON serializado pelo backend .NET).

export interface UsuarioListado {
  id: number;
  nome: string;
  cpf: string;
  dataNascimento?: string | null;
  nomeMae?: string | null;
  consentimentoAceito: boolean;
  termoVersao?: string | null;
  criadoEm: string;
  totalVetores: number;
  totalDocumentos: number;
  totalLogs: number;
  ultimoLogin?: string | null;
}

export interface ListarUsuariosResponse {
  total: number;
  totalVetores: number;
  totalLogs: number;
  retornados: number;
  usuarios: UsuarioListado[];
}

export interface DocumentoUsuario {
  id: number;
  tipoDocumento: string;
  nomeArquivo?: string | null;
  confiancaExtracao?: string | null;
  dadosExtraidosJson: string;
  criadoEm: string;
}

export interface LogListado {
  id: number;
  usuarioId?: number | null;
  nomeUsuario?: string | null;
  operacao: string;
  motor: number;
  autenticado: boolean;
  score?: number | null;
  limiar?: number | null;
  latenciaMs?: number | null;
  device?: string | null;
  livenessOk?: boolean | null;
  erro?: string | null;
  criadoEm: string;
}

export interface VetorFacialListado {
  id: number;
  pose?: string | null;
  modelo?: string | null;
  criadoEm: string;
}

export interface DetalhesUsuarioResponse {
  usuario: {
    id: number;
    nome: string;
    cpf: string;
    dataNascimento?: string | null;
    nomeMae?: string | null;
    consentimentoAceito: boolean;
    termoVersao?: string | null;
    criadoEm: string;
  };
  vetores: VetorFacialListado[];
  documentos: DocumentoUsuario[];
  logs: LogListado[];
}

export interface ExcluirUsuarioResponse {
  status: string;
  usuarioId: number;
  nome: string;
  vetoresRemovidos: number;
  documentosRemovidos: number;
  logsAnonimizados: number;
  mensagem: string;
}

export interface ListarLogsResponse {
  retornados: number;
  logs: LogListado[];
}

// --- API pública ---

export const api = {
  // Auth
  async cadastro(payload: {
    nome: string;
    cpf: string;
    dataNascimento?: string;
    nomeMae?: string;
    consentimentoAceito: boolean;
    documentos?: DocumentoCadastradoDto[];
  }): Promise<CadastroResponse> {
    return request("/api/auth/cadastro", {
      method: "POST",
      body: JSON.stringify(payload),
      auth: false,
    });
  },

  async me(): Promise<Usuario> {
    return request("/api/auth/me");
  },

  async excluirConta(): Promise<{
    status: string;
    usuarioId: number;
    vetoresRemovidos: number;
    logsAnonimizados: number;
    mensagem: string;
  }> {
    return request("/api/auth/usuario", { method: "DELETE" });
  },

  // Documentos (2 endpoints especializados - ADR-006)
  async extrairIdentidade(
    imagens: File[],
  ): Promise<DocumentoExtraido> {
    const form = new FormData();
    imagens.forEach((f) => form.append("imagens", f));
    return request("/api/documentos/extrair-identidade", {
      method: "POST",
      body: form,
      auth: false,
    });
  },

  async extrairComprovante(
    imagens: File[],
  ): Promise<DocumentoExtraido> {
    const form = new FormData();
    imagens.forEach((f) => form.append("imagens", f));
    return request("/api/documentos/extrair-comprovante", {
      method: "POST",
      body: form,
      auth: false,
    });
  },

  // Legado (generico) - mantido por compatibilidade
  async extrairDocumento(
    imagens: File[],
  ): Promise<DocumentoExtraido> {
    const form = new FormData();
    imagens.forEach((f) => form.append("imagens", f));
    return request("/api/documentos/extrair", {
      method: "POST",
      body: form,
      auth: false,
    });
  },

  // Biometria
  async cadastrarBiometria(
    fotos: File[],
    pose?: string,
    poses?: string[],
  ): Promise<CadastroBiometriaResponse> {
    const form = new FormData();
    fotos.forEach((f) => form.append("fotos", f));
    // Se passado array de poses (1 por foto), envia como CSV; senão usa a pose unica.
    if (poses && poses.length > 0) {
      form.append("poses", poses.join(","));
    } else if (pose) {
      form.append("pose", pose);
    }
    return request("/api/biometria/cadastrar", {
      method: "POST",
      body: form,
    });
  },

  async verificar(
    foto: File,
    cpf: string,
    limiar?: number,
  ): Promise<VerificarResponse> {
    const form = new FormData();
    form.append("foto", foto);
    form.append("cpf", cpf);
    if (limiar !== undefined) form.append("limiar", String(limiar));
    return request("/api/biometria/verificar", {
      method: "POST",
      body: form,
      auth: false,
    });
  },

  // ADR-017: rodar Motor 1 (liveness) e Motor 2 (identidade) em paralelo com 1 foto so.
  async verificarComparativo(
    foto: File,
    cpf: string,
    limiar?: number,
  ): Promise<VerificarComparativoResponse> {
    const form = new FormData();
    form.append("foto", foto);
    form.append("cpf", cpf);
    if (limiar !== undefined) form.append("limiar", String(limiar));
    return request("/api/biometria/verificar-comparativo", {
      method: "POST",
      body: form,
      auth: false,
    });
  },

  async listarVetores(): Promise<VetorFacial[]> {
    return request("/api/biometria/vetores");
  },

  async removerVetores(): Promise<{ removidos: number }> {
    return request("/api/biometria/vetores", { method: "DELETE" });
  },

  // Laudo
  async obterLaudo(logId: number): Promise<LaudoResponse> {
    return request(`/api/biometria/laudo/${logId}`, { auth: false });
  },

  async gerarLaudo(
    logId: number,
    referencia: File,
    atual: File,
  ): Promise<LaudoResponse> {
    const form = new FormData();
    form.append("referencia", referencia);
    form.append("atual", atual);
    return request(`/api/biometria/laudo/${logId}/gerar`, {
      method: "POST",
      body: form,
    });
  },

  // Admin (painel /admin - MVP sem auth, ver ADR quando producao)
  async listarUsuarios(
    q?: string,
    limit = 100,
  ): Promise<ListarUsuariosResponse> {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("limit", String(limit));
    return request(`/api/admin/usuarios?${params.toString()}`, { auth: false });
  },

  async obterUsuario(id: number): Promise<DetalhesUsuarioResponse> {
    return request(`/api/admin/usuarios/${id}`, { auth: false });
  },

  async excluirUsuario(id: number): Promise<ExcluirUsuarioResponse> {
    return request(`/api/admin/usuarios/${id}`, {
      method: "DELETE",
      auth: false,
    });
  },

  async listarLogs(
    limit = 50,
    operacao?: string,
  ): Promise<ListarLogsResponse> {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (operacao) params.set("operacao", operacao);
    return request(`/api/admin/logs?${params.toString()}`, { auth: false });
  },
};
