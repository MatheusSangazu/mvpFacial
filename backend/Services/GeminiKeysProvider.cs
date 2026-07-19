// GeminiKeysProvider - gerencia multiplas chaves de API do Gemini com fallback.
// Quando a chave primaria apresenta erro transiente (429 quota excedida, 404 modelo
// indisponivel, 403 permissao), o sistema tenta automaticamente a proxima chave.
// ADR-019: multi-key fallback para contornar limites do tier gratuito do AI Studio.
using System.Collections.Concurrent;
using Microsoft.Extensions.Configuration;

namespace backend.Services;

/// <summary>Compartilha o pool de chaves entre GeminiService e Motor1GeminiService.</summary>
public class GeminiKeysProvider
{
    private readonly List<string> _chaves;
    private readonly ILogger<GeminiKeysProvider> _logger;
    private int _indiceAtual;

    /// <summary>Marca de quando cada chave ficou em cooldown (quota excedida). DateTime.MinValue = liberada.</summary>
    private readonly ConcurrentDictionary<int, DateTime> _cooldownAte = new();

    public GeminiKeysProvider(IConfiguration config, ILogger<GeminiKeysProvider> logger)
    {
        _logger = logger;
        var lista = new List<string>();

        // 1. Chave primaria (Gemini:ApiKey) - sempre primeira
        var primaria = config["Gemini:ApiKey"] ?? config["GEMINI_API_KEY"] ?? "";
        if (!string.IsNullOrWhiteSpace(primaria)) lista.Add(primaria.Trim());

        // 2. Chaves adicionais (Gemini:ApiKeys:0, :1, ...) - fallback
        var extras = config.GetSection("Gemini:ApiKeys").Get<string[]>() ?? Array.Empty<string>();
        foreach (var k in extras)
        {
            if (!string.IsNullOrWhiteSpace(k) && !lista.Contains(k.Trim()))
                lista.Add(k.Trim());
        }

        _chaves = lista;
        _indiceAtual = 0;

        _logger.LogInformation("GeminiKeysProvider inicializado com {Count} chave(s).", _chaves.Count);
    }

    public bool TemChaves => _chaves.Count > 0;

    /// <summary>Devolve a chave atualmente ativa (ou null se todas em cooldown).</summary>
    public string? ChaveAtual()
    {
        lock (this)
        {
            // Procura primeira chave fora de cooldown, comecando pela atual.
            for (int i = 0; i < _chaves.Count; i++)
            {
                var idx = (_indiceAtual + i) % _chaves.Count;
                if (!_cooldownAte.TryGetValue(idx, out var ate) || ate <= DateTime.UtcNow)
                {
                    _indiceAtual = idx;
                    return _chaves[idx];
                }
            }
        }
        return null;  // todas em cooldown
    }

    /// <summary>Avanca para a proxima chave disponivel (chamado apos falha).</summary>
    public string? ProximaChave()
    {
        lock (this)
        {
            for (int i = 1; i <= _chaves.Count; i++)
            {
                var idx = (_indiceAtual + i) % _chaves.Count;
                if (!_cooldownAte.TryGetValue(idx, out var ate) || ate <= DateTime.UtcNow)
                {
                    _indiceAtual = idx;
                    return _chaves[idx];
                }
            }
        }
        return null;
    }

    /// <summary>Coloca a chave informada em cooldown (ex.: 429 = 60s, 404/403 = permanente).</summary>
    public void ReportarFalha(string? chave, int cooldownSegundos)
    {
        if (string.IsNullOrEmpty(chave)) return;
        var idx = _chaves.IndexOf(chave);
        if (idx < 0) return;

        if (cooldownSegundos <= 0)
        {
            // Cooldown permanente (modelo/conta invalida): 24h
            cooldownSegundos = 86400;
        }

        _cooldownAte[idx] = DateTime.UtcNow.AddSeconds(cooldownSegundos);
        _logger.LogWarning(
            "Chave Gemini #{Idx} (sufixo ...{Sufixo}) em cooldown por {Seg}s.",
            idx + 1, chave[^8..], cooldownSegundos);
    }

    /// <summary>Informacao de diagnostico para /health.</summary>
    public object Diagnostico()
    {
        lock (this)
        {
            var agora = DateTime.UtcNow;
            return new
            {
                totalChaves = _chaves.Count,
                indiceAtual = _indiceAtual + 1,
                chaves = _chaves.Select((c, i) => new
                {
                    ordem = i + 1,
                    sufixo = "..." + c[^8..],
                    emCooldown = _cooldownAte.TryGetValue(i, out var ate) && ate > agora,
                    disponivelEm = _cooldownAte.TryGetValue(i, out var a) && a > agora ? a.ToString("o") : null,
                }),
            };
        }
    }
}
