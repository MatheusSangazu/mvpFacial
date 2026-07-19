// AppDbContext - Contexto EF Core para MySQL (ADR-011, ADR-012)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace backend.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Usuario> Usuarios => Set<Usuario>();
    public DbSet<VetorFacial> Vetores_Faciais => Set<VetorFacial>();
    public DbSet<FotoReferencia> Fotos_Referencia => Set<FotoReferencia>();
    public DbSet<BiometriaLog> Biometria_Logs => Set<BiometriaLog>();
    public DbSet<TermoConsentimento> Termos_Consentimento => Set<TermoConsentimento>();
    public DbSet<DocumentoCadastrado> Documentos_Cadastrados => Set<DocumentoCadastrado>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Nomes de tabelas explicitos (constantes); colunas em camelCase via UseCamelCaseNamingConvention em Program.cs (ADR-012)
        modelBuilder.Entity<Usuario>().ToTable("Usuarios");
        modelBuilder.Entity<VetorFacial>().ToTable("Vetores_Faciais");
        modelBuilder.Entity<FotoReferencia>().ToTable("Fotos_Referencia");
        modelBuilder.Entity<BiometriaLog>().ToTable("Biometria_Logs");
        modelBuilder.Entity<TermoConsentimento>().ToTable("Termos_Consentimento");
        modelBuilder.Entity<DocumentoCadastrado>().ToTable("Documentos_Cadastrados");

        // Relacionamentos
        modelBuilder.Entity<Usuario>(b =>
        {
            b.HasKey(x => x.Id);
            b.HasIndex(x => x.Cpf).IsUnique();
            // Defaults do schema.sql (DEFAULT CURRENT_TIMESTAMP / ON UPDATE CURRENT_TIMESTAMP)
            b.Property(x => x.CriadoEm).HasDefaultValueSql("CURRENT_TIMESTAMP").ValueGeneratedOnAdd();
            b.Property(x => x.AtualizadoEm).HasDefaultValueSql("CURRENT_TIMESTAMP").ValueGeneratedOnAddOrUpdate();
        });

        modelBuilder.Entity<VetorFacial>(b =>
        {
            b.HasKey(x => x.Id);
            b.HasOne<Usuario>()
             .WithMany()
             .HasForeignKey(x => x.UsuarioId)
             .OnDelete(DeleteBehavior.Cascade);
            b.HasIndex(x => x.UsuarioId);
            b.Property(x => x.CriadoEm).HasDefaultValueSql("CURRENT_TIMESTAMP").ValueGeneratedOnAdd();
        });

        // ADR-018: 1 foto de referencia por usuario, cifrada (apenas para Motor 1 comparar).
        modelBuilder.Entity<FotoReferencia>(b =>
        {
            b.HasKey(x => x.Id);
            b.HasOne<Usuario>()
             .WithMany()
             .HasForeignKey(x => x.UsuarioId)
             .OnDelete(DeleteBehavior.Cascade);
            b.HasIndex(x => x.UsuarioId).IsUnique(); // 1 foto por usuario
            b.Property(x => x.CriadoEm).HasDefaultValueSql("CURRENT_TIMESTAMP").ValueGeneratedOnAdd();
        });

        modelBuilder.Entity<BiometriaLog>(b =>
        {
            b.HasKey(x => x.Id);
            b.HasOne<Usuario>()
             .WithMany()
             .HasForeignKey(x => x.UsuarioId)
             .OnDelete(DeleteBehavior.SetNull);
            b.HasIndex(x => new { x.UsuarioId, x.CriadoEm });
            b.HasIndex(x => new { x.Motor, x.CriadoEm });
            b.Property(x => x.CriadoEm).HasDefaultValueSql("CURRENT_TIMESTAMP").ValueGeneratedOnAdd();
        });

        modelBuilder.Entity<TermoConsentimento>(b =>
        {
            b.HasKey(x => x.Id);
            b.HasIndex(x => x.Versao).IsUnique();
            b.Property(x => x.CriadoEm).HasDefaultValueSql("CURRENT_TIMESTAMP").ValueGeneratedOnAdd();
        });

        modelBuilder.Entity<DocumentoCadastrado>(b =>
        {
            b.HasKey(x => x.Id);
            b.HasOne<Usuario>()
             .WithMany()
             .HasForeignKey(x => x.UsuarioId)
             .OnDelete(DeleteBehavior.Cascade);
            b.HasIndex(x => new { x.UsuarioId, x.TipoDocumento });
            b.Property(x => x.CriadoEm).HasDefaultValueSql("CURRENT_TIMESTAMP").ValueGeneratedOnAdd();
        });

        base.OnModelCreating(modelBuilder);
    }
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

// ADR-018: foto de referencia cifrada para o Motor 1 (Gemini) comparar.
// 1 por usuario (unique index). Cifrada com AES-256-GCM (mesma cifra dos vetores).
// Estrutura cifrada: base64(jpeg). NUNCA trafega decifrada fora do backend.
public class FotoReferencia
{
    public long Id { get; set; }
    public long UsuarioId { get; set; }
    public byte[] ConteudoCifrado { get; set; } = Array.Empty<byte>();  // AES-256-GCM bytes
    public string? Mime { get; set; }  // image/jpeg | image/png | image/webp
    public string? Origem { get; set; }  // "cadastro" | "atualizacao"
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
    // Laudo Tecnico (ADR-014) - preenchido pelo Motor 1 (Gemini) apos o Motor 2 decidir
    public string? ParecerTexto { get; set; }            // parecer forense em linguagem natural
    public string? ParecerJson { get; set; }             // estrutura completa (decisao, acao, resumo)
    public string? PontosAnatomicosJson { get; set; }    // 5 pontos canonicos com status + observacao
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

// Documento cadastrado por um usuario (RG, CNH, Comprovante).
// ADR-009/LGPD: armazenamos apenas os DADOS EXTRAIDOS (JSON), nunca o arquivo bruto.
public class DocumentoCadastrado
{
    public long Id { get; set; }
    public long UsuarioId { get; set; }
    public string TipoDocumento { get; set; } = "";  // RG | CNH | Comprovante
    public string? NomeArquivo { get; set; }         // somente metadata, sem conteudo binario
    public string DadosExtraidosJson { get; set; } = "{}";  // JSON estruturado pela IA
    public string? ConfiancaExtracao { get; set; }  // "0.92"
    public DateTime CriadoEm { get; set; }
}
