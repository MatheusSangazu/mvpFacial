// Backend C# .NET - Orquestrador do MVP de reconhecimento facial
using System.IdentityModel.Tokens.Jwt;
using System.Text;
using System.Text.Json.Serialization;
using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

// Desativa mapeamento automatic de claims (sub -> NameIdentifier, etc.)
// Mantem os nomes dos claims identicos aos do JWT (sub, cpf, nome)
JwtSecurityTokenHandler.DefaultInboundClaimTypeMap.Clear();

var builder = WebApplication.CreateBuilder(args);

// Servicos
builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });

// EF Core + Pomelo MySQL (ADR-011, ADR-012)
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default ausente. Verifique appsettings.Development.json ou variaveis de ambiente.");
builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString))
           .UseCamelCaseNamingConvention();  // colunas em camelCase (AGENTS.md / ADR-012)
});

// Criptografia AES-256-GCM para vetores faciais (ADR-009)
builder.Services.AddSingleton<CriptografiaService>();

// JWT - emissao de tokens
builder.Services.AddSingleton<JwtService>();

// Gemini - extracao de documentos e Motor 1 (ADR-001, ADR-005, ADR-019 multi-key)
builder.Services.AddSingleton<GeminiKeysProvider>();
builder.Services.AddHttpClient<GeminiService>();
builder.Services.AddHttpClient<Motor1GeminiService>();
// DeepFace - Motor 2 (vision-service Python, ADR-003)
builder.Services.AddHttpClient<PythonVisionService>();

// JWT - autenticacao Bearer
var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? throw new InvalidOperationException("Jwt:Secret ausente. Defina >=32 chars em appsettings/env.");
if (jwtSecret.Length < 32)
    throw new InvalidOperationException("Jwt:Secret deve ter >=32 chars (HS256).");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = "mvp-facial",
            ValidAudience = "mvp-facial",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ClockSkew = TimeSpan.FromMinutes(1),
            NameClaimType = "sub"
        };
    });
builder.Services.AddAuthorization();

// CORS - permite o frontend Next.js
var corsOrigins = builder.Configuration["CORS_ORIGINS"]
    ?? "http://localhost:3000";
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(corsOrigins.Split(','))
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// OpenAPI / Swagger
builder.Services.AddOpenApi();

var app = builder.Build();

// Pipeline
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
