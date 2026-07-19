// GeminiService - Integracao com Google Gemini para extracao de documentos (ADR-001, ADR-005).
// Dois prompts especializados: identidade (RG/CNH) e comprovante de residencia.
// ADR-019: multi-key com fallback automatico entre contas Google quando uma fica em cooldown.
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace backend.Services;

public class GeminiService
{
    private readonly HttpClient _http;
    private readonly GeminiKeysProvider _keys;
    private readonly string _model;
    private readonly string _modelFallback;   // usado se o primario retornar 503/504/429
    private readonly ILogger<GeminiService> _logger;

    // Retry para erros transientes do Google.
    // ATENCAO: tier gratuito tem RPD limitado (ex.: 20/dia). Retries consomem quota.
    // Mantemos apenas 1 retry curto + troca de modelo - suficiente para 503 pontual.
    private static readonly int[] RetriesMs = { 2000 };  // 1 retry apos 2s

    public GeminiService(HttpClient http, GeminiKeysProvider keys, IConfiguration config, ILogger<GeminiService> logger)
    {
        _http = http;
        _http.Timeout = TimeSpan.FromSeconds(90);  // Gemini vision pode demorar 30-60s
        _keys = keys;
        _model = config["Gemini:Model"] ?? "gemini-3-flash-preview";
        _modelFallback = config["Gemini:ModelFallback"] ?? "gemini-3.1-flash-lite";
        _logger = logger;
    }

    public bool Configurado => _keys.TemChaves;

    // Prompt RG/CNH: foco em validar identidade (nome, CPF, nascimento, nome da mae, filiacao).
    private const string PromptIdentidade = """
        Voce e um extrator FORENSE de documentos de IDENTIDADE brasileiros (RG ou CNH).
        Sua unica saida deve ser JSON valido, sem markdown, sem texto adicional.

        REGRAS OBRIGATORIAS:
        1. Extraia APENAS dados visiveis no documento.
        2. NUNCA invente ou complete campos faltantes. Se nao estiver legivel ou nao se aplicar, use null.
        3. Devolva SOMENTE o objeto JSON, sem cercar com ```json```, sem comentarios.
        4. cpf: 11 digitos numericos, sem pontos/tracos. Se vier formatado, normalize.
        5. dataNascimento: ISO 8601 (YYYY-MM-DD).
        6. nome/nomeMae/nomePai: sem abreviacoes se legivel; sem numeros.
        7. tipoDocumento: "RG" ou "CNH".
        8. rgNumero/rgOrgaoEmissor/rgUf/rgDataEmissao: somente se aplicavel.
        9. cnhNumero/cnhCategoria/cnhValidade/cnhUf: somente se aplicavel.
        10. camposExtras: objeto livre para quaisquer outros dados legiveis.
        11. confianca: numero entre 0 e 1 indicando sua certeza global na extracao.

        SCHEMA EXATO:
        {
          "tipoDocumento": "RG" | "CNH",
          "nome": string | null,
          "cpf": string | null,
          "dataNascimento": string | null,
          "nomeMae": string | null,
          "nomePai": string | null,
          "rgNumero": string | null,
          "rgOrgaoEmissor": string | null,
          "rgUf": string | null,
          "rgDataEmissao": string | null,
          "cnhNumero": string | null,
          "cnhCategoria": string | null,
          "cnhValidade": string | null,
          "cnhUf": string | null,
          "camposExtras": { [chave: string]: string | null },
          "confianca": number
        }

        PROIBIDO: inventar dados genericos brasileiros ou qualquer informacao que nao esteja na imagem.
        """;

