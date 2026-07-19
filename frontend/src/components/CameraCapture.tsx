"use client";

// CameraCapture - captura facial via webcam com auto-deteccao de rosto.
// Usa a Shape Detection API nativa do Chrome/Edge quando disponivel;
// caso contrario, faz captura manual com guia visual oval.
//
// Modo auto: detecta o rosto, espera estabilizar por X ms e captura sozinho.
// Mostra instrucoes dinamicas ("Centralize o rosto", "Aproxime-se", "Mais luz", etc.).
import { useCallback, useEffect, useRef, useState } from "react";

export interface FotoCapturada {
  file: File;
  previewUrl: string;
  /** Rotulo da pose informada pelo pai (ex.: "frente" | "esquerda" | "direita"). */
  pose?: string;
}

interface Props {
  maxFotos?: number;
  fotos: FotoCapturada[];
  onAdd: (f: FotoCapturada) => void;
  onRemove: (idx: number) => void;
  onClear?: () => void;
  aspectRatio?: "1:1" | "4:3" | "16:9";
  /** Auto-capturar quando o rosto estiver estavel. Default true. */
  autoCapture?: boolean;
  /** Label da instrucao atual mostrada no overlay (controlado internamente). */
  showInstructions?: boolean;
}

// Shape Detection API - tipagem minima (nao esta em @types/dom ainda).
type DetectedFace = {
  boundingBox: DOMRectReadOnly;
};
type FaceDetectorCtor = new (opts?: {
  maxDetectedFaces?: number;
  fastMode?: boolean;
}) => {
  detect: (source: CanvasImageSource) => Promise<DetectedFace[]>;
};

function getNativeFaceDetector():
  | { detect: (s: CanvasImageSource) => Promise<DetectedFace[]> }
  | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as unknown as { FaceDetector?: FaceDetectorCtor })
    .FaceDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ maxDetectedFaces: 1, fastMode: true });
  } catch {
    return null;
  }
}

