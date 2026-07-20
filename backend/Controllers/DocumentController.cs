// DocumentosController - Extracao de documentos via Gemini (ADR-001, ADR-006, ADR-020).
// Rotas anonimas (apenas IA em memoria, nada persiste).
// - /api/documentos/extrair-identidade -> RG ou CNH (aceita frente+verso, multiplas imagens)
// - /api/documentos/extrair-comprovante -> Comprovante de residencia
using backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]  // rota: /api/documentos
public class DocumentosController(GeminiService gemini) : ControllerBase
{
    /// <summary>Extrai RG ou CNH (documento de identidade) e aplica validacao ADR-006 Camada 1.
    /// Suporta multiplas imagens (frente + verso do RG).</summary>
    [HttpPost("extrair-identidade")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> ExtrairIdentidade([FromForm] List<IFormFile> imagens, CancellationToken ct)
    {
        return await ExtrairGenerico(imagens, gemini.ExtrairIdentidadeAsync, ct);
    }

    /// <summary>Extrai comprovante de residencia (agua, luz, gas, etc.) e aplica validacao.</summary>
    [HttpPost("extrair-comprovante")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> ExtrairComprovante([FromForm] List<IFormFile> imagens, CancellationToken ct)
    {
        return await ExtrairGenerico(imagens, gemini.ExtrairComprovanteAsync, ct);
    }

    /// <summary>Compatibilidade: extracao generica (legado, usa prompt de identidade).</summary>
    [HttpPost("extrair")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Extrair([FromForm] List<IFormFile> imagens, CancellationToken ct)
    {
        return await ExtrairGenerico(imagens, gemini.ExtrairIdentidadeAsync, ct);
    }

    private async Task<IActionResult> ExtrairGenerico(
        List<IFormFile> imagens,
        Func<IEnumerable<(string b64, string mime)>, CancellationToken, Task<DocumentoExtraido>> extrairFn,
        CancellationToken ct)
    {
        if (imagens is null || imagens.Count == 0)
            return BadRequest(new { erro = "IMAGENS_AUSENTES" });
        if (imagens.Count > 5)
            return BadRequest(new { erro = "IMAGENS_EXCESSO", mensagem = "Maximo 5 imagens por requisicao." });

        var mimesOk = new[] { "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif" };
        foreach (var img in imagens)
        {
            if (img.Length == 0) return BadRequest(new { erro = "IMAGEM_VAZIA" });
            if (img.Length > 10 * 1024 * 1024)
                return BadRequest(new { erro = "IMAGEM_MUITO_GRANDE", mensagem = "Maximo 10 MB por imagem." });
            var mime = string.IsNullOrWhiteSpace(img.ContentType) ? "image/jpeg" : img.ContentType;
            if (!mimesOk.Contains(mime))
                return BadRequest(new { erro = "MIME_NAO_SUPORTADO", mime });
        }

        // ADR-020: envia TODAS as imagens para o Gemini consolidar em 1 JSON.
        // Antes so pegava imagens[0], perdendo CPF/rgNumero que estao no verso do RG.
        var lista = new List<(string b64, string mime)>();
        foreach (var img in imagens)
        {
            using var ms = new MemoryStream();
            await img.CopyToAsync(ms, ct);
            var b64 = Convert.ToBase64String(ms.ToArray());
            var mime = string.IsNullOrWhiteSpace(img.ContentType) ? "image/jpeg" : img.ContentType;
            lista.Add((b64, mime));
        }

        DocumentoExtraido doc;
        try
        {
            doc = await extrairFn(lista, ct);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("ausente"))
        {
            return StatusCode(503, new { erro = "GEMINI_NAO_CONFIGURADO", mensagem = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { erro = "EXTRACAO_FALHOU", mensagem = ex.Message });
        }

        var falhas = ValidacaoDocumentoService.ValidarCamada1(doc);
        var bloqueantes = ValidacaoDocumentoService.ApenasBloqueantes(falhas);

        Response.Headers["X-Extracao-Confianca"] = doc.Confianca?.ToString("0.00") ?? "null";
        Response.Headers["X-Extracao-Imagens"] = lista.Count.ToString();

        // Devolve o documento + falhas (informativas + bloqueantes).
        // Se houver bloqueantes, retorna 422 pro frontend mostrar o X.
        // Se so houver opcionais, retorna 200 + avisos (frontend mostra X mas libera continuar).
        if (bloqueantes.Count > 0)
            return UnprocessableEntity(new
            {
                erro = "VALIDACAO_CAMADA1",
                documento = doc,
                falhas,
                bloqueantes,
                imagensEnviadas = lista.Count
            });

        return Ok(new
        {
            documento = doc,
            avisos = falhas,  // pode ser vazio
            imagensEnviadas = lista.Count
        });
    }
}
