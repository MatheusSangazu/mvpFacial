"""
Vision Service - API principal para reconhecimento facial.
Motor 2: visao computacional local com DeepFace + OpenCV (ADR-003, ADR-004).
"""
import asyncio
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from liveness import detectar_rostos, validar_movimento, analisar_liveness_1frame
from vector_math import melhor_score, similaridade_cosseno

load_dotenv()

# Pasta para modelos DeepFace (default ~/.deepface). Aqui forcamos dentro do projeto
# (caminho absoluto) para evitar PermissionError em ambientes sandboxed.
_DEEPFACE_HOME = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".deepface")
os.environ["DEEPFACE_HOME"] = _DEEPFACE_HOME

app = FastAPI(title="Vision Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Seguranca: token interno compartilhado com o backend C# (nao expor a internet)
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "")
DEVICE = os.getenv("DEVICE", "cpu")  # cpu | cuda
MODEL_NAME = os.getenv("DEEPFACE_MODEL", "Facenet")  # Facenet | VGG-Face | ArcFace
# Detector facial - mtcnn e bem mais robusto que opencv para faces em angulos
# dificeis ou baixa iluminacao. retinaface e fallback (mais preciso, porem lento na CPU).
DETECTOR_PRIMARIO = os.getenv("DETECTOR_BACKEND", "mtcnn")
DETECTOR_FALLBACK = os.getenv("DETECTOR_FALLBACK", "retinaface")

# Lazy load do DeepFace (so importa quando o endpoint e chamado pela 1a vez)
_deepface = None


def _get_deepface():
    """Importa e cacheia o modulo DeepFace (carrega modelos na 1a chamada)."""
    global _deepface
    if _deepface is None:
        from deepface import DeepFace
        _deepface = DeepFace
    return _deepface


async def verificar_token(x_internal_token: str = Header(...)):
    """Valida o token interno entre backend e vision-service."""
    if not INTERNAL_TOKEN:
        raise HTTPException(status_code=503, detail="INTERNAL_TOKEN nao configurado no vision-service")
    if x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(status_code=403, detail="Token invalido")
    return True


@app.get("/health")
async def health():
    """Healthcheck do vision-service."""
    return {
        "status": "ok",
        "device": DEVICE,
        "model": MODEL_NAME,
        "tokenConfigurado": bool(INTERNAL_TOKEN),
    }


# --- Modelos de request/response ---

class VerificarRequest(BaseModel):
    imagemAtual: str  # base64 (sem prefixo data:)
    vetoresCadastrados: list[list[float]]
    limiar: float = 0.60


class VerificarResponse(BaseModel):
    autenticado: bool
    score: float
    livenessOk: bool
    livenessIndicadores: list[str] = []
    device: str
    latenciaMs: int


# --- Helpers de imagem ---

def _decode_image(data: bytes) -> np.ndarray:
    """Decodifica bytes em BGR (OpenCV)."""
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Imagem invalida / nao decodificavel")
    return img


def _decode_base64(b64: str) -> np.ndarray:
    """Decodifica string base64 (sem prefixo data:) em BGR."""
    import base64
    try:
        # Remove prefixo data:image/...;base64, se existir
        if "," in b64 and b64.startswith("data:"):
            b64 = b64.split(",", 1)[1]
        raw = base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"base64 invalido: {e}")
    return _decode_image(raw)


# --- Endpoints de biometria ---

def _gerar_embedding(img, enforce: bool):
    """Gera embedding tentando detector primario (mtcnn) e fallback (retinaface).
    Se enforce=True e nenhum detector achar rosto, levanta HTTPException SEM_ROSTO."""
    DeepFace = _get_deepface()
    ultimo_erro = None
    for detector in (DETECTOR_PRIMARIO, DETECTOR_FALLBACK):
        try:
            resultado = DeepFace.represent(
                img_path=img,
                model_name=MODEL_NAME,
                enforce_detection=enforce,
                detector_backend=detector,
            )
            # Normaliza saida para dict
            if isinstance(resultado, list) and resultado:
                return [float(x) for x in resultado[0]["embedding"]]
            if isinstance(resultado, dict) and "embedding" in resultado:
                return [float(x) for x in resultado["embedding"]]
            ultimo_erro = f"DeepFace devolveu formato inesperado com detector={detector}"
        except ValueError as e:
            msg = str(e)
            if "face could not be detected" in msg or "detected" in msg.lower():
                ultimo_erro = f"SEM_ROSTO via {detector}"
                continue  # tenta proximo detector
            raise HTTPException(status_code=422, detail=f"Falha embedding ({detector}): {msg}")
        except Exception as e:
            ultimo_erro = f"{detector}: {e}"
            continue
    if enforce:
        raise HTTPException(status_code=422, detail="SEM_ROSTO")
    raise HTTPException(status_code=422, detail=f"Falha embedding: {ultimo_erro}")


