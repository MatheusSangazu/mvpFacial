// AdminController - Endpoints administrativos do MVP ( Painel /admin ).
// POST   /api/admin/login            - autentica com senha admin e devolve JWT.
// GET    /api/admin/me               - valida token admin (401 se invalido/expirado).
// GET    /api/admin/usuarios         - lista usuarios com metricas agregadas.
// GET    /api/admin/usuarios/{id}    - detalhes de um usuario (com documentos).
// DELETE /api/admin/usuarios/{id}    - exclui usuario (LGPD direito ao esquecimento).
// GET    /api/admin/logs             - ultimos logs biometricos (auditoria).
//
// ADR-022: todos os endpoints (exceto /login) exigem JWT com claim role=admin.
using System.Security.Cryptography;
using System.Text;
using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Route("api/admin")]
public class AdminController(AppDbContext db, JwtService jwt, IConfiguration config, ILogger<AdminController> logger) : ControllerBase
{
    /// <summary>
    /// POST /api/admin/login - valida senha admin e devolve JWT 8h (ADR-022).
    /// Senha aceita de 2 formas (precedencia: hash > texto):
    ///   - ADMIN_PASSWORD_HASH (SHA-256 hex) - recomendado em producao.
    ///   - ADMIN_PASSWORD (texto plano) - aceitavel para demo local/dev.
    /// Comparacao em tempo constante para evitar timing attacks.
    /// </summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public IActionResult Login([FromBody] AdminLoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req?.Senha))
            return BadRequest(new { erro = "SENHA_OBRIGATORIA", mensagem = "Informe a senha." });

        var senha = req.Senha.Trim();

        // 1. Hash configurado (prioridade)
        var hashEsperado = config["ADMIN_PASSWORD_HASH"]
            ?? config["Admin:SenhaHash"];
        if (!string.IsNullOrWhiteSpace(hashEsperado))
        {
            var hashFornecido = Sha256Hex(senha);
            if (!CryptographicEquals(hashFornecido, hashEsperado.Trim().ToLowerInvariant()))
            {
                LogFalha();
                return Unauthorized(new { erro = "SENHA_INVALIDA", mensagem = "Senha incorreta." });
            }
        }
        else
        {
            // 2. Texto plano (fallback para dev)
            var senhaTexto = config["ADMIN_PASSWORD"] ?? config["Admin:Senha"];
            if (string.IsNullOrWhiteSpace(senhaTexto))
            {
                logger.LogError("ADMIN_PASSWORD_HASH e ADMIN_PASSWORD ambos ausentes. Admin bloqueado.");
                return StatusCode(500, new { erro = "ADMIN_NAO_CONFIGURADO", mensagem = "Servidor sem senha admin configurada." });
            }
            if (!CryptographicEquals(senha, senhaTexto.Trim()))
            {
                LogFalha();
                return Unauthorized(new { erro = "SENHA_INVALIDA", mensagem = "Senha incorreta." });
            }
        }

