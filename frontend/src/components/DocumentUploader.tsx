"use client";

// DocumentUploader - drag&drop de documentos (RG, CNH, comprovante) com preview.
// Cada arquivo vira um card com nome, tamanho e botao de remover.
import { useCallback, useRef, useState } from "react";

interface Props {
  arquivos: File[];
  onAdd: (files: File[]) => void;
  onRemove: (idx: number) => void;
  max?: number;
  accept?: string;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export default function DocumentUploader({
  arquivos,
  onAdd,
  onRemove,
  max = 5,
  accept = "image/jpeg,image/png,image/webp,application/pdf",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [erro, setErro] = useState<string>("");

  const filtrar = useCallback(
    (files: FileList | File[]): File[] => {
      const arr = Array.from(files);
      const validos = arr.filter((f) => ACCEPTED.includes(f.type) && f.size <= 10 * 1024 * 1024);
      const invalidos = arr.length - validos.length;
      if (invalidos > 0) {
        setErro(
          `${invalidos} arquivo(s) ignorado(s): tipo não suportado ou maior que 10 MB.`,
        );
      } else {
        setErro("");
      }
      return validos;
    },
    [],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (arquivos.length >= max) return;
      const novos = filtrar(e.dataTransfer.files).slice(0, max - arquivos.length);
      if (novos.length) onAdd(novos);
    },
    [arquivos.length, max, onAdd, filtrar],
  );

  const onSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      const novos = filtrar(e.target.files).slice(0, max - arquivos.length);
      if (novos.length) onAdd(novos);
      // reset para permitir selecionar o mesmo arquivo novamente
      if (inputRef.current) inputRef.current.value = "";
    },
    [arquivos.length, max, onAdd, filtrar],
  );

  const atingiuMax = arquivos.length >= max;

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          dragOver
            ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan-dim)]/10"
            : "border-[var(--border-strong)] hover:border-[var(--accent-cyan)]"
        } ${atingiuMax ? "opacity-50 pointer-events-none" : ""}`}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon />
        <p className="mt-3 text-sm">
          <span className="text-[var(--accent-cyan)] font-medium">
            Clique para enviar
          </span>{" "}
          ou arraste os arquivos aqui
        </p>
        <p className="text-xs text-[var(--fg-muted)] mt-1">
          JPG, PNG, WebP ou PDF · até 10 MB · máx {max}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          onChange={onSelect}
          className="hidden"
        />
      </div>

      {erro && (
        <div className="text-xs text-[var(--warning)] bg-[var(--warning-bg)] border border-[var(--warning)] rounded px-3 py-2">
          {erro}
        </div>
      )}

      {arquivos.length > 0 && (
        <ul className="flex flex-col gap-2">
          {arquivos.map((f, idx) => (
            <li
              key={idx}
              className="flex items-center gap-3 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded px-3 py-2"
            >
              <FileIcon tipo={f.type} />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{f.name}</div>
                <div className="text-xs text-[var(--fg-muted)] font-mono">
                  {formatarBytes(f.size)} · {f.type || "sem tipo"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="text-[var(--fg-muted)] hover:text-[var(--danger)] transition-colors p-1"
                aria-label={`Remover ${f.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function UploadIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="mx-auto text-[var(--fg-muted)]"
    >
      <path d="M12 3v12m0-12l-4 4m4-4l4 4M3 17v3a1 1 0 001 1h16a1 1 0 001-1v-3" />
    </svg>
  );
}

function FileIcon({ tipo }: { tipo: string }) {
  const isPdf = tipo === "application/pdf";
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={isPdf ? "text-[var(--danger)]" : "text-[var(--accent-cyan)]"}
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
