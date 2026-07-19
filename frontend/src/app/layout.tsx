// Layout raiz - define o shell visual (header + container) usado por todas as paginas.
// Visual dark "painel forense" alinhado ao prototipo do Laudo (ADR-014).
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MVP Facial · Biometria e Laudos",
  description:
    "Plataforma de biometria facial com DeepFace e Laudo Tecnico Biomestrico (LGPD).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded bg-[var(--accent-cyan)] flex items-center justify-center">
            <span className="text-[#00141a] font-bold text-sm font-mono">M</span>
          </div>
          <span className="font-semibold tracking-tight">
            MVP Facial
            <span className="text-[var(--fg-muted)] font-normal ml-2 text-sm hidden sm:inline">
              Biometria &amp; Laudos
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <NavLink href="/cadastro">Cadastro</NavLink>
          <NavLink href="/login">Login</NavLink>
          <NavLink href="/admin">Admin</NavLink>
        </nav>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
    >
      {children}
    </Link>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--border-subtle)] mt-12">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between text-xs text-[var(--fg-muted)]">
        <span className="font-mono">
          MVP Facial · Motor 2 (DeepFace) + Motor 1 (Gemini 3.5 Flash)
        </span>
        <span>LGPD · ADR-014</span>
      </div>
    </footer>
  );
}
