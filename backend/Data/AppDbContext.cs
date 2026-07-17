// AppDbContext - Contexto EF Core para MySQL (ADR-011)
using Microsoft.EntityFrameworkCore;

namespace backend.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Usuario> Usuarios => Set<Usuario>();
    public DbSet<VetorFacial> Vetores_Faciais => Set<VetorFacial>();
    public DbSet<BiometriaLog> Biometria_Logs => Set<BiometriaLog>();
    public DbSet<TermoConsentimento> Termos_Consentimento => Set<TermoConsentimento>();
}

// Entidades (espelham as tabelas do schema.sql)
public class Usuario
{
    public long Id { get; set; }
    public string Nome { get; set; } = "";
    public string Cpf { get; set; } = "";
    public DateTime? DataNascimento { get; set; }
    public string? NomeMae { get; set; }
    public string? DadosDocumento { get; set; }  // JSON
    public string? TipoDocumento { get; set; }
    public bool ConsentimentoAceito { get; set; }
    public string? TermoVersao { get; set; }
    public DateTime CriadoEm { get; set; }
    public DateTime AtualizadoEm { get; set; }
}

public class VetorFacial
{
    public long Id { get; set; }
    public long UsuarioId { get; set; }
    public string Embedding { get; set; } = "";  // JSON criptografado (AES-256)
    public string? Pose { get; set; }  // frente | esquerda | direita
    public string? Modelo { get; set; }  // ex.: Facenet
    public DateTime CriadoEm { get; set; }
}

public class BiometriaLog
{
    public long Id { get; set; }
    public long? UsuarioId { get; set; }
    public string Operacao { get; set; } = "";  // cadastro | login
    public byte Motor { get; set; }  // 1 ou 2
    public bool Autenticado { get; set; }
    public double? Score { get; set; }
    public double? Limiar { get; set; }
    public int? LatenciaMs { get; set; }
    public string? Device { get; set; }  // cpu | cuda | cloud
    public bool? LivenessOk { get; set; }
    public string? Erro { get; set; }
    public DateTime CriadoEm { get; set; }
}

public class TermoConsentimento
{
    public long Id { get; set; }
    public string Versao { get; set; } = "";
    public string Texto { get; set; } = "";
    public bool Ativo { get; set; }
    public DateTime CriadoEm { get; set; }
}
