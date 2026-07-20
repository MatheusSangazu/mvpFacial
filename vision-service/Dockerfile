# Vision-service Python + DeepFace. ADR-020
# Imagem final ~2GB (TF + OpenCV + Facenet) - esperado para este motor.
FROM python:3.11-slim

# Dependencias de sistema para OpenCV (libGL) e ffmpeg para alguns backends
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala dependencias antes do codigo para cache de camadas
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Pasta de cache dos modelos do DeepFace (Facenet ~500MB baixados no primeiro uso)
RUN mkdir -p /app/.deepface
ENV DEEPFACE_HOME=/app/.deepface
ENV DEVICE=cpu
ENV PYTHONUNBUFFERED=1

EXPOSE 8001
# --workers 1: DeepFace carrega modelo em memoria; mais workers multiplicam RAM.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
