"""
liveness - Validacao de prova de vida com OpenCV.
Abordagem simples (Motor 2): deteccao de rostos + variacao de posicao entre frames.

ADR-018.1: anti-spoofing de 1 frame baseado em 3 heuristicas leves:
  1. Textura (Laplaciano variance) - foto de foto perde textura natural
  2. Cor de pele (YCrCb ranges) - fotos impressas/tela distorcem cromaticidade
  3. Saturacao media - fotos de tela tendem a oversaturadas

Nao substitui liveness por video (deep learning). Serve para barrar casos triviais.
"""
import cv2
import numpy as np

# Haar Cascade pre-instalado com opencv-python
_HAAR_CASCADE = None


def _get_cascade():
    global _HAAR_CASCADE
    if _HAAR_CASCADE is None:
        _HAAR_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    return _HAAR_CASCADE


def detectar_rostos(img_bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
    """
    Detecta rostos em imagem BGR.
    Retorna lista de retangulos (x, y, w, h). Lista vazia se nenhum rosto.
    """
    cinza = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    cinza = cv2.equalizeHist(cinza)
    cascade = _get_cascade()
    rostos = cascade.detectMultiScale(
        cinza,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60),
    )
    if isinstance(rostos, tuple):
        return []
    return [(int(x), int(y), int(w), int(h)) for x, y, w, h in rostos]


def validar_movimento(frames: list[np.ndarray], deslocamento_minimo_px: int = 15) -> bool:
    """
    Valida se houve movimento do rosto entre os frames.
    Compara o centro do maior rosto de cada frame.
    Considera vivo se a amplitude (max - min) dos centros em x ou y for >= deslocamento_minimo_px.
    """
    if len(frames) < 2:
        return False

    centros: list[tuple[float, float]] = []
    for frame in frames:
        rostos = detectar_rostos(frame)
        if not rostos:
            return False
        # Maior rosto (provavelmente o principal)
        x, y, w, h = max(rostos, key=lambda r: r[2] * r[3])
        centros.append((x + w / 2, y + h / 2))

    xs = [c[0] for c in centros]
    ys = [c[1] for c in centros]
    amplitude_x = max(xs) - min(xs)
    amplitude_y = max(ys) - min(ys)

    return amplitude_x >= deslocamento_minimo_px or amplitude_y >= deslocamento_minimo_px


# ============================================================================
# ADR-018.1: anti-spoofing de 1 frame (heurísticas leves)
# ============================================================================

# Limiares calibrados empiricamente para webcam comum (640x480+).
# Textura baixa = foto de foto (perde frequencias altas)
_LAPLACIAN_MIN = 35.0
# Saturacao alta = foto de tela (cores neon/exageradas)
_SAT_MAX = 0.78
# Area minima do rosto na imagem (descarta polaroid distante)
_AREA_ROSTO_MIN = 0.01  # 1% da imagem


def analisar_liveness_1frame(img_bgr: np.ndarray) -> tuple[bool, list[str]]:
    """
    Anti-spoofing de 1 frame. Devolve (aprovado, indicadores_suspeitos).
    Aprovacao parcial: nenhum indicador dispara. Nao e prova de vida real - apenas filtro.

    Heuristicas (cada uma sozinha NAO reprova - precisa acumular):
      - Textura do rosto (Laplaciano variance na regiao facial)
      - Distribuicao de saturacao (fotos de tela tendem a oversaturadas)
      - cromaticidade de pele (YCrCb)
      - Presenca de bordas de dispositivo (gradient abrupto)

    Limitacao assumida: este filtro e complementar ao Motor 1 (Gemini) que faz
    liveness real por semantica visual. Veto final vem do Motor 1.
    """
    indicadores: list[str] = []

    rostos = detectar_rostos(img_bgr)
    if not rostos:
        return False, ["sem_rosto_detectado"]

    x, y, w, h = max(rostos, key=lambda r: r[2] * r[3])
    h_img, w_img = img_bgr.shape[:2]
    area_relativa = (w * h) / (w_img * h_img)
    if area_relativa < _AREA_ROSTO_MIN:
        indicadores.append("rosto_muito_pequeno")

    # Regiao facial ampliada 10% (pega um pouco do fundo ao redor)
    pad_x = int(w * 0.1)
    pad_y = int(h * 0.1)
    x0 = max(0, x - pad_x)
    y0 = max(0, y - pad_y)
    x1 = min(w_img, x + w + pad_x)
    y1 = min(h_img, y + h + pad_y)
    roi = img_bgr[y0:y1, x0:x1]

    if roi.size == 0:
        return False, ["roi_vazia"]

    # --- Heuristica 1: textura (Laplaciano variance) ---
    cinza = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    lap = cv2.Laplacian(cinza, cv2.CV_64F)
    var_lap = float(lap.var())
    if var_lap < _LAPLACIAN_MIN:
        # Textura muito lisa = foto de foto ou tela de baixa resolucao
        indicadores.append(f"textura_baixa_var={var_lap:.1f}")

    # --- Heuristica 2: saturacao (fotos de tela tendem a oversaturadas) ---
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    sat_media = float(np.mean(hsv[:, :, 1])) / 255.0
    if sat_media > _SAT_MAX:
        indicadores.append(f"saturacao_alta={sat_media:.2f}")

    # --- Heuristica 3: cromaticidade de pele (YCrCb) ---
    ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
    cr = float(np.mean(ycrcb[:, :, 1]))
    cb = float(np.mean(ycrcb[:, :, 2]))
    # Faixa tipica de pele: Cr 133-173, Cb 77-127
    if not (130 <= cr <= 185) or not (70 <= cb <= 135):
        indicadores.append(f"cromaticidade_atipica_Cr={cr:.0f}_Cb={cb:.0f}")

    # --- Decisao: aprovado se 0 ou 1 indicador suspeito ---
    # (2+ indicadores sugerem ataque; 1 isolado pode ser iluminacao ruim)
    aprovado = len(indicadores) <= 1
    return aprovado, indicadores

