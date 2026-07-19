// LaudoController - Endpoints do Laudo Tecnico Biométrico (ADR-014).
// GET  /api/biometria/laudo/{logId}        - retorna laudo estruturado (lê do DB).
// POST /api/biometria/laudo/{logId}/gerar  - regenera parecer com Gemini a partir de 2 fotos (multipart).
//
// Handler especifico do Laudo: separado do BiometriaController para isolar a logica de
// explicabilidade (Motor 1) da logica de decisao (Motor 2).
using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace backend.Controllers;

[ApiController]
[Route("api/biometria/laudo")]
public class LaudoController(AppDbContext db, Motor1GeminiService motor1) : ControllerBase
{
    /// <summary>Devolve o Laudo Tecnico de uma verificacao.
    /// Se parecerTexto/parecerJson ainda nao foram gerados, retorna parecerPendente=true.
    /// MVP: endpoint publico (read-only, sem dados sensiveis - so metricas + parecer).
    /// TODO producao: proteger com [Authorize] ou escopos limitados (ver ADR futuro).</summary>
    [AllowAnonymous]
    [HttpGet("{logId:long}")]
    public async Task<IActionResult> ObterLaudo(long logId, CancellationToken ct)
    {
        var log = await db.Biometria_Logs.AsNoTracking().FirstOrDefaultAsync(l => l.Id == logId, ct);
        if (log is null)
            return NotFound(new { erro = "LOG_NAO_ENCONTRADO" });

        // Dados do usuario (nome, criadoEm) - opcional se usuarioId for null
        string? nomeUsuario = null;
        if (log.UsuarioId is long uid)
        {
            nomeUsuario = await db.Usuarios.AsNoTracking().Where(u => u.Id == uid).Select(u => u.Nome).FirstOrDefaultAsync(ct);
        }

        // Extrai estrutura do parecerJson (se existir)
        ParecerLaudo? parecer = null;
        List<PontoAnatomico>? pontos = null;
        if (!string.IsNullOrWhiteSpace(log.ParecerJson))
        {
            try { parecer = JsonSerializer.Deserialize<ParecerLaudo>(log.ParecerJson); }
            catch { parecer = null; }
        }
        if (!string.IsNullOrWhiteSpace(log.PontosAnatomicosJson))
        {
            try { pontos = JsonSerializer.Deserialize<List<PontoAnatomico>>(log.PontosAnatomicosJson); }
            catch { pontos = null; }
        }

        var temParecer = !string.IsNullOrWhiteSpace(log.ParecerTexto);

        return Ok(new
        {
            logId = log.Id,
            usuarioId = log.UsuarioId,
            nomeUsuario,
            criadoEm = log.CriadoEm,
            operacao = log.Operacao,
            motor = log.Motor,
            // Cabecalho do laudo (similaridade + decisao)
            similaridade = log.Score.HasValue ? Math.Round(log.Score.Value * 100) : (double?)null,
            decisao = DerivarDecisao(log),
            // Parecer textual
            parecerPendente = !temParecer,
            parecerTexto = log.ParecerTexto,
            parecer,
            // Pontos anatomicos
            pontosAnatomicos = pontos,
            // Auditoria de vivacidade
            liveness = new
            {
                ok = log.LivenessOk,
                detalhe = parecer?.LivenessAuditoria
            },
            // Metricas tecnicas (transparencia)
            metricas = new
            {
                score = log.Score,
                limiar = log.Limiar,
                latenciaMs = log.LatenciaMs,
                device = log.Device,
                motor = log.Motor
            },
            erro = log.Erro
        });
    }