export default function CameraCapture({
  maxFotos = 3,
  fotos,
  onAdd,
  onRemove,
  aspectRatio = "4:3",
  autoCapture = true,
  showInstructions = true,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<ReturnType<typeof getNativeFaceDetector>>(null);
  const detectLoopRef = useRef<number | null>(null);
  const stableSinceRef = useRef<number | null>(null);
  const alreadyCapturedRef = useRef(false);

  const [status, setStatus] = useState<
    "idle" | "starting" | "streaming" | "error" | "denied"
  >("idle");
  const [erro, setErro] = useState<string>("");
  const [instrucao, setInstrucao] = useState<string>("");
  const [rostoDetectado, setRostoDetectado] = useState<boolean>(false);
  const [suporteAuto, setSuporteAuto] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(0);

  // --- Start / Stop camera ---

  const start = useCallback(async () => {
    setStatus("starting");
    setErro("");
    setInstrucao("Solicitando acesso à câmera...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("streaming");

      // Inicializa detector nativo se suportado
      const detector = getNativeFaceDetector();
      detectorRef.current = detector;
      setSuporteAuto(detector !== null);
      if (detector && autoCapture) {
        setInstrucao("Centralize seu rosto no oval");
        iniciarLoopDeteccao();
      } else {
        setInstrucao(
          detector
            ? "Centralize o rosto e clique em Capturar"
            : "Browser sem auto-detecção - use Capturar manual",
        );
      }
    } catch (e: any) {
      if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
        setStatus("denied");
        setErro(
          "Permissão de câmera negada. Autorize o acesso nas configurações do navegador.",
        );
      } else if (e?.name === "NotFoundError") {
        setStatus("error");
        setErro("Nenhuma câmera encontrada neste dispositivo.");
      } else {
        setStatus("error");
        setErro(e?.message ?? "Falha ao iniciar a câmera.");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCapture]);

  const stop = useCallback(() => {
    if (detectLoopRef.current) {
      cancelAnimationFrame(detectLoopRef.current);
      detectLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    stableSinceRef.current = null;
    alreadyCapturedRef.current = false;
    setRostoDetectado(false);
    setStatus("idle");
    setInstrucao("");
    setCountdown(0);
  }, []);

  useEffect(() => {
    return () => {
      if (detectLoopRef.current) {
        cancelAnimationFrame(detectLoopRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // --- Auto-deteccao loop ---

  const iniciarLoopDeteccao = useCallback(() => {
    if (detectLoopRef.current) return;

    const TEMPO_ESTAVEL_MS = 800; // rosto precisa ficar estavel por 800ms antes de capturar
    const INTERVALO = 200; // detecta a cada 200ms

    let ultimaDeteccao = 0;

    const tick = async () => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      const detectCanvas = detectionCanvasRef.current;

      if (!video || !detector || !detectCanvas || video.readyState < 2) {
        detectLoopRef.current = requestAnimationFrame(tick);
        return;
      }

      // Throttle para ~5 fps
      const agora = performance.now();
      if (agora - ultimaDeteccao < INTERVALO) {
        detectLoopRef.current = requestAnimationFrame(tick);
        return;
      }
      ultimaDeteccao = agora;

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        detectLoopRef.current = requestAnimationFrame(tick);
        return;
      }
      detectCanvas.width = w;
      detectCanvas.height = h;
      const ctx = detectCanvas.getContext("2d");
      if (!ctx) {
        detectLoopRef.current = requestAnimationFrame(tick);
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);

      try {
        const faces = await detector.detect(detectCanvas);
        const face = faces[0];

        if (face) {
          const bb = face.boundingBox;
          const areaFace = bb.width * bb.height;
          const areaFrame = w * h;
          const pctArea = areaFace / areaFrame;
          const cxRosto = (bb.x + bb.width / 2) / w;
          const cyRosto = (bb.y + bb.height / 2) / h;
          // tolerancia geometrica
          const centralizado =
            Math.abs(cxRosto - 0.5) < 0.12 && Math.abs(cyRosto - 0.5) < 0.15;

          if (pctArea < 0.05) {
            setInstrucao("Aproxime-se mais da câmera");
            setRostoDetectado(false);
            stableSinceRef.current = null;
          } else if (pctArea > 0.55) {
            setInstrucao("Afaste-se um pouco da câmera");
            setRostoDetectado(false);
            stableSinceRef.current = null;
          } else if (!centralizado) {
            setInstrucao("Centralize o rosto no oval");
            setRostoDetectado(false);
            stableSinceRef.current = null;
          } else {
            // Rosto OK
            setRostoDetectado(true);
            if (!stableSinceRef.current) {
              stableSinceRef.current = agora;
              setCountdown(Math.ceil(TEMPO_ESTAVEL_MS / 1000));
            } else {
              const decorrido = agora - stableSinceRef.current;
              const restante = Math.max(0, TEMPO_ESTAVEL_MS - decorrido);
              setCountdown(Math.ceil(restante / 1000));
              if (
                decorrido >= TEMPO_ESTAVEL_MS &&
                !alreadyCapturedRef.current
              ) {
                alreadyCapturedRef.current = true;
                setInstrucao("✓ Capturando...");
                capturar();
                // para o loop - caller reabre se quiser nova foto
                if (detectLoopRef.current) {
                  cancelAnimationFrame(detectLoopRef.current);
                  detectLoopRef.current = null;
                }
                return;
              } else if (alreadyCapturedRef.current) {
                setInstrucao("Mantenha pose...");
              } else {
                setInstrucao(`Segure ai! Capturando em ${Math.ceil(restante / 1000)}s`);
              }
            }
          }
        } else {
          setInstrucao("Nenhum rosto detectado - posicione-se no oval");
          setRostoDetectado(false);
          stableSinceRef.current = null;
          setCountdown(0);
        }
      } catch {
        // detector falhou nesse frame - tenta de novo no proximo
      }

      detectLoopRef.current = requestAnimationFrame(tick);
    };

    detectLoopRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Captura manual ou automatica ---

  const capturar = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Espelha horizontalmente (selfie)
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `captura-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        const previewUrl = URL.createObjectURL(blob);
        onAdd({ file, previewUrl });
      },
      "image/jpeg",
      0.92,
    );
  }, [onAdd]);

  const aspectClass =
    aspectRatio === "1:1"
      ? "aspect-square"
      : aspectRatio === "16:9"
        ? "aspect-video"
        : "aspect-[4/3]";

  const atingiuMax = fotos.length >= maxFotos;

  // Cor do overlay baseada no estado do rosto
  const corOverlay = !autoCapture
    ? "var(--accent-cyan)"
    : !suporteAuto
      ? "var(--accent-cyan)"
      : rostoDetectado
        ? "var(--success)"
        : "var(--warning)";

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`relative ${aspectClass} w-full max-w-md bg-black rounded-lg overflow-hidden border-2 transition-colors`}
        style={{ borderColor: corOverlay }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${status === "streaming" ? "block" : "hidden"}`}
          style={{ transform: "scaleX(-1)" }}
        />
        <canvas ref={canvasRef} className="hidden" />
        <canvas ref={detectionCanvasRef} className="hidden" />

        {/* Overlay oval - guia facial */}
        {status === "streaming" && (
          <div className="absolute inset-0 pointer-events-none">
            <svg viewBox="0 0 400 300" className="w-full h-full">
              <defs>
                <mask id="oval-mask">
                  <rect width="400" height="300" fill="black" />
                  <ellipse cx="200" cy="150" rx="90" ry="120" fill="white" />
                </mask>
              </defs>
              <rect
                width="400"
                height="300"
                fill="black"
                fillOpacity="0.5"
                mask="url(#oval-mask)"
              />
              <ellipse
                cx="200"
                cy="150"
                rx="90"
                ry="120"
                fill="none"
                stroke={corOverlay}
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            </svg>

            {/* Instrucao dinamica no topo */}
            {showInstructions && instrucao && (
              <div className="absolute top-2 left-2 right-2 text-center">
                <span
                  className="inline-block px-3 py-1 rounded text-xs font-mono uppercase tracking-wider backdrop-blur"
                  style={{
                    color: corOverlay,
                    background: "rgba(0,0,0,0.6)",
                    border: `1px solid ${corOverlay}`,
                  }}
                >
                  {instrucao}
                </span>
              </div>
            )}

            {/* Badge de status */}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[10px] font-mono">
              <span
                className="px-2 py-0.5 rounded"
                style={{ color: corOverlay, background: "rgba(0,0,0,0.6)" }}
              >
                {autoCapture && suporteAuto
                  ? rostoDetectado
                    ? countdown > 0
                      ? `CAPTURANDO EM ${countdown}s`
                      : "ROSTO DETECTADO"
                    : "AGUARDANDO ROSTO"
                  : "MODO MANUAL"}
              </span>
              {autoCapture && !suporteAuto && (
                <span
                  className="px-2 py-0.5 rounded text-[var(--fg-muted)]"
                  style={{ background: "rgba(0,0,0,0.6)" }}
                >
                  sem auto-detecção
                </span>
              )}
            </div>
          </div>
        )}

        {/* Estados: idle / starting / error / denied */}
        {status !== "streaming" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {status === "starting" && (
              <>
                <div className="w-6 h-6 border-2 border-[var(--accent-cyan)] border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-[var(--fg-secondary)]">
                  Iniciando câmera...
                </span>
              </>
            )}
            {status === "idle" && (
              <>
                <CameraIcon />
                <p className="text-sm text-[var(--fg-secondary)] max-w-xs">
                  {autoCapture
                    ? "Clique em Iniciar. Vamos detectar seu rosto e capturar automaticamente."
                    : "Clique em Iniciar câmera para começar a captura."}
                </p>
              </>
            )}
            {(status === "error" || status === "denied") && (
              <>
                <div className="w-10 h-10 rounded-full bg-[var(--danger-bg)] border border-[var(--danger)] flex items-center justify-center">
                  <span className="text-[var(--danger)] text-xl">!</span>
                </div>
                <p className="text-sm text-[var(--danger)] max-w-xs">{erro}</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Controles */}
      <div className="flex flex-wrap gap-2">
        {status !== "streaming" ? (
          <button
            type="button"
            onClick={start}
            className="btn-primary"
            disabled={status === "starting" || atingiuMax}
          >
            {status === "starting" ? "Iniciando..." : "Iniciar câmera"}
          </button>
        ) : (
          <>
            {/* Botao manual so aparece se auto-capture nao estiver rodando ou para forcar captura */}
            {(!autoCapture || !suporteAuto || !rostoDetectado) && (
              <button
                type="button"
                onClick={capturar}
                className="btn-primary"
                disabled={atingiuMax}
              >
                {atingiuMax ? "Máximo atingido" : "Capturar foto"}
              </button>
            )}
            <button type="button" onClick={stop} className="btn-secondary">
              Parar câmera
            </button>
          </>
        )}
        <span className="ml-auto text-xs text-[var(--fg-muted)] self-center font-mono">
          {fotos.length}/{maxFotos} fotos
        </span>
      </div>

      {/* Preview das capturas */}
      {fotos.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {fotos.map((f, idx) => (
            <div
              key={idx}
              className="relative w-24 h-24 rounded overflow-hidden border border-[var(--border-strong)] group"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={f.previewUrl}
                alt={`Captura ${idx + 1}`}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="absolute top-1 right-1 w-5 h-5 rounded bg-[var(--danger)] text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                aria-label={`Remover foto ${idx + 1}`}
              >
                ×
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 font-mono">
                #{idx + 1}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="text-[var(--fg-muted)]"
    >
      <path d="M3 7h3l2-2h8l2 2h3v12H3z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
