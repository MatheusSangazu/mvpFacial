// Pagina de Cadastro / Pre-matricula (esqueleto)
// Fluxo: upload documentos -> extracao IA -> captura facial -> conclusao

"use client";

import DocumentUploader from "@/components/DocumentUploader";
import CameraOverlay from "@/components/CameraOverlay";

export default function CadastroPage() {
  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Cadastro (Pré-matrícula)</h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">1. Documentos</h2>
        <DocumentUploader />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">2. Biometria Facial</h2>
        <CameraOverlay />
      </section>
    </main>
  );
}
