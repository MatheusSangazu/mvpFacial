// AuthController - Endpoints de autenticacao (cadastro, login facial, perfil)
using System.Text.Json;
using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController(AppDbContext db, JwtService jwt) : ControllerBase
{
    /// <summary>Cadastra um novo usuario + documentos extraidos (se fornecidos).</summary>
    [HttpPost("cadastro")]
    public async Task<IActionResult> Cadastro([FromBody] CadastroRequest req, CancellationToken ct)
    {
        // Validacao Camada 1 (ADR-006) - digitos de CPF
        var cpf = ValidacaoCpfService.Formatar(req.Cpf);
        if (cpf is null)
            return BadRequest(new { erro = "CPF_INVALIDO", mensagem = "CPF com digitos verificadores invalidos." });

        // Nome obrigatorio nao vazio
        if (string.IsNullOrWhiteSpace(req.Nome))
            return BadRequest(new { erro = "NOME_OBRIGATORIO" });

        if (!req.ConsentimentoAceito)
            return BadRequest(new { erro = "CONSENTIMENTO_OBRIGATORIO", mensagem = "LGPD: consentimento e obrigatorio." });

        // CPF unico
        if (await db.Usuarios.AnyAsync(u => u.Cpf == cpf, ct))
            return Conflict(new { erro = "CPF_JA_CADASTRADO" });

        var usuario = new Usuario
        {
            Nome = req.Nome.Trim(),
            Cpf = cpf,
            DataNascimento = req.DataNascimento,
            NomeMae = string.IsNullOrWhiteSpace(req.NomeMae) ? null : req.NomeMae.Trim(),
            ConsentimentoAceito = true,
            TermoVersao = "1.0"
        };

        // Valida que o termo existe e esta ativo
        var termoAtivo = await db.Termos_Consentimento.AnyAsync(t => t.Versao == usuario.TermoVersao && t.Ativo, ct);
        if (!termoAtivo)
            return BadRequest(new { erro = "TERMO_INDISPONIVEL", mensagem = $"Termo {usuario.TermoVersao} nao encontrado ou inativo." });

        db.Usuarios.Add(usuario);
        await db.SaveChangesAsync(ct);

        // Persiste documentos extraidos (apenas dados, nunca arquivos - ADR-009)
        int docsPersistidos = 0;
        if (req.Documentos is { Count: > 0 })
        {
            foreach (var d in req.Documentos)
            {
                if (d?.DadosExtraidosJson is null) continue;
                db.Documentos_Cadastrados.Add(new DocumentoCadastrado
                {
                    UsuarioId = usuario.Id,
                    TipoDocumento = d.TipoDocumento ?? "Desconhecido",
                    NomeArquivo = d.NomeArquivo,
                    DadosExtraidosJson = d.DadosExtraidosJson,
                    ConfiancaExtracao = d.Confianca?.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)
                });
                docsPersistidos++;
            }
            if (docsPersistidos > 0)
                await db.SaveChangesAsync(ct);
        }

        var token = jwt.Gerar(usuario.Id, usuario.Cpf, usuario.Nome);
        return CreatedAtAction(nameof(Me), new { id = usuario.Id }, new
        {
            usuario = new { usuario.Id, usuario.Nome, usuario.Cpf, usuario.TermoVersao },
            documentosPersistidos = docsPersistidos,
            token,
            expiraEmHoras = 8
        });
    }

    /// <summary>Devolve os dados do usuario autenticado (valida o JWT).</summary>
    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var sub = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (!long.TryParse(sub, out var id))
            return Unauthorized();

        var usuario = await db.Usuarios.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct);
        if (usuario is null) return NotFound();

        var documentos = await db.Documentos_Cadastrados.AsNoTracking()
            .Where(d => d.UsuarioId == id)
            .Select(d => new { d.Id, d.TipoDocumento, d.NomeArquivo, d.ConfiancaExtracao, d.CriadoEm })
            .ToListAsync(ct);

        return Ok(new
        {
            usuario.Id,
            usuario.Nome,
            usuario.Cpf,
            usuario.DataNascimento,
            usuario.NomeMae,
            usuario.ConsentimentoAceito,
            usuario.TermoVersao,
            usuario.CriadoEm,
            temVetoresFaciais = await db.Vetores_Faciais.AnyAsync(v => v.UsuarioId == id, ct),
            documentos
        });
    }

    /// <summary>Login facial - stub (login real e via /api/biometria/verificar).</summary>
    [HttpPost("login/facial")]
    public IActionResult LoginFacial([FromBody] LoginFacialRequest req)
    {
        return Ok(new
        {
            autenticado = false,
            mensagem = "Use POST /api/biometria/verificar para login facial real.",
            metricas = new
            {
                motor = req.Motor,
                latenciaMs = 0,
                score = 0.0,
                limiar = 0.60,
                device = req.Dispositivo,
                livenessOk = false
            }
        });
    }

    /// <summary>Exclusao de conta (LGPD - direito ao esquecimento).
    /// Remove o usuario + vetores faciais + documentos cadastrados + anonimiza metricas.</summary>
    [Authorize]
    [HttpDelete("usuario")]
    public async Task<IActionResult> ExcluirConta(CancellationToken ct)
    {
        var sub = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (!long.TryParse(sub, out var id))
            return Unauthorized();

        var usuario = await db.Usuarios.FirstOrDefaultAsync(u => u.Id == id, ct);
        if (usuario is null)
            return NotFound(new { erro = "USUARIO_NAO_ENCONTRADO" });

        var vetores = await db.Vetores_Faciais.Where(v => v.UsuarioId == id).ToListAsync(ct);
        db.Vetores_Faciais.RemoveRange(vetores);

        var documentos = await db.Documentos_Cadastrados.Where(d => d.UsuarioId == id).ToListAsync(ct);
        db.Documentos_Cadastrados.RemoveRange(documentos);

        var logs = await db.Biometria_Logs.Where(l => l.UsuarioId == id).ToListAsync(ct);
        foreach (var log in logs)
        {
            log.UsuarioId = null;
        }

        db.Usuarios.Remove(usuario);
        await db.SaveChangesAsync(ct);

        return Ok(new
        {
            status = "excluido",
            usuarioId = id,
            vetoresRemovidos = vetores.Count,
            documentosRemovidos = documentos.Count,
            logsAnonimizados = logs.Count,
            mensagem = "Conta excluida conforme LGPD (Art. 18, VI). Dados agregados anonimizados mantidos para auditoria."
        });
    }
}

// DTO do request de cadastro
public class CadastroRequest
{
    public string Nome { get; set; } = "";
    public string Cpf { get; set; } = "";
    public DateTime? DataNascimento { get; set; }
    public string? NomeMae { get; set; }
    public bool ConsentimentoAceito { get; set; }
    // Documentos extraidos pela IA antes do cadastro (serao persistidos junto)
    public List<DocumentoCadastradoDto>? Documentos { get; set; }
}

public class DocumentoCadastradoDto
{
    public string? TipoDocumento { get; set; }   // RG | CNH | Comprovante
    public string? NomeArquivo { get; set; }
    public string? DadosExtraidosJson { get; set; }  // JSON serializado da extracao
    public double? Confianca { get; set; }
}

// DTO do request de login facial
public class LoginFacialRequest
{
    public int Motor { get; set; }
    public string Dispositivo { get; set; } = "cpu";
    public string Midia { get; set; } = "";
}