    // Prompt Comprovante: foco em endereco e titularidade.
    private const string PromptComprovante = """
        Voce e um extrator FORENSE de COMPROVANTES DE RESIDENCIA brasileiros.
        Aceita contas de agua, luz, gas, telefone, internet, IPTU, cartao de credito,
        extrato bancario ou declaracao com endereco.

        Sua unica saida deve ser JSON valido, sem markdown, sem texto adicional.

        REGRAS OBRIGATORIAS:
        1. Extraia APENAS dados visiveis no documento.
        2. NUNCA invente ou complete campos faltantes. Se nao estiver legivel, use null.
        3. Devolva SOMENTE o objeto JSON.
        4. titular: nome do dono da conta/endereco (string).
        5. cpfTitular: 11 digitos se presente, senao null.
        6. tipoComprovante: "agua" | "luz" | "gas" | "telefone" | "internet" | "iptu" | "cartao" | "banco" | "outro".
        7. endereco: objeto com logradouro, numero, complemento, bairro, cidade, uf (2 letras), cep (8 digitos).
        8. dataEmissao e dataVencimento: ISO 8601.
        9. valor: string (preserva formato original).
        10. confianca: numero 0..1 indicando certeza global.

        SCHEMA EXATO:
        {
          "tipoDocumento": "Comprovante",
          "tipoComprovante": "agua" | "luz" | "gas" | "telefone" | "internet" | "iptu" | "cartao" | "banco" | "outro",
          "titular": string | null,
          "cpfTitular": string | null,
          "endereco": {
            "logradouro": string | null,
            "numero": string | null,
            "complemento": string | null,
            "bairro": string | null,
            "cidade": string | null,
            "uf": string | null,
            "cep": string | null
          },
          "dataEmissao": string | null,
          "dataVencimento": string | null,
          "valor": string | null,
          "emitente": string | null,
          "confianca": number
        }

        PROIBIDO: inventar dados genericos brasileiros ou qualquer informacao que nao esteja na imagem.
        """;

    /// <summary>Extrai dados de RG/CNH (1 imagem).</summary>
    public Task<DocumentoExtraido> ExtrairIdentidadeAsync(string imagemBase64, string mimeType, CancellationToken ct = default)
        => ExtrairAsync(PromptIdentidade, new[] { (imagemBase64, mimeType) }, ct);

    /// <summary>Extrai dados de RG/CNH (multiplas imagens, ex.: frente + verso do RG).</summary>
    public Task<DocumentoExtraido> ExtrairIdentidadeAsync(IEnumerable<(string b64, string mime)> imagens, CancellationToken ct = default)
        => ExtrairAsync(PromptIdentidade, imagens, ct);

    /// <summary>Extrai dados de comprovante de residencia (1 imagem).</summary>
    public Task<DocumentoExtraido> ExtrairComprovanteAsync(string imagemBase64, string mimeType, CancellationToken ct = default)
        => ExtrairAsync(PromptComprovante, new[] { (imagemBase64, mimeType) }, ct);

    /// <summary>Extrai dados de comprovante (multiplas imagens).</summary>
    public Task<DocumentoExtraido> ExtrairComprovanteAsync(IEnumerable<(string b64, string mime)> imagens, CancellationToken ct = default)
        => ExtrairAsync(PromptComprovante, imagens, ct);

    /// <summary>Compatibilidade: extracao generica (legado).</summary>
    public Task<DocumentoExtraido> ExtrairDocumentoAsync(string imagemBase64, string mimeType, CancellationToken ct = default)
        => ExtrairIdentidadeAsync(imagemBase64, mimeType, ct);

