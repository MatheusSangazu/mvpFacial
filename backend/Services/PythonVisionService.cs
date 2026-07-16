// PythonVisionService - Cliente HTTP para o vision-service (Motor 2)
namespace backend.Services;

public class PythonVisionService
{
    private readonly string _url;
    private readonly string _token;
    private readonly HttpClient _client;

    public PythonVisionService(IConfiguration config, HttpClient client)
    {
        _url = config["VISION_SERVICE_URL"] ?? "http://localhost:8000";
        _token = config["VISION_SERVICE_TOKEN"] ?? "";
        _client = client;
    }

    // TODO: implementar POST /embeddings
    // TODO: implementar POST /verificar
    // TODO: implementar POST /liveness
}
