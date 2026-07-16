"""
Vision Service - API principal para reconhecimento facial.
Motor 2: visao computacional local com DeepFace + OpenCV.
"""
import os
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Vision Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security: token interno compartilhado com o backend C#
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "")
DEVICE = os.getenv("DEVICE", "cpu")  # cpu | cuda


async def verificar_token(x_internal_token: str = Header(...)):
    """Valida o token interno entre backend e vision-service."""
    if x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(status_code=403, detail="Token invalido")
    return True


@app.get("/health")
async def health():
    """Healthcheck do vision-service."""
    return {"status": "ok", "device": DEVICE}


# --- Modelos de request/response ---

class VerificarRequest(BaseModel):
    """Request para verificacao facial (login Motor 2)."""
    imagemAtual: str  # base64
    vetoresCadastrados: list[list[float]]  # embeddings do cadastro
    limiar: float = 0.60


class VerificarResponse(BaseModel):
    autenticado: bool
    score: float
    livenessOk: bool
    device: str
    latenciaMs: int


# --- Endpoints de biometria ---

@app.post("/embeddings")
async def gerar_embeddings(token: bool = Depends(verificar_token)):
    """Gera embeddings a partir de imagens enviadas (cadastro)."""
    # TODO: implementar com DeepFace
    return {"embeddings": [], "modelo": "Facenet"}


@app.post("/verificar", response_model=VerificarResponse)
async def verificar(req: VerificarRequest, token: bool = Depends(verificar_token)):
    """Verifica identidade facial (login Motor 2)."""
    # TODO: implementar comparacao com DeepFace + liveness OpenCV
    return VerificarResponse(
        autenticado=False, score=0.0, livenessOk=False, device=DEVICE, latenciaMs=0
    )


@app.post("/liveness")
async def liveness(token: bool = Depends(verificar_token)):
    """Executa desafio de prova de vida com OpenCV."""
    # TODO: implementar deteccao de movimento/pose
    return {"livenessOk": False, "movimentoDetectado": False}