    /// <summary>Regenera o parecer do Laudo chamando o Motor 1 (Gemini) com 2 fotos.
    /// As fotos NAO sao persistidas (ADR-009); so sao usadas em memoria para gerar o parecer.
    /// Endereco util para auditoria forense posterior.</summary>
    [Authorize]
    [HttpPost("{logId:long}/gerar")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> GerarParecer(
        long logId,
        [FromForm] IFormFile referencia,
        [FromForm] IFormFile atual,
        CancellationToken ct)
    {
        var log = await db.Biometria_Logs.FirstOrDefaultAsync(l => l.Id == logId, ct);
        if (log is null)
            return NotFound(new { erro = "LOG_NAO_ENCONTRADO" });

        if (referencia is null || referencia.Length == 0)
            return BadRequest(new { erro = "REFERENCIA_AUSENTE" });
        if (atual is null || atual.Length == 0)
            return BadRequest(new { erro = "ATUAL_AUSENTE" });

        var mimesOk = new[] { "image/jpeg", "image/png", "image/webp" };
        var mimeRef = string.IsNullOrWhiteSpace(referencia.ContentType) ? "image/jpeg" : referencia.ContentType;
        var mimeAtual = string.IsNullOrWhiteSpace(atual.ContentType) ? "image/jpeg" : atual.ContentType;
        if (!mimesOk.Contains(mimeRef) || !mimesOk.Contains(mimeAtual))
            return BadRequest(new { erro = "MIME_NAO_SUPORTADO" });
        if (referencia.Length > 10 * 1024 * 1024 || atual.Length > 10 * 1024 * 1024)
            return BadRequest(new { erro = "IMAGEM_MUITO_GRANDE" });

        var refB64 = await Motor1GeminiService.ParaBase64Async(referencia, ct);
        var atualB64 = await Motor1GeminiService.ParaBase64Async(atual, ct);

        // Prompt do Laudo: especializado em parecer forense (mais rico que o prompt de demo).
        ComparacaoFacialResult comparacao;
        try
        {
            comparacao = await motor1.CompararAsync(refB64, atualB64, mimeRef, ct);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("ausente"))
        {
            return StatusCode(503, new { erro = "GEMINI_NAO_CONFIGURADO", mensagem = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { erro = "MOTOR1_FALHOU", mensagem = ex.Message });
        }

        // Monta o parecer estruturado (ADR-014 - Exemplo de saida)
        var parecer = new ParecerLaudo
        {
            Decisao = DerivarDecisao(log),
            AcaoRecomendada = DerivarAcao(log),
            SimilaridadePct = log.Score.HasValue ? Math.Round(log.Score.Value * 100, 1) : 0,
            Resumo = comparacao.Justificativa ?? "Parecer gerado sem justificativa detalhada.",
            LivenessAuditoria = MontarAuditoriaLiveness(log.LivenessOk, comparacao.Liveness)
        };

        // Pontos anatomicos: o Gemini (Motor1) nao tem schema dedicado para isso ainda.
        // Para o MVP, devolvemos 5 pontos com base no que o modelo reportar.
        // (placeholder neutro caso o Gemini nao traga detalhe)
        var pontos = new List<PontoAnatomico>
        {
            new() { Item = "Distância Interocular", Status = "Inconclusivo", Observacao = "Análise detalhada requer modelo anatômico dedicado." },
            new() { Item = "Estrutura do Nariz", Status = "Inconclusivo", Observacao = "Análise detalhada requer modelo anatômico dedicado." },
            new() { Item = "Arco das Sobrancelhas", Status = "Inconclusivo", Observacao = "Análise detalhada requer modelo anatômico dedicado." },
            new() { Item = "Formato dos Lábios", Status = "Inconclusivo", Observacao = "Análise detalhada requer modelo anatômico dedicado." },
            new() { Item = "Linha do Maxilar e Barba", Status = "Inconclusivo", Observacao = "Análise detalhada requer modelo anatômico dedicado." }
        };

        // Persiste (NAO persiste fotos - ADR-009)
        log.ParecerTexto = parecer.Resumo;
        log.ParecerJson = JsonSerializer.Serialize(parecer);
        log.PontosAnatomicosJson = JsonSerializer.Serialize(pontos);
        await db.SaveChangesAsync(ct);

        Response.Headers["X-Motor"] = "1-gemini-laudo";
        return Ok(new
        {
            logId = log.Id,
            status = "parecer_gerado",
           SimilaridadePct = parecer.SimilaridadePct,
            decisao = parecer.Decisao,
            acaoRecomendada = parecer.AcaoRecomendada,
            parecerTexto = parecer.Resumo,
            parecer,
            pontosAnatomicos = pontos,
            metricasMotor1 = new
            {
                similaridadeGemini = comparacao.SimilaridadeFacial,
                confianca = comparacao.Confianca,
                livenessClassificacao = comparacao.Liveness?.Classificacao,
                livenessConfianca = comparacao.Liveness?.Confianca
            }
        });
    }

    // --- Helpers ---

    private static string DerivarDecisao(BiometriaLog log)
    {
        // Regra ADR-014: livenessOk=false => nunca AUTENTICADO (mesmo com score alto)
        if (log.Erro is not null) return "ERRO";
        if (log.Autenticado) return "AUTENTICADO";
        if (log.Score.HasValue && log.Limiar.HasValue && log.Score >= log.Limiar)
            return "INCONCLUSIVO";  // score ok mas liveness falhou
        return "REJEITADO";
    }

    private static string DerivarAcao(BiometriaLog log)
    {
        return DerivarDecisao(log) switch
        {
            "AUTENTICADO" => "PROSSEGUIR",
            "INCONCLUSIVO" => "RE-VALIDAR",
            "REJEITADO" => "BLOQUEAR",
            _ => "INVESTIGAR"
        };
    }

    private static string MontarAuditoriaLiveness(bool? livenessOk, LivenessResult? livenessGemini)
    {
        if (livenessOk == true && livenessGemini?.Classificacao is "live" or null)
            return "Captura legítima - aprovada no desafio de vivacidade (movimento entre frames) e na análise contextual.";

        if (livenessOk == false)
        {
            var classe = livenessGemini?.Classificacao ?? "indeterminado";
            var indicadores = livenessGemini?.Indicadores != null && livenessGemini.Indicadores.Count > 0
                ? string.Join("; ", livenessGemini.Indicadores)
                : "Falha no desafio de movimento entre frames.";
            return classe switch
            {
                "screen_replay" => $"Falha grave no liveness - trata-se de foto de tela (re-presentation attack). Indicadores: {indicadores}.",
                "printed_photo" => $"Falha no liveness - trata-se de foto impressa (print attack). Indicadores: {indicadores}.",
                "mask" => $"Falha no liveness - possível uso de máscara. Indicadores: {indicadores}.",
                _ => $"Falha no liveness - tipo de ataque indeterminado. Indicadores: {indicadores}."
            };
        }

        return "Liveness não avaliado nesta operação.";
    }
}

// --- Models do Laudo (ADR-014) ---

public class ParecerLaudo
{
    public string? Decisao { get; set; }          // AUTENTICADO | INCONCLUSIVO | REJEITADO | ERRO
    public string? AcaoRecomendada { get; set; }  // PROSSEGUIR | RE-VALIDAR | BLOQUEAR | INVESTIGAR
 public double SimilaridadePct { get; set; }    // 0-100
    public string? Resumo { get; set; }            // parecer textual curto
    public string? LivenessAuditoria { get; set; } // texto descritivo do liveness
}

public class PontoAnatomico
{
    public string? Item { get; set; }       // nome do ponto (distanciaInterocular, ...)
    public string? Status { get; set; }     // Igual | Diferente | Inconclusivo
    public string? Observacao { get; set; } // texto curto justificando
}