@app.post("/embeddings")
async def gerar_embeddings(
    files: list[UploadFile] = File(...),
    pose: Optional[str] = Form(None),  # frente | esquerda | direita (opcional, info-only)
    token: bool = Depends(verificar_token),
):
    """
    Gera embeddings a partir de uma ou mais imagens (cadastro - ADR-004).
    Retorna um embedding por imagem de entrada (NAO faz media).
    Processa em paralelo no ThreadPool (DeepFace e CPU-bound mas libera o GIL em numpy/cv2).
    """
    t0 = time.perf_counter()

    # Decodifica todas as imagens de forma assincrona primeiro (I/O bound)
    raws = []
    for f in files:
        raws.append(await f.read())

    # Processa embeddings em paralelo (CPU bound via ThreadPool)
    # Mantem a ordem: i-esimo item da lista = i-esima foto de entrada.
    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor(max_workers=min(4, len(raws))) as executor:
        futures = []
        for raw in raws:
            img = _decode_image(raw)
            # enforce=True: cadastro sempre exige rosto detectado (ADR-015)
            futures.append(loop.run_in_executor(executor, _gerar_embedding, img, True))

        # Se qualquer foto falhar (sem rosto), propaga o erro (HTTPException).
        embeddings = await asyncio.gather(*futures)

    lat = int((time.perf_counter() - t0) * 1000)
    return {
        "embeddings": embeddings,
        "modelo": MODEL_NAME,
        "detector": DETECTOR_PRIMARIO,
        "device": DEVICE,
        "latenciaMs": lat,
        "quantidade": len(embeddings),
    }


@app.post("/verificar", response_model=VerificarResponse)
async def verificar(req: VerificarRequest, token: bool = Depends(verificar_token)):
    """
    Verifica identidade facial (login Motor 2).
    Compara embedding atual contra todos os cadastrados; score MAXIMO (ADR-004).
    """
    t0 = time.perf_counter()

    if not req.vetoresCadastrados:
        return VerificarResponse(
            autenticado=False, score=0.0, livenessOk=False, device=DEVICE,
            latenciaMs=int((time.perf_counter() - t0) * 1000),
        )

    # Decodifica imagem atual para checagem de liveness (OpenCV)
    liveness_ok = False
    liveness_indicadores: list[str] = []
    try:
        img = _decode_base64(req.imagemAtual)
        # ADR-018.1: anti-spoofing de 1 frame (substitui o antigo "len(rostos) >= 1")
        # Heuristicas: textura Laplaciano + saturacao + cromaticidade YCrCb
        liveness_ok, liveness_indicadores = analisar_liveness_1frame(img)
    except HTTPException:
        raise
    except Exception as e:
        liveness_ok = False
        liveness_indicadores = [f"erro_liveness:{type(e).__name__}"]

    # Extrai embedding atual com DeepFace (enforce=False no login - ADR-015)
    try:
        embedding_atual = _gerar_embedding(img, enforce=False)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Falha ao gerar embedding atual: {e}")

    # Score maximo contra cadastrados (ADR-004)
    score = melhor_score(embedding_atual, req.vetoresCadastrados)

    lat = int((time.perf_counter() - t0) * 1000)
    return VerificarResponse(
        autenticado=score >= req.limiar and liveness_ok,
        score=round(score, 4),
        livenessOk=liveness_ok,
        livenessIndicadores=liveness_indicadores,
        device=DEVICE,
        latenciaMs=lat,
    )


@app.post("/liveness")
async def liveness(
    files: list[UploadFile] = File(...),
    token: bool = Depends(verificar_token),
):
    """
    Executa desafio de prova de vida com OpenCV.
    Recebe 2+ frames; valida se houve variacao de posicao do rosto entre eles.
    """
    if len(files) < 2:
        raise HTTPException(status_code=400, detail="Liveness requer >=2 frames")

    frames: list[np.ndarray] = []
    for f in files:
        raw = await f.read()
        frames.append(_decode_image(raw))

    movimento_ok = validar_movimento(frames)
    return {
        "livenessOk": movimento_ok,
        "movimentoDetectado": movimento_ok,
        "framesAnalisados": len(frames),
    }