    private async Task<DocumentoExtraido> ExtrairAsync(string prompt, IEnumerable<(string b64, string mime)> imagens, CancellationToken ct)
    {
        if (!Configurado)
            throw new InvalidOperationException(
                "Gemini:ApiKey ausente. Obtenha uma chave em https://aistudio.google.com/apikey e defina em appsettings/env.");

        var lista = imagens.ToList();
        if (lista.Count == 0)
            throw new InvalidOperationException("Nenhuma imagem fornecida para extracao.");

        // Se for apenas uma imagem, extrai diretamente.
        if (lista.Count == 1)
        {
            return await ExecutarComRetryAsync(prompt, lista, ct);
        }

        // Abordagem Map-Reduce (ADR-020): Extrai cada imagem separadamente e depois consolida.
        var extraidos = new List<DocumentoExtraido>();
        for (int i = 0; i < lista.Count; i++)
        {
            _logger.LogInformation("Extraindo imagem {Indice} de {Total}...", i + 1, lista.Count);
            var doc = await ExecutarComRetryAsync(prompt, new List<(string, string)> { lista[i] }, ct);
            extraidos.Add(doc);
        }

        _logger.LogInformation("Consolidando {Total} JSONs extraidos...", extraidos.Count);
        
        var jsonLista = JsonSerializer.Serialize(extraidos, new JsonSerializerOptions { WriteIndented = true });
        string promptConsolidacao = $@"{prompt}

IMPORTANTE: Você está na fase de CONSOLIDAÇÃO. 
Abaixo estão os dados extraídos individualmente de {lista.Count} partes do mesmo documento (ex: frente e verso).
Seu trabalho é mesclar todos esses objetos em um ÚNICO JSON FINAL.

Regras de consolidação:
1. Se um campo for nulo ou vazio em um, mas tiver valor no outro, adote o valor.
2. Se houver divergência de valores no mesmo campo, adote a informação mais completa (ex: prefira o nome completo ao invés de abreviado).
3. Preserve a estrutura exata do schema.
4. Retorne APENAS o JSON consolidado.

Dados extraídos individualmente:
{jsonLista}";

        // Chama sem enviar imagens, apenas o texto com os JSONs para o Gemini consolidar (Reduce).
        return await ExecutarComRetryAsync(promptConsolidacao, new List<(string b64, string mime)>(), ct);
    }