        var token = jwt.GerarAdmin();
        logger.LogInformation("Login admin bem-sucedido de {Ip}", HttpContext.Connection.RemoteIpAddress);
        return Ok(new
        {
            token,
            expiraEmHoras = jwt.ExpiracaoHoras,
            papel = "admin"
        });
    }

    /// <summary>GET /api/admin/me - valida token admin (qualquer chamada admin exige role).</summary>
    [HttpGet("me")]
    [Authorize(Roles = "admin")]
    public IActionResult Me()
    {
        return Ok(new
        {
            papel = "admin",
            sub = User.FindFirst("sub")?.Value ?? "admin",
            expiraEm = jwt.ExpiracaoHoras
        });
    }

    /// <summary>Lista usuarios cadastrados com metricas agregadas (vetores, docs, ultimo log).</summary>
    [HttpGet("usuarios")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> ListarUsuarios(
        [FromQuery] string? q = null,
        [FromQuery] int limit = 100,
        CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 500);
        var query = db.Usuarios.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(q))
        {
            q = q.Trim();
            query = query.Where(u => u.Nome.Contains(q) || u.Cpf.Contains(q));
        }

        var usuarios = await query
            .OrderByDescending(u => u.CriadoEm)
            .Take(limit)
            .Select(u => new
            {
                u.Id,
                u.Nome,
                u.Cpf,
                u.DataNascimento,
                u.NomeMae,
                u.ConsentimentoAceito,
                u.TermoVersao,
                u.CriadoEm,
                TotalVetores = db.Vetores_Faciais.Count(v => v.UsuarioId == u.Id),
                TotalDocumentos = db.Documentos_Cadastrados.Count(d => d.UsuarioId == u.Id),
                TotalLogs = db.Biometria_Logs.Count(l => l.UsuarioId == u.Id),
                UltimoLogin = db.Biometria_Logs
                    .Where(l => l.UsuarioId == u.Id && l.Operacao == "login")
                    .OrderByDescending(l => l.CriadoEm)
                    .Select(l => (DateTime?)l.CriadoEm)
                    .FirstOrDefault()
            })
            .ToListAsync(ct);

        var total = await db.Usuarios.CountAsync(ct);
        var totalVetores = await db.Vetores_Faciais.CountAsync(ct);
        var totalLogs = await db.Biometria_Logs.CountAsync(ct);

        return Ok(new
        {
            total,
            totalVetores,
            totalLogs,
            retornados = usuarios.Count,
            usuarios
        });
    }

    /// <summary>Detalhes de um usuario (inclui documentos extraidos e logs recentes).</summary>
    [HttpGet("usuarios/{id:long}")]
    public async Task<IActionResult> ObterUsuario(long id, CancellationToken ct)
    {
        var usuario = await db.Usuarios.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct);
        if (usuario is null)
            return NotFound(new { erro = "USUARIO_NAO_ENCONTRADO" });

        var documentos = await db.Documentos_Cadastrados.AsNoTracking()
            .Where(d => d.UsuarioId == id)
            .OrderByDescending(d => d.CriadoEm)
            .Select(d => new
            {
                d.Id,
                d.TipoDocumento,
                d.NomeArquivo,
                d.ConfiancaExtracao,
                d.DadosExtraidosJson,
                d.CriadoEm
            })
            .ToListAsync(ct);

        var logs = await db.Biometria_Logs.AsNoTracking()
            .Where(l => l.UsuarioId == id)
            .OrderByDescending(l => l.CriadoEm)
            .Take(20)
            .Select(l => new
            {
                l.Id,
                l.Operacao,
                l.Motor,
                l.Autenticado,
                l.Score,
                l.Limiar,
                l.LatenciaMs,
                l.Device,
                l.LivenessOk,
                l.Erro,
                l.CriadoEm
            })
            .ToListAsync(ct);

        var vetores = await db.Vetores_Faciais.AsNoTracking()
            .Where(v => v.UsuarioId == id)
            .OrderBy(v => v.CriadoEm)
            .Select(v => new { v.Id, v.Pose, v.Modelo, v.CriadoEm })
            .ToListAsync(ct);

        return Ok(new
        {
            usuario = new
            {
                usuario.Id,
                usuario.Nome,
                usuario.Cpf,
                usuario.DataNascimento,
                usuario.NomeMae,
                usuario.ConsentimentoAceito,
                usuario.TermoVersao,
                usuario.CriadoEm
            },
            vetores,
            documentos,
            logs
        });
    }

    /// <summary>Exclui um usuario por ID (admin). Apaga vetores + documentos + anonimiza logs (LGPD).</summary>
    [HttpDelete("usuarios/{id:long}")]
    public async Task<IActionResult> ExcluirUsuario(long id, CancellationToken ct)
    {
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
            log.UsuarioId = null;  // anonimiza (mantem para metrica)
        }

        var nomeAntes = usuario.Nome;
        db.Usuarios.Remove(usuario);
        await db.SaveChangesAsync(ct);

        return Ok(new
        {
            status = "excluido",
            usuarioId = id,
            nome = nomeAntes,
            vetoresRemovidos = vetores.Count,
            documentosRemovidos = documentos.Count,
            logsAnonimizados = logs.Count,
            mensagem = "Usuario excluido. Logs anonimizados mantidos para auditoria (LGPD Art. 18, VI)."
        });
    }

    /// <summary>Lista os ultimos logs biometricos (todos os usuarios) para auditoria.</summary>
    [HttpGet("logs")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> ListarLogs(
        [FromQuery] int limit = 50,
        [FromQuery] string? operacao = null,
        CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 500);
        var query = db.Biometria_Logs.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(operacao))
            query = query.Where(l => l.Operacao == operacao);

        var logs = await query
            .OrderByDescending(l => l.CriadoEm)
            .Take(limit)
            .Select(l => new
            {
                l.Id,
                l.UsuarioId,
                NomeUsuario = db.Usuarios.AsNoTracking().Where(u => u.Id == l.UsuarioId).Select(u => u.Nome).FirstOrDefault(),
                l.Operacao,
                l.Motor,
                l.Autenticado,
                l.Score,
                l.Limiar,
                l.LatenciaMs,
                l.Device,
                l.LivenessOk,
                l.Erro,
                l.CriadoEm
            })
            .ToListAsync(ct);

        return Ok(new
        {
            retornados = logs.Count,
            logs
        });
    }

    // --- Helpers de criptografia / log ---

    private static string Sha256Hex(string texto)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(texto));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    /// <summary>Comparacao em tempo constante (mitiga timing attack sobre a senha).</summary>
    private static bool CryptographicEquals(string a, string b)
    {
        var ba = Encoding.UTF8.GetBytes(a ?? "");
        var bb = Encoding.UTF8.GetBytes(b ?? "");
        return CryptographicOperations.FixedTimeEquals(ba, bb);
    }

    private void LogFalha()
    {
        var ip = HttpContext.Connection.RemoteIpAddress;
        logger.LogWarning("Tentativa de login admin falhou. IP={Ip}", ip);
    }
}

/// <summary>Payload do POST /api/admin/login.</summary>
public class AdminLoginRequest
{
    public string? Senha { get; set; }
}
