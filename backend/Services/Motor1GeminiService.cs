// Motor1GeminiService - Motor 1 de biometria via Gemini 3.5 Flash (ADR-002, ADR-010).
// PROPOSITO: DEMO de comparacao facial por IA generativa. Mostra por que LLM nao serve
// para biometria 1:1 em producao (sem score calibravel, nao deterministico, sem embedding).
// Para producao: usar Motor 2 (DeepFace) via PythonVisionService.
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;

namespace backend.Services;

public class Motor1GeminiService
{
    private readonly HttpClient _http;
    private readonly GeminiKeysProvider _keys;
    private readonly string _model;
    private readonly ILogger<Motor1GeminiService> _logger;

    public Motor1GeminiService(HttpClient http, GeminiKeysProvider keys, IConfiguration config, ILogger<Motor1GeminiService> logger)
    {
        _http = http;
        _http.Timeout = TimeSpan.FromSeconds(90);
        _keys = keys;
        _model = config["Gemini:Model"] ?? "gemini-3-flash-preview";
        _logger = logger;
    }

    public bool Configurado => _keys.TemChaves;

    // Prompt que cobre os 3 pilares descritos pelo AI Studio (comparacao + ICAO + liveness).
    private const string SystemPrompt = """
        Voce e um motor de biometria facial experimental baseado em IA generativa.

        Sua tarefa e analisar DUAS imagens (referencia e atual) e devolver SOMENTE um JSON valido,
        sem markdown, sem texto adicional, no seguinte schema:

        {
          "similaridadeFacial": <inteiro 0-100>,
          "confianca": <numero 0-1>,
          "icaoConformidade": {
            "conforme": <bool>,
            "falhas": [ "string", "string" ]
          },
          "liveness": {
            "classificacao": "live" | "printed_photo" | "screen_replay" | "mask" | "indeterminado",
            "confianca": <numero 0-1>,
            "indicadores": [ "string" ]
          },
          "justificativa": "<string curta, max 200 chars>"
        }

        REGRAS:
        1. similaridadeFacial: 0 = pessoas totalmente diferentes; 100 = mesma pessoa, sem duvida.
        2. Se alguma imagem NAO contiver rosto, devolva similaridadeFacial=0, confianca=0.0,
           e liveness.classificacao="indeterminado".
        3. icaoConformidade.falhas: listar problemas vs ICAO Doc 9303 (expressao nao neutra,
           iluminacao heterogenea, fundo nao neutro, oculos, cabeca inclinada, etc.).
        4. liveness.classificacao: "live" = foto real tirada agora; "printed_photo" = foto de
           foto impressa; "screen_replay" = foto de tela; "mask" = mascara; "indeterminado" = duvida.
        5. justificativa: FRASE CURTA explicando o racional. Portugues Brasil.
        6. NUNCA invente dados. Se duvidar, use "indeterminado" e confianca baixa.
        7. Nao inclua markdown, comentarios ou texto fora do JSON.
        """;

    /// <summary>Compara duas fotos faciais via Gemini (Motor 1 - DEMO).</summary>
    public async Task<ComparacaoFacialResult> CompararAsync(string referenciaB64, string atualB64, string mime, CancellationToken ct = default)
    {
        if (!Configurado)
            throw new InvalidOperationException("Gemini:ApiKey ausente. Configure em appsettings/env.");

        var payload = new
        {
            contents = new[]
            {
                new
                {
                    parts = new object[]
                    {
                        new { text = SystemPrompt + "\n\nImagem 1 = REFERENCIA. Imagem 2 = ATUAL. Analise." },
                        new { inline_data = new { mime_type = mime, data = referenciaB64 } },
                        new { inline_data = new { mime_type = mime, data = atualB64 } }
                    }
                }
            },
            generationConfig = new
            {
                temperature = 0.2,
                topP = 0.2,
                // Aumento: Gemini 3 consome tokens com thinking interno, 2048 truncava JSON.
                maxOutputTokens = 8192,
                responseMimeType = "application/json",
                thinkingConfig = new { thinkingLevel = "minimal" }
            }
        };

        var texto = await ExecutarComFallbackChaves(_model, payload, ct);
        texto = LimparCercasMarkdown(texto);

        ComparacaoFacialResult? result;
        try
        {
            result = JsonSerializer.Deserialize<ComparacaoFacialResult>(texto);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Gemini Motor1 devolveu JSON invalido: {Texto}", texto);
            throw new InvalidOperationException("Gemini devolveu JSON que nao desserializa no schema esperado.", ex);
        }

        return result ?? throw new InvalidOperationException("Gemini devolveu JSON nulo.");
    }