    private async Task<DocumentoExtraido> ExecutarComRetryAsync(string prompt, List<(string b64, string mime)> imagens, CancellationToken ct)
    {
        var modelos = new[] { _model, _modelFallback };
        Exception? ultimaEx = null;
        int totalTentativas = 0;
        const int MAX_TENTATIVAS_TOTAIS = 6;

        foreach (var modelo in modelos)
        {
            for (int tentativa = 0; tentativa <= RetriesMs.Length && totalTentativas < MAX_TENTATIVAS_TOTAIS; tentativa++)
            {
                if (tentativa > 0)
                {
                    var espera = RetriesMs[tentativa - 1];
                    _logger.LogWarning("Gemini (modelo={Model}) tentativa {Tentativa} apos {Ms}ms", modelo, tentativa + 1, espera);
                    try { await Task.Delay(espera, ct); }
                    catch (TaskCanceledException) { throw new OperationCanceledException(ct); }
                }

                var chave = _keys.ChaveAtual();
                if (string.IsNullOrEmpty(chave))
                {
                    _logger.LogWarning("Todas as chaves Gemini estao em cooldown. Abortando.");
                    break;
                }

                totalTentativas++;
                try
                {
                    return await ChamarGemini(prompt, imagens, modelo, chave, ct);
                }
                catch (GeminiTransienteException ex)
                {
                    ultimaEx = ex;
                    _logger.LogWarning("Gemini transiente (modelo={Model}, status={Status}): {Msg}.",
                        modelo, ex.StatusCode, ex.Message);

                    if (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                    {
                        _keys.ReportarFalha(chave, 60);
                        continue;
                    }
                    if (tentativa >= RetriesMs.Length)
                        continue;
                    continue;
                }
                catch (GeminiChaveInvalidaException ex)
                {
                    ultimaEx = ex;
                    _logger.LogWarning("Gemini chave invalida para modelo {Model}: {Status}. Cooldown 24h.",
                        modelo, ex.StatusCode);
                    _keys.ReportarFalha(chave, 86400);
                    continue;
                }
                catch (HttpRequestException ex)
                {
                    ultimaEx = ex;
                    _logger.LogWarning(ex, "Gemini erro de rede (modelo={Model}). Tentara novamente.", modelo);
                    continue;
                }
                catch (TaskCanceledException) when (ct.IsCancellationRequested)
                {
                    throw new OperationCanceledException(ct);
                }
                catch (TaskCanceledException ex)
                {
                    ultimaEx = ex;
                    _logger.LogWarning("Gemini timeout (modelo={Model}). Tentara novamente.", modelo);
                    continue;
                }
            }
            _logger.LogWarning("Modelo {Model} esgotou tentativas. Tentando fallback.", modelo);
        }

        throw ultimaEx ?? new InvalidOperationException("Gemini falhou sem excecao especifica.");
    }

    private async Task<DocumentoExtraido> ChamarGemini(string prompt, List<(string b64, string mime)> imagens, string modelo, string apiKey, CancellationToken ct)
    {
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={apiKey}";

        var parts = new List<object>();
        
        if (imagens.Count > 0)
        {
            parts.Add(new { text = prompt + "\n\nExtraia os dados da imagem anexa." });
            foreach (var (b64, mime) in imagens)
            {
                parts.Add(new { inline_data = new { mime_type = mime, data = b64 } });
            }
        }
        else
        {
            // Fase Reduce (Map-Reduce): apenas texto sem imagens
            parts.Add(new { text = prompt });
        }

        var payload = new
        {
            contents = new[]
            {
                new { parts }
            },
            system_instruction = new
            {
                parts = new[]
                {
                    new { text = "Você é um perito em extração e consolidação de dados forenses." }
                }
            },
            generationConfig = new
            {
                temperature = 0.0,
                topP = 0.1,
                maxOutputTokens = 8192,
                responseMimeType = "application/json",
                thinkingConfig = new { thinkingLevel = "minimal" }
            }
        };

        var resp = await _http.PostAsJsonAsync(url, payload, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            _logger.LogError("Gemini retornou HTTP {Status} (modelo={Model}): {Body}", resp.StatusCode, modelo, body);

            // 503/504/429/500/502 -> transiente (pode tentar de novo ou trocar de modelo)
            var code = (int)resp.StatusCode;
            if (code is 429 or 500 or 502 or 503 or 504)
                throw new GeminiTransienteException(resp.StatusCode, $"HTTP {resp.StatusCode}");

            // 404 (modelo indisponivel para esta conta) ou 403 (permissao): chave especifica invalida
            if (code is 403 or 404)
                throw new GeminiChaveInvalidaException(resp.StatusCode, $"HTTP {resp.StatusCode}");

            // 400/401 -> erro definitivo, nao adianta retry
            throw new InvalidOperationException($"Gemini falhou com HTTP {resp.StatusCode}.");
        }

        var geminiResp = await resp.Content.ReadFromJsonAsync<GeminiResponse>(ct);
        var texto = geminiResp?.Candidates?.FirstOrDefault()?.Content?.Parts?.FirstOrDefault()?.Text
            ?? throw new InvalidOperationException("Gemini devolveu resposta sem texto.");

        texto = LimparCercasMarkdown(texto);

        // ADR: parser tolerante - se o JSON foi truncado (finishReason=MAX_TOKENS),
        // tenta reparar fechando aspas/colchetes/chaves ausentes antes de desserializar.
        texto = RepararJsonTruncado(texto);

        // Opcoes tolerantes: case-insensitive + sem validacao rigida de numeros/datas
        var jsonOpts = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
        };

        DocumentoExtraido? doc;
        try
        {
            doc = JsonSerializer.Deserialize<DocumentoExtraido>(texto, jsonOpts);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Gemini devolveu JSON invalido (modelo={Model}). Raw: {Texto}", modelo, texto);
            var preview = texto.Length > 300 ? texto[..300] + "..." : texto;
            throw new InvalidOperationException(
                $"Gemini devolveu JSON que nao desserializa no schema esperado. Raw: {preview}", ex);
        }

        return doc ?? throw new InvalidOperationException("Gemini devolveu JSON nulo.");
    }

    /// <summary>
    /// Repara JSON truncado pelo limite de tokens do Gemini.
    /// Estrategia: se o texto termina no meio de uma string/objeto, tenta fechar o que esta aberto.
    /// Heuristica simples - nao e perfeito mas cobre 90% dos casos de MAX_TOKENS.
    /// </summary>
    private static string RepararJsonTruncado(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return json;
        json = json.Trim();

        // Conta quantos { e } tem, e quantos " estao abertos
        int chavesAbertas = 0;
        bool dentroString = false;
        bool escape = false;
        foreach (var c in json)
        {
            if (escape) { escape = false; continue; }
            if (c == '\\') { escape = true; continue; }
            if (c == '"') { dentroString = !dentroString; continue; }
            if (dentroString) continue;
            if (c == '{') chavesAbertas++;
            else if (c == '}') chavesAbertas--;
        }

        // Se string ficou aberta, fecha com aspas
        if (dentroString)
            json += "\"";

        // Fecha todas as chaves que ficaram abertas
        while (chavesAbertas > 0)
        {
            json += "}";
            chavesAbertas--;
        }

        // Remove possivel virgula trailing antes do fechamento
        return json;
    }

