// CriptografiaService - AES-256-GCM para vetores faciais em repouso (ADR-009)
// Format do payload gravado: base64( nonce[12] || ciphertext || tag[16] )
// A chave vive fora do codigo: variavel AES_EMBEDDING_KEY (32 bytes em base64).
using System.Security.Cryptography;

namespace backend.Services;

public class CriptografiaService
{
    private const int NonceBytes = 12;   // 96 bits, recomendado para GCM
    private const int TagBytes = 16;     // 128 bits, maximo para GCM
    private readonly byte[] _chave;

    public CriptografiaService(IConfiguration config)
    {
        var chaveB64 = config["AES_EMBEDDING_KEY"]
            ?? throw new InvalidOperationException(
                "AES_EMBEDDING_KEY ausente. Gere 32 bytes aleatorios, encode base64 e defina na env/appsettings. " +
                "Comando: dotnet run -- generate-aes-key");

        _chave = Convert.FromBase64String(chaveB64);
        if (_chave.Length != 32)
            throw new InvalidOperationException(
                $"AES_EMBEDDING_KEY deve ter 32 bytes (256 bits) apos decode base64. Atual: {_chave.Length} bytes.");
    }

    /// <summary>Criptografa um conteudo UTF-8 e devolve base64(nonce||ciphertext||tag).</summary>
    public string Criptografar(string texto)
    {
        var plaintext = System.Text.Encoding.UTF8.GetBytes(texto);
        var payload = CriptografarBytes(plaintext);
        return Convert.ToBase64String(payload);
    }

    /// <summary>Criptografa bytes arbitrarios (foto, etc) - ADR-018. Devolve nonce||ct||tag.</summary>
    public byte[] CriptografarBytes(byte[] plaintext)
    {
        var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagBytes];

        using var gcm = new AesGcm(_chave, TagBytes);
        gcm.Encrypt(nonce, plaintext, ciphertext, tag);

        // Concatena: nonce || ciphertext || tag
        var payload = new byte[NonceBytes + ciphertext.Length + TagBytes];
        Buffer.BlockCopy(nonce, 0, payload, 0, NonceBytes);
        Buffer.BlockCopy(ciphertext, 0, payload, NonceBytes, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, payload, NonceBytes + ciphertext.Length, TagBytes);

        return payload;
    }

    /// <summary>Descriptografa base64(nonce||ciphertext||tag) de volta para UTF-8. Lanca se o tag falhar.</summary>
    public string Descriptografar(string payloadB64)
    {
        var payload = Convert.FromBase64String(payloadB64);
        var plaintext = DescriptografarBytes(payload);
        return System.Text.Encoding.UTF8.GetString(plaintext);
    }

    /// <summary>Descriptografa bytes nonce||ct||tag de volta para o conteudo original. ADR-018.</summary>
    public byte[] DescriptografarBytes(byte[] payload)
    {
        if (payload.Length < NonceBytes + TagBytes)
            throw new CryptographicException("Payload criptografado menor que o minimo esperado.");

        var nonce = new byte[NonceBytes];
        var tag = new byte[TagBytes];
        var ciphertextLen = payload.Length - NonceBytes - TagBytes;
        var ciphertext = new byte[ciphertextLen];

        Buffer.BlockCopy(payload, 0, nonce, 0, NonceBytes);
        Buffer.BlockCopy(payload, NonceBytes, ciphertext, 0, ciphertextLen);
        Buffer.BlockCopy(payload, NonceBytes + ciphertextLen, tag, 0, TagBytes);

        var plaintext = new byte[ciphertextLen];
        using var gcm = new AesGcm(_chave, TagBytes);
        gcm.Decrypt(nonce, ciphertext, tag, plaintext);   // lanca CryptographicException se adulterado

        return plaintext;
    }
}
