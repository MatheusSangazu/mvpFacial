// PythonVisionService - Cliente HTTP para o vision-service Python (Motor 2 - DeepFace).
// Comunica-se com a API FastAPI em /embeddings, /verificar, /liveness.
// Autenticacao via header X-Internal-Token (compartilhado com vision-service/.env).
using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace backend.Services;

public class PythonVisionService
{
    private readonly HttpClient _client;
    private readonly string _token;
    private readonly ILogger<PythonVisionService> _logger;

    public PythonVisionService(HttpClient client, IConfiguration config, ILogger<PythonVisionService> logger)
    {
        _client = client;
        // Alinha com appsettings.Development.json: VisionService:Url e VisionService:Token
        var baseUrl = config["VisionService:Url"] ?? config["VISION_SERVICE_URL"] ?? "http://localhost:8000";
        if (!baseUrl.EndsWith("/")) baseUrl += "/";
        _client.BaseAddress = new Uri(baseUrl);
        _client.Timeout = TimeSpan.FromSeconds(120);  // primeira chamada do DeepFace baixa o modelo Facenet
        _token = config["VisionService:Token"] ?? config["VISION_SERVICE_TOKEN"] ?? "";
        _logger = logger;
    }

    /// <summary>Gera embeddings a partir de uma ou mais fotos de rosto (cadastro - ADR-004).</summary>
    public async Task<EmbeddingsResponse> GerarEmbeddingsAsync(IEnumerable<(byte[] bytes, string mime)> imagens, CancellationToken ct = default)
    {
        using var form = new MultipartFormDataContent();
        foreach (var (bytes, mime) in imagens)
        {
            var content = new ByteArrayContent(bytes);
            content.Headers.ContentType = new MediaTypeHeaderValue(mime);
            form.Add(content, "files", "imagem.jpg");
        }

        var req = new HttpRequestMessage(HttpMethod.Post, "embeddings") { Content = form };
        req.Headers.Add("X-Internal-Token", _token);

        var resp = await _client.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            _logger.LogError("vision-service /embeddings devolveu HTTP {Status}: {Body}", resp.StatusCode, body);
            throw VisionException.FromBody(body, (int)resp.StatusCode);
        }

        return await resp.Content.ReadFromJsonAsync<EmbeddingsResponse>(ct)
            ?? throw new InvalidOperationException("vision-service devolveu resposta nula em /embeddings.");
    }

    /// <summary>Verifica identidade facial comparando a foto atual contra os vetores cadastrados (login - ADR-004).</summary>
    public async Task<VerificarResponse> VerificarAsync(string imagemAtualB64, IEnumerable<string> vetoresCadastradosCifrados, double limiar, CancellationToken ct = default)
    {
        // Importante: vetoresCadastradosCadastradosCifrados chegam cifrados (AES-256-GCM).
        // Quem decifra e o backend ANTES de chamar o vision-service. Aqui recebemos ja decifrados.
        // Para evitar confusao de API, renomeamos o parametro no caller.
        throw new NotImplementedException("Use VerificarAsync(string imagem, List<List<float>> vetores, double limiar).");
    }

    /// <summary>Verifica identidade facial comparando a foto atual contra os vetores decifrados.</summary>
    public async Task<VerificarResponse> VerificarAsync(string imagemAtualB64, List<List<float>> vetoresCadastrados, double limiar, CancellationToken ct = default)
    {
        var body = new
        {
            imagemAtual = imagemAtualB64,
            vetoresCadastrados = vetoresCadastrados,
            limiar = limiar
        };

        var req = new HttpRequestMessage(HttpMethod.Post, "verificar")
        {
            Content = JsonContent.Create(body)
        };
        req.Headers.Add("X-Internal-Token", _token);

        var resp = await _client.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            _logger.LogError("vision-service /verificar devolveu HTTP {Status}: {Body}", resp.StatusCode, err);
            throw VisionException.FromBody(err, (int)resp.StatusCode);
        }

        return await resp.Content.ReadFromJsonAsync<VerificarResponse>(ct)
            ?? throw new InvalidOperationException("vision-service devolveu resposta nula em /verificar.");
    }

    /// <summary>Executa desafio de liveness com 2+ frames.</summary>
    public async Task<LivenessResponse> LivenessAsync(IEnumerable<byte[]> frames, CancellationToken ct = default)
    {
        using var form = new MultipartFormDataContent();
        var i = 0;
        foreach (var frame in frames)
        {
            var content = new ByteArrayContent(frame);
            content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
            form.Add(content, "files", $"frame_{i++}.jpg");
        }

        var req = new HttpRequestMessage(HttpMethod.Post, "liveness") { Content = form };
        req.Headers.Add("X-Internal-Token", _token);

        var resp = await _client.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw VisionException.FromBody(err, (int)resp.StatusCode);
        }

        return await resp.Content.ReadFromJsonAsync<LivenessResponse>(ct)
            ?? throw new InvalidOperationException("vision-service devolveu resposta nula em /liveness.");
    }
}

// Respostas do vision-service (espelham main.py)
public class EmbeddingsResponse
{
    public List<List<float>>? Embeddings { get; set; }
    public string? Modelo { get; set; }
    public string? Device { get; set; }
    public int LatenciaMs { get; set; }
    public int Quantidade { get; set; }
}

public class VerificarResponse
{
    public bool Autenticado { get; set; }
    public double Score { get; set; }
    public bool LivenessOk { get; set; }
    public string? Device { get; set; }
    public int LatenciaMs { get; set; }
}

public class LivenessResponse
{
    public bool LivenessOk { get; set; }
    public bool MovimentoDetectado { get; set; }
    public int FramesAnalisados { get; set; }
}