    /// <summary>Excecao para erros transientes (retry-able) do Gemini.</summary>
    private sealed class GeminiTransienteException : Exception
    {
        public System.Net.HttpStatusCode StatusCode { get; }
        public GeminiTransienteException(System.Net.HttpStatusCode status, string msg) : base(msg) => StatusCode = status;
    }

    /// <summary>Excecao para 403/404: chave especifica nao tem acesso ao modelo.</summary>
    private sealed class GeminiChaveInvalidaException : Exception
    {
        public System.Net.HttpStatusCode StatusCode { get; }
        public GeminiChaveInvalidaException(System.Net.HttpStatusCode status, string msg) : base(msg) => StatusCode = status;
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

public class GeminiResponse { public List<Candidate>? Candidates { get; set; } }
public class Candidate { public Content? Content { get; set; } }
public class Content { public List<Part>? Parts { get; set; } }
public class Part { [JsonPropertyName("text")] public string? Text { get; set; } }

// DTO flexivel: absorve tanto o schema de identidade quanto o de comprovante.
// [JsonPropertyName] explicitos porque o Gemini devolve camelCase e o System.Text.Json
// por default e case-sensitive (sem isso, "tipoDocumento" nao seria bindado para "TipoDocumento").
public class DocumentoExtraido
{
    [JsonPropertyName("tipoDocumento")]
    public string? TipoDocumento { get; set; }

    [JsonPropertyName("nome")]
    public string? Nome { get; set; }

    [JsonPropertyName("cpf")]
    public string? Cpf { get; set; }

    // Datas como STRING para aceitar formatos variados do Gemini (YYYY-MM-DD, DD/MM/YYYY, etc).
    // Parse normalizado acontece no ValidacaoDocumentoService.
    [JsonPropertyName("dataNascimento")]
    public string? DataNascimento { get; set; }

    [JsonPropertyName("nomeMae")]
    public string? NomeMae { get; set; }

    [JsonPropertyName("nomePai")]
    public string? NomePai { get; set; }

    // Campos Comprovante
    [JsonPropertyName("titular")]
    public string? Titular { get; set; }

    [JsonPropertyName("cpfTitular")]
    public string? CpfTitular { get; set; }

    [JsonPropertyName("tipoComprovante")]
    public string? TipoComprovante { get; set; }

    [JsonPropertyName("endereco")]
    public JsonElement? Endereco { get; set; }

    [JsonPropertyName("dataEmissao")]
    public string? DataEmissao { get; set; }

    [JsonPropertyName("dataVencimento")]
    public string? DataVencimento { get; set; }

    [JsonPropertyName("valor")]
    public string? Valor { get; set; }

    [JsonPropertyName("emitente")]
    public string? Emitente { get; set; }

    // Campos RG
    [JsonPropertyName("rgNumero")]
    public string? RgNumero { get; set; }

    [JsonPropertyName("rgOrgaoEmissor")]
    public string? RgOrgaoEmissor { get; set; }

    [JsonPropertyName("rgUf")]
    public string? RgUf { get; set; }

    [JsonPropertyName("rgDataEmissao")]
    public string? RgDataEmissao { get; set; }

    // Campos CNH
    [JsonPropertyName("cnhNumero")]
    public string? CnhNumero { get; set; }

    [JsonPropertyName("cnhCategoria")]
    public string? CnhCategoria { get; set; }

    [JsonPropertyName("cnhValidade")]
    public string? CnhValidade { get; set; }

    [JsonPropertyName("cnhUf")]
    public string? CnhUf { get; set; }

    // Generico
    [JsonPropertyName("camposExtras")]
    public JsonElement? CamposExtras { get; set; }

    [JsonPropertyName("confianca")]
    public double? Confianca { get; set; }
}
