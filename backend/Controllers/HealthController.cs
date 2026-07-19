// HealthController - Healthcheck do backend + utilitario de migracao (schema.sql)
using System.Text;
using backend.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MySqlConnector;

namespace backend.Controllers;

[ApiController]
[Route("[controller]")]
public class HealthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;

    public HealthController(AppDbContext db, IWebHostEnvironment env, IConfiguration config)
    {
        _db = db;
        _env = env;
        _config = config;
    }

    [HttpGet]
    public IActionResult Get() => Ok(new { status = "ok" });

    /// <summary>
    /// Aplica o schema.sql no banco (idempotente). ADR-012: schema.sql e a fonte de verdade.
    /// Usa MySqlConnection direto para suportar SET @var / PREPARE / EXECUTE (EF Core nao suporta).
    /// </summary>
    [HttpPost("migrate")]
    public async Task<IActionResult> Migrate(CancellationToken ct)
    {
        var caminhos = new[]
        {
            Path.Combine(_env.ContentRootPath, "Data", "schema.sql"),
            Path.Combine(_env.ContentRootPath, "backend", "Data", "schema.sql"),
            Path.Combine(Directory.GetCurrentDirectory(), "Data", "schema.sql"),
        };
        string? schema = caminhos.FirstOrDefault(System.IO.File.Exists);
        if (schema is null)
            return NotFound(new { erro = "SCHEMA_NAO_ENCONTRADO", tentativas = caminhos });

        var sql = await System.IO.File.ReadAllTextAsync(schema, ct);

        var connectionString = _config.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default ausente.");

        // Remove comentarios -- linha a linha (MySQLConnector reclama se deixar)
        var linhas = sql.Replace("\r\n", "\n").Split('\n');
        var stmtBuilder = new StringBuilder();
        var statements = new List<string>();
        foreach (var raw in linhas)
        {
            var line = raw;
            var idx = line.IndexOf("--", StringComparison.Ordinal);
            if (idx >= 0) line = line[..idx];
            line = line.Trim();
            if (line.Length == 0) continue;

            if (stmtBuilder.Length > 0) stmtBuilder.Append('\n');
            stmtBuilder.Append(line);

            if (line.EndsWith(";"))
            {
                var stmt = stmtBuilder.ToString().Trim();
                if (!string.IsNullOrWhiteSpace(stmt))
                    statements.Add(stmt);
                stmtBuilder.Clear();
            }
        }
        if (stmtBuilder.Length > 0)
        {
            var rest = stmtBuilder.ToString().Trim();
            if (!string.IsNullOrWhiteSpace(rest))
                statements.Add(rest);
        }

        var aplicados = 0;
        var erros = new List<string>();
        await using var conn = new MySqlConnection(connectionString);
        await conn.OpenAsync(ct);

        // Sessao MySQL unica - permite SET @var / PREPARE / EXECUTE entre statements
        foreach (var stmt in statements)
        {
            try
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = stmt;
                await cmd.ExecuteNonQueryAsync(ct);
                aplicados++;
            }
            catch (MySqlException ex)
            {
                // 1050 = tabela ja existe, 1060/1068 = coluna/chave duplicada - tudo OK em migracao idempotente
                if (ex.Number is 1050 or 1060 or 1068)
                {
                    aplicados++;  // nao conta como erro real
                    continue;
                }
                erros.Add($"[{ex.Number}] {ex.Message.Split('\n')[0]} (stmt: {PrimeirasPalavras(stmt, 8)})");
            }
            catch (Exception ex)
            {
                erros.Add($"{ex.Message.Split('\n')[0]} (stmt: {PrimeirasPalavras(stmt, 8)})");
            }
        }

        return Ok(new
        {
            status = "migrado",
            statementsTotais = statements.Count,
            statementsAplicados = aplicados,
            erros = erros.Take(10),
            tabelaFotosReferenciaExiste = await TabelaExisteAsync(conn, "Fotos_Referencia", ct),
            tabelaVetoresExiste = await TabelaExisteAsync(conn, "Vetores_Faciais", ct),
            schemaLidoDe = schema
        });
    }

    private static string PrimeirasPalavras(string s, int n)
    {
        var partes = s.Replace('\n', ' ').Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return string.Join(' ', partes.Take(n)) + (partes.Length > n ? "..." : "");
    }

    private static async Task<bool> TabelaExisteAsync(MySqlConnection conn, string tabela, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = @t";
        cmd.Parameters.AddWithValue("@t", tabela);
        var result = (long?)await cmd.ExecuteScalarAsync(ct);
        return result is > 0;
    }
}
