// AdminController - Endpoints administrativos do MVP ( Painel /admin ).
// GET    /api/admin/usuarios           - lista usuarios com metricas agregadas.
// GET    /api/admin/usuarios/{id}      - detalhes de um usuario (com documentos).
// DELETE /api/admin/usuarios/{id}      - exclui usuario (LGPD direito ao esquecimento).
// GET    /api/admin/logs               - ultimos logs biometricos (auditoria).
//
// AVISO: este controller esta SEM autenticacao para o MVP (demo local).
// Em producao, deve ser protegido por role "admin" / API key forte (ver ADR futuro).
using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Route("api/admin")]
[AllowAnonymous]  // MVP: aberto para demo local. TODO: proteger em producao.
public class AdminController(AppDbContext db) : ControllerBase
{
    /// <summary>Lista usuarios cadastrados com metricas agregadas (vetores, docs, ultimo log).</summary>
    [HttpGet("usuarios")]
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
}
