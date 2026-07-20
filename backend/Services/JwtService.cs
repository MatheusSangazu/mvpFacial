// JwtService - Emissao e validacao de tokens JWT (HS256) - MVP facial-first
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace backend.Services;

public class JwtService
{
    private readonly SymmetricSecurityKey _chave;
    private readonly int _expiracaoHoras;

    public JwtService(IConfiguration config)
    {
        var secret = config["Jwt:Secret"]
            ?? throw new InvalidOperationException("Jwt:Secret ausente. Defina uma string de >=32 chars em appsettings/env.");
        if (secret.Length < 32)
            throw new InvalidOperationException("Jwt:Secret deve ter pelo menos 32 caracteres para HS256 seguro.");

        _chave = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        _expiracaoHoras = int.TryParse(config["Jwt:ExpiracaoHoras"], out var h) ? h : 8;
    }

    /// <summary>Gera um JWT de usuario comum (cadastro/login facial).</summary>
    public string Gerar(long usuarioId, string cpf, string nome)
    {
        return GerarComClaims(
            expires: DateTime.UtcNow.AddHours(_expiracaoHoras),
            new Claim(JwtRegisteredClaimNames.Sub, usuarioId.ToString()),
            new Claim("cpf", cpf),
            new Claim("nome", nome),
            new Claim("role", "usuario"));
    }

    /// <summary>
    /// Gera um JWT para o painel administrativo (ADR-022).
    /// Sessao curta (8h) com claim role=admin. Nao carrega dados de CPF/nome
    /// de usuarios para evitar vazamento caso o token seja comprometido.
    /// </summary>
    public string GerarAdmin(TimeSpan? validade = null)
    {
        var expires = DateTime.UtcNow.Add(validade ?? TimeSpan.FromHours(_expiracaoHoras));
        return GerarComClaims(
            expires,
            new Claim(JwtRegisteredClaimNames.Sub, "admin"),
            new Claim("role", "admin"),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()));
    }

    private string GerarComClaims(DateTime expires, params Claim[] claims)
    {
        var creds = new SigningCredentials(_chave, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: "mvp-facial",
            audience: "mvp-facial",
            claims: claims,
            expires: expires,
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public int ExpiracaoHoras => _expiracaoHoras;
}