    // Prompt para analise de UMA foto (liveness + ICAO only). Nao compara identidade.
    // Usado no modo comparativo (ADR-017): Motor 1 faz liveness, Motor 2 faz identidade.
    private const string SystemPromptLiveness = """
        Voce e um auditor forense de biometria facial. Sua tarefa e analisar UMA imagem
        e devolver SOMENTE um JSON valido, sem markdown, sem texto adicional, no schema:

        {
          "liveness": {
            "classificacao": "live" | "printed_photo" | "screen_replay" | "mask" | "indeterminado",
            "confianca": <numero 0-1>,
            "indicadores": [ "string" ]
          },
          "icaoConformidade": {
            "conforme": <bool>,
            "falhas": [ "string" ]
          },
          "qualidade": {
            "score": <inteiro 0-100>,
            "problemas": [ "string" ]
          },
          "justificativa": "<string curta, max 200 chars>"
        }

        REGRAS:
        1. liveness.classificacao: "live" = foto real de pessoa presente; "printed_photo" =
           foto de foto impressa; "screen_replay" = foto de tela (celular/monitor); "mask" =
           mascara; "indeterminado" = duvida.
        2. Indicadores de foto de tela: moire pattern, reflexos retangulares, pixels visiveis,
           ausencia de textura de pele natural, bordas de dispositivo, parallax ausente.
        3. Indicadores de foto real: textura natural da pele (poros), reflexos oculares
           coerentes com fonte de luz ambiente, micro-simetrias, profundidade real.
        4. icaoConformidade: verifica ICAO Doc 9303 (expressao neutra, iluminacao uniforme,
           fundo neutro, sem oculos, cabeca ereta, boca fechada, olhos abertos).
        5. qualidade.score: 0 = irreconhecivel; 100 = foto perfeita para biometria.
        6. NUNCA invente dados. Se duvidar, use "indeterminado" e confianca baixa.
        7. justificativa em Portugues Brasil.
        8. Sem markdown, sem texto fora do JSON.
        """;

    /// <summary>Analisa UMA foto para liveness + qualidade (ADR-017). Nao compara identidade.</summary>
    public async Task<AnaliseLivenessResult> AnalisarLivenessAsync(string fotoB64, string mime, CancellationToken ct = default)
    {
        if (!Configurado)
            throw new InvalidOperationException("Gemini:ApiKey ausente. Configure em appsettings/env.");

        var payload = new
        {
            contents = new[]
            {
                new
                {
                    parts = new object[]
                    {
                        new { text = SystemPromptLiveness + "\n\nAnalise esta imagem (1 foto) para liveness + ICAO + qualidade." },
                        new { inline_data = new { mime_type = mime, data = fotoB64 } }
                    }
                }
            },
            generationConfig = new
            {
                temperature = 0.2,
                topP = 0.2,
                // Aumento: Gemini 3 consome tokens com thinking interno.
                maxOutputTokens = 8192,
                responseMimeType = "application/json",
                thinkingConfig = new { thinkingLevel = "minimal" }
            }
        };

        var texto = await ExecutarComFallbackChaves(_model, payload, ct);
        texto = LimparCercasMarkdown(texto);

        AnaliseLivenessResult? result;
        try
        {
            result = JsonSerializer.Deserialize<AnaliseLivenessResult>(texto);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Gemini Motor1 liveness devolveu JSON invalido: {Texto}", texto);
            throw new InvalidOperationException("Gemini devolveu JSON que nao desserializa no schema esperado.", ex);
        }

        return result ?? throw new InvalidOperationException("Gemini devolveu JSON nulo.");
    }

