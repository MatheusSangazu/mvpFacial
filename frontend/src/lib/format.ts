// Utilitarios de formatacao e mascaramento (LGPD: CPF exibido parcialmente onde aplicavel).

/** Aplica mascara visual de CPF: 000.000.000-00 */
export function mascararCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** Normaliza CPF removendo mascara -> 11 digitos (ou string vazia) */
export function normalizarCpf(cpf: string): string {
  return cpf.replace(/\D/g, "").slice(0, 11);
}

/** Mascara para exibicao publica: 000.***.***-** (protege parcial - LGPD) */
export function mascararCpfParcial(cpf: string): string {
  const d = normalizarCpf(cpf);
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
}

/** Valida digitos verificadores do CPF (Camada 1 - ADR-006). */
export function validarCpf(cpf: string): boolean {
  const d = normalizarCpf(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // todos iguais
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== Number(d[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv2 === Number(d[10]);
}

/** Formata data ISO para dd/mm/aaaa */
export function formatarData(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR");
}

/** Formata data+hora ISO para dd/mm/aaaa HH:MM */
export function formatarDataHora(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Formata percentual: 0.85 -> "85%" / 0.857 -> "85.7%" */
export function formatarPercentual(valor: number | null | undefined): string {
  if (valor == null) return "—";
  const pct = valor * 100;
  return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(1)}%`;
}

/** Formata latencia: 144 -> "144ms" / 1400 -> "1.4s" */
export function formatarLatencia(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
