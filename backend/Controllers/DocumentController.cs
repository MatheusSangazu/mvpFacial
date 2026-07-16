// DocumentController - Endpoints de extracao de documentos com Gemini
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DocumentController : ControllerBase
{
    // POST: api/document/extrair
    [HttpPost("extrair")]
    public async Task<IActionResult> Extrair([FromForm] List<IFormFile> imagens)
    {
        // TODO: repassar imagens para o GeminiService com System Prompt estruturado
        // Validar resultado (ADR-006): CPF, datas, API externa, consistencia
        return Ok(new
        {
            nome = "",
            cpf = "",
            dataNascimento = "",
            tipoDocumento = "",
            camposExtras = new { },
            confianca = 0.0
        });
    }
}
