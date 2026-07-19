// Home - Dashboard inicial com cards de navegacao e status do sistema.
import Link from "next/link";

export default function Home() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <Hero />
      <ActionGrid />
      <SystemStatus />
    </div>
  );
}

function Hero() {
  return (
    <section className="mb-12">
      <div className="flex items-center gap-2 text-xs font-mono text-[var(--accent-cyan)] mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)]" />
        <span>PLATAFORMA OPERACIONAL</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">
        Biometria facial com{" "}
        <span className="text-[var(--accent-cyan)]">Laudo Técnico</span>
      </h1>
      <p className="text-[var(--fg-secondary)] max-w-2xl">
        Cadastro, login e auditoria biométrica com DeepFace (Motor 2) e Gemini 3.5
        Flash (Motor 1) para parecer forense. Em conformidade com LGPD e ADR-014.
      </p>
    </section>
  );
}

function ActionGrid() {
  const actions = [
    {
      href: "/cadastro",
      title: "Cadastro completo",
      desc: "Dados pessoais + documentos (IA) + captura facial",
      badge: "Onboarding",
      icon: "01",
    },
    {
      href: "/login",
      title: "Login facial",
      desc: "CPF + selfie → verificação DeepFace com veto de liveness",
      badge: "Autenticação",
      icon: "02",
    },
    {
      href: "/admin",
      title: "Painel admin",
      desc: "Liste usuários, verifique logs biométricos e gere laudos (LGPD)",
      badge: "Admin",
      icon: "03",
    },
  ];

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="card hover:border-[var(--accent-cyan)] transition-colors group"
        >
          <div className="flex items-start justify-between mb-4">
            <span className="font-mono text-xs text-[var(--fg-muted)]">
              {a.icon}
            </span>
            <span className="badge badge-info">{a.badge}</span>
          </div>
          <h2 className="text-lg font-semibold mb-1 group-hover:text-[var(--accent-cyan)] transition-colors">
            {a.title}
          </h2>
          <p className="text-sm text-[var(--fg-secondary)]">{a.desc}</p>
        </Link>
      ))}
    </section>
  );
}

function SystemStatus() {
  const components = [
    { name: "Backend (.NET 9)", status: "online" },
    { name: "Vision Service (Python)", status: "online" },
    { name: "MySQL (VPS)", status: "online" },
    { name: "Gemini 3.5 Flash", status: "online" },
  ];

  return (
    <section className="card">
      <h3 className="text-sm font-mono text-[var(--fg-muted)] uppercase tracking-wider mb-4">
        Componentes do sistema
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {components.map((c) => (
          <div
            key={c.name}
            className="flex items-center justify-between px-3 py-2 bg-[var(--bg-elevated)] rounded border border-[var(--border-subtle)]"
          >
            <span className="text-xs text-[var(--fg-secondary)] truncate mr-2">
              {c.name}
            </span>
            <span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse-cyan shrink-0" />
          </div>
        ))}
      </div>
    </section>
  );
}
