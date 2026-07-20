import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ADR-020: standalone gera um server.js autossuficiente para Docker (imagem menor).
  output: "standalone",
};

export default nextConfig;
