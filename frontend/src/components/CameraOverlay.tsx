// CameraOverlay - Componente de captura facial com overlay visual (esqueleto)
// TODO: implementar acesso a webcam, burst de capturas, overlay de guia

"use client";

import { useRef, useState } from "react";

export default function CameraOverlay({
  onCapture,
}: {
  onCapture?: (fotos: string[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streaming, setStreaming] = useState(false);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-full max-w-md aspect-video bg-gray-900 rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          autoPlay
          playsInline
          muted
        />
        {!streaming && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            Câmera desativada
          </div>
        )}
      </div>
    </div>
  );
}
