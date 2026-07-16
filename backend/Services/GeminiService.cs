// GeminiService - Integracao com Google Gemini para extracao de documentos e Motor 1
namespace backend.Services;

public class GeminiService
{
    private readonly string _apiKey;
    private readonly string _model;

    public GeminiService(IConfiguration config)
    {
        _apiKey = config["GEMINI_API_KEY"] ?? "";
        _model = config["GEMINI_MODEL"] ?? "gemini-2.0-flash";
    }

    // TODO: implementar chamada para Gemini (extracao de documentos)
    // TODO: implementar Motor 1 (liveness - demo de falha)
}