    /// <summary>
    /// Executa chamada Gemini iterando sobre o pool de chaves (ADR-019).
    /// 429 (quota) -> 60s de cooldown para a chave atual + proxima.
    /// 403/404 (modelo/conta) -> 24h de cooldown para a chave atual.
    /// 500/502/503/504 -> 1 retry simples.
    /// Outros -> erro definitivo.
    /// </summary>
    private async Task<string> ExecutarComFallbackChaves(string modelo, object payload, CancellationToken ct)
    {
        Exception? ultimaEx = null;
        for (int i = 0; i < 4; i++)  // ate 4 tentativas (2 chaves x 2 tipos de erro)
        {
            var chave = _keys.ChaveAtual();
            if (string.IsNullOrEmpty(chave))
            {
                _logger.LogWarning("Motor1: todas as chaves Gemini em cooldown. Abortando.");
                break;
            }

            var url = $"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={chave}";

            try
            {
                var resp = await _http.PostAsJsonAsync(url, payload, ct);
                if (resp.IsSuccessStatusCode)
                {
                    var geminiResp = await resp.Content.ReadFromJsonAsync<GeminiResponse>(ct);
                    return geminiResp?.Candidates?.FirstOrDefault()?.Content?.Parts?.FirstOrDefault()?.Text
                        ?? throw new InvalidOperationException("Gemini devolveu resposta sem texto.");
                }

                var body = await resp.Content.ReadAsStringAsync(ct);
                _logger.LogError("Gemini Motor1 retornou HTTP {Status} (modelo={Model}): {Body}", resp.StatusCode, modelo, body);

                var code = (int)resp.StatusCode;
                if (code is 403 or 404)
                {
                    // Modelo/conta invalida: 24h cooldown
                    _keys.ReportarFalha(chave, 86400);
                    continue;
                }
                if (code == 429)
                {
                    // Quota: 60s cooldown, tenta proxima chave
                    _keys.ReportarFalha(chave, 60);
                    continue;
                }
                if (code is 500 or 502 or 503 or 504)
                {
                    // Transiente do Google: espera 2s e tenta de novo com mesma chave
                    if (i == 0) { await Task.Delay(2000, ct); continue; }
                    // Se ja tentou 2x, troca de chave
                    _keys.ReportarFalha(chave, 30);
                    continue;
                }

                // Erro definitivo (400/401)
                throw new InvalidOperationException($"Gemini falhou com HTTP {resp.StatusCode}.");
            }
            catch (TaskCanceledException) when (ct.IsCancellationRequested)
            {
                throw new OperationCanceledException(ct);
            }
            catch (TaskCanceledException ex)
            {
                ultimaEx = ex;
                _logger.LogWarning("Motor1: timeout Gemini. Tentara proxima chave.");
                _keys.ReportarFalha(chave, 30);
                continue;
            }
            catch (HttpRequestException ex)
            {
                ultimaEx = ex;
                _logger.LogWarning("Motor1: erro de rede. Tentara proxima chave.");
                _keys.ReportarFalha(chave, 30);
                continue;
            }
        }

        throw ultimaEx ?? new InvalidOperationException("Gemini falhou apos todas as tentativas (multi-key).");
    }

    /// <summary>Converte IFormFile em base64 (sem prefixo data:).</summary>
    public static async Task<string> ParaBase64Async(IFormFile arquivo, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        await arquivo.CopyToAsync(ms, ct);
        return Convert.ToBase64String(ms.ToArray());
    }

    private static string LimparCercasMarkdown(string s)
    {
        var t = s.Trim();
        if (t.StartsWith("```json", StringComparison.OrdinalIgnoreCase)) t = t[7..];
        else if (t.StartsWith("```")) t = t[3..];
        if (t.EndsWith("```")) t = t[..^3];
        return t.Trim();
    }
}

/// <summary>Resultado da comparacao facial pelo Motor 1 (Gemini).</summary>
public class ComparacaoFacialResult
{
    [JsonPropertyName("similaridadeFacial")]
    public int SimilaridadeFacial { get; set; }

    [JsonPropertyName("confianca")]
    public double Confianca { get; set; }

    [JsonPropertyName("icaoConformidade")]
    public IcaoConformidade? IcaoConformidade { get; set; }

    [JsonPropertyName("liveness")]
    public LivenessResult? Liveness { get; set; }

    [JsonPropertyName("justificativa")]
    public string? Justificativa { get; set; }
}

public class IcaoConformidade
{
    public bool Conforme { get; set; }
    public List<string>? Falhas { get; set; }
}

public class LivenessResult
{
    public string? Classificacao { get; set; }
    public double Confianca { get; set; }
    public List<string>? Indicadores { get; set; }
}

/// <summary>DTO da analise de UMA foto (liveness + qualidade) - ADR-017.</summary>
public class AnaliseLivenessResult
{
    [JsonPropertyName("liveness")]
    public LivenessResult? Liveness { get; set; }

    [JsonPropertyName("icaoConformidade")]
    public IcaoConformidade? IcaoConformidade { get; set; }

    [JsonPropertyName("qualidade")]
    public QualidadeResult? Qualidade { get; set; }

    [JsonPropertyName("justificativa")]
    public string? Justificativa { get; set; }
}

public class QualidadeResult
{
    [JsonPropertyName("score")]
    public int Score { get; set; }

    [JsonPropertyName("problemas")]
    public List<string>? Problemas { get; set; }
}
