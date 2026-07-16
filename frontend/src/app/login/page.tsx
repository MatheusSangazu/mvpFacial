// Pagina de Login Facial (esqueleto)
// Usuario seleciona o motor (1 ou 2) e faz a captura

"use client";

import CameraOverlay from "@/components/CameraOverlay";

export default function LoginPage() {
  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Login Facial</h1>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Selecione o Motor</h2>
        <div className="flex gap-4">
          <button className="px-4 py-2 border rounded-lg hover:bg-gray-50">
            Motor 1 — Gemini (Demo)
          </button>
          <button className="px-4 py-2 border rounded-lg hover:bg-gray-50">
            Motor 2 — DeepFace (Local)
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Captura</h2>
        <CameraOverlay />
      </section>
    </main>
  );
}
