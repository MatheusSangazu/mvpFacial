// VisionException - Excecao tipada para erros do vision-service (Motor 2).
// Permite que controllers traduzam codigos (SEM_ROSTO, etc.) para o frontend,
// em vez de tratar tudo como "VISION_FALHOU".
namespace backend.Services;

public class VisionException : Exception
{
    /// <summary>Codigo de erro retornado pelo vision-service (ex.: "SEM_ROSTO").</summary>
    public string Codigo { get; }

    /// <summary>Status HTTP devolvido pelo vision-service.</summary>
    public int StatusCode { get; }

    public VisionException(string codigo, int statusCode, string mensagem)
        : base(mensagem)
    {
        Codigo = codigo;
        StatusCode = statusCode;
    }

    /// <summary>Constroi a partir do body de erro do vision-service (formato FastAPI: {"detail":"SEM_ROSTO"}).</summary>
    public static VisionException FromBody(string body, int statusCode)
    {
        var codigo = ExtrairCodigo(body);
        var msg = codigo switch
        {
            "SEM_ROSTO" => "Nenhum rosto detectado na foto. Tente novamente em local mais iluminado, com o rosto centralizado.",
            "ROSTOS_DEMAIS" => "Mais de um rosto detectado na foto. Tire a foto sozinho.",
            "SEM_FOTOS" => "Nenhuma foto enviada para o vision-service.",
            "ERRO_EMBEDDING" => "Falha ao gerar embedding facial.",
            "ERRO_VERIFICACAO" => "Falha ao comparar biometria.",
            _ => $"vision-service falhou: {body}"
        };
        return new VisionException(codigo, statusCode, msg);
    }

    private static string ExtrairCodigo(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return "DESCONHECIDO";
        // FastAPI serializa HTTPException como {"detail":"CODIGO"}.
        try
        {
            var idx = body.IndexOf("\"detail\"", StringComparison.OrdinalIgnoreCase);
            if (idx >= 0)
            {
                var start = body.IndexOf('"', idx + 8) + 1;
                var end = body.IndexOf('"', start);
                if (start > 0 && end > start)
                    return body.Substring(start, end - start).Trim();
            }
        }
        catch { }
        return body.Length > 80 ? body.Substring(0, 80) : body;
    }
}
