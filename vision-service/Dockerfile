# Vision-service Python + DeepFace. ADR-020
# Imagem final ~2GB (TF + OpenCV + Facenet) - esperado para este motor.
#
# O pip install e dividido em camadas separadas para reduzir o pico de RAM
# durante o build (VPS com pouca memoria nao aguenta instalar tudo de uma vez).
# Cada camada fica cacheada, entao rebuilds subsequentes sao rapidos.
FROM python:3.11-slim

# Dependencias de sistema para OpenCV (libGL).
# ffmpeg removido: so e necessario para processar videos, que o MVP nao usa.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Camada 1: TensorFlow sozinho (peso bruto ~600MB, muita RAM para instalar).
# Fazemos isolado para o Docker cachear essa camada e nunca recompilar.
RUN pip install --no-cache-dir "tensorflow==2.21.*"

# Camada 2: tf-keras (compat Keras 2 com TF 2.21+).
# Precisa vir depois do TF para detectar a versao corretamente.
RUN pip install --no-cache-dir "tf-keras>=2.21"

# Camada 3: OpenCV + NumPy (binarios relativamente pequenos).
RUN pip install --no-cache-dir \
    "opencv-python==4.10.0.84" \
    "numpy>=1.26,<2.1"

# Camada 4: DeepFace + dependencias (baixa ggml, retinaface, etc).
RUN pip install --no-cache-dir "deepface==0.0.93"

# Camada 5: API + utils leves.
RUN pip install --no-cache-dir \
    "fastapi==0.115.6" \
    "uvicorn[standard]==0.34.0" \
    "python-multipart==0.0.20" \
    "pydantic==2.10.4" \
    "python-dotenv==1.0.1"

# Codigo da aplicacao (muda com frequencia - fica por ultimo para cache maximo).
COPY . .

# Pasta de cache dos modelos do DeepFace (Facenet ~500MB baixados no primeiro uso)
RUN mkdir -p /app/.deepface
ENV DEEPFACE_HOME=/app/.deepface
ENV DEVICE=cpu
ENV PYTHONUNBUFFERED=1

EXPOSE 8001
# --workers 1: DeepFace carrega modelo em memoria; mais workers multiplicam RAM.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
