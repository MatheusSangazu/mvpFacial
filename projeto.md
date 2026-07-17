# Documento Guia: MVP - Reconhecimento Facial e Extração Documental

## 1. Objetivo do Projeto
Criar um MVP funcional de cadastro (com extração inteligente de dados de documentos) e login biométrico facial para validação técnica e apresentação executiva. O sistema deve coletar métricas de tempo de resposta e acurácia para três cenários de login distintos, além de validar a eficiência da IA Multimodal na leitura de documentos de identidade e comprovantes.

## 2. Stack Tecnológico Base
*   **Frontend:** Next.js (React), Tailwind CSS. Uso avançado de acesso à webcam com overlays visuais e captura em burst.
*   **Backend Principal:** C# (.NET Core API Minimal ou Controllers).
*   **Banco de Dados:** Conexão com banco relacional hospedado em VPS. Criar tabelas para `Usuarios` (com campos para dados dos documentos) e `Biometria_Logs`. Suporte a arrays/JSON para os vetores faciais.
*   **Microserviço de Visão Computacional:** Python com FastAPI, OpenCV e `DeepFace`.

## 3. Arquitetura de Extração de Documentos (Cadastro)
Durante o registro, o usuário enviará fotos de documentos (RG, CNH, Guias Escolares, Comprovante de Residência).

*   **Abordagem Escolhida:** IA Multimodal Direta (Gemini 1.5 Flash).
*   **Fluxo:** Next.js envia a imagem -> C# repassa a imagem para a API do Gemini com um System Prompt rigoroso -> Gemini retorna um JSON estruturado com os dados extraídos -> C# salva no banco.

### Decisão Arquitetural: Por que NÃO usar OCR Tradicional (Tesseract/Cloud Vision)
Para este MVP, o uso de uma camada prévia de OCR foi descartado pois atua como um gargalo:
1.  **Propagação de Erros:** OCRs puros leem caractere por caractere sem contexto. Um risco no documento faz o OCR ler um número "5" como letra "S", falhando a validação no banco.
2.  **A IA Multimodal tem Contexto Visual:** Modelos como o Gemini processam a imagem inteira. Se o CPF estiver ligeiramente apagado, o peso da rede neural entende o padrão do documento brasileiro e deduz o número correto pelo contexto, ignorando ruídos físicos.
3.  **Complexidade:** Adicionar um OCR dobra o tempo de resposta e cria dois pontos de falha no backend.

**Quando o OCR tradicional seria interessante (Casos de Uso Futuros):**
*   Processamento massivo de textos longos (ex: PDFs jurídicos de 500 páginas), onde o custo de tokens de imagem de uma IA Multimodal seria proibitivo.
*   Leitura exclusiva de caligrafia muito complexa (ex: receitas médicas manuscritas), usando OCRs altamente especializados antes da estruturação.

## 4. Os 3 Motores de Teste (Login Facial)
O frontend terá um seletor para testar os motores de biometria.

*   **Motor 1: IA Generativa (O Teste de Falha)**
    *   **Fluxo:** C# envia vídeo/fotos para o Gemini validar a identidade e o Liveness. Objetivo: demonstrar para a diretoria a lentidão e vulnerabilidade (falsos positivos em ataques de tela de celular).
*   **Motor 2: Visão Computacional Local "Do Zero" (CPU vs GPU local)**
    *   **Cadastro:** Câmera tira 3 fotos (frente e lados). Python extrai vetores com `DeepFace`, tira a média matemática e C# salva o "Vetor Mestre".
    *   **Login (Liveness Caseiro):** Next.js pede um desafio aleatório (ex: "Vire o rosto"). OpenCV valida o movimento (prova de vida) e DeepFace compara o embedding gerado com o Vetor Mestre.
    *   **Hardware:** Toggle para testar performance na CPU vs GPU (CUDA/RTX).
*   **Motor 3: Cloud API (Simulação Azure)**
    *   **Fluxo:** C# consome a Face API da Azure (ou retorna mock temporário enquanto a Microsoft aprova a conta de Acesso Limitado).

## 5. Estrutura de Pastas Sugerida
```text
/mvp-reconhecimento-facial
│
├── /frontend         # Aplicação Next.js
│   ├── /components   # CameraOverlay.tsx, DocumentUploader.tsx
│   ├── /pages        # /cadastro, /login
│   └── /utils        # Lógica de MediaRecorder e capturas
│
├── /backend          # API C# (.NET)
│   ├── /Controllers  # AuthController.cs, DocumentController.cs
│   ├── /Services     # GeminiService.cs (Documentos e Motor 1), PythonVisionService.cs
│   └── /Data         # Contexto de conexão com a VPS
│
└── /vision-service   # API Python (FastAPI)
    ├── main.py       # Rotas
    ├── vector_math.py# Lógica matemática (embeddings)
    └── liveness.py   # Validação de movimento (OpenCV)