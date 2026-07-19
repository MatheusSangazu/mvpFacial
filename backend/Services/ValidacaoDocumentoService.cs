// ValidacaoDocumentoService - Camada 1 do ADR-006: validacao sintatica pos-extracao.
// Suporta tanto RG/CNH (valida CPF + nome + data) quanto Comprovante (valida endereco + titular).
using System.Text.Json;

namespace backend.Services;

public static class ValidacaoDocumentoService
{
    /// <summary>Aplica todas as checagens sintaticas. Retorna lista vazia se tudo OK.</summary>
    public static List<FalhaValidacao> ValidarCamada1(DocumentoExtraido doc)
    {
        var falhas = new List<FalhaValidacao>();

        var tipo = doc.TipoDocumento?.Trim();
        var tiposValidos = new[] { "RG", "CNH", "Comprovante" };
        if (string.IsNullOrWhiteSpace(tipo) || !tiposValidos.Contains(tipo))
            falhas.Add(new("TIPO_DESCONHECIDO", "tipoDocumento ausente ou invalido."));

        if (tipo == "Comprovante")
            ValidarComprovante(doc, falhas);
        else
            ValidarIdentidade(doc, falhas);

        return falhas;
    }

    private static void ValidarIdentidade(DocumentoExtraido doc, List<FalhaValidacao> falhas)
    {
        // Nome: obrigatorio, sem digitos
        if (string.IsNullOrWhiteSpace(doc.Nome))
            falhas.Add(new("NOME_AUSENTE", "nome nao extraido."));
        else if (doc.Nome.Any(char.IsDigit))
            falhas.Add(new("NOME_INVALIDO", "nome contem digitos."));

        // CPF: digitos verificadores
        if (!ValidacaoCpfService.Validar(doc.Cpf))
            falhas.Add(new("CPF_INVALIDO", $"cpf invalido ou ausente (valor extraido: '{doc.Cpf}')."));

        // Data plausivel
        ValidarData(doc.DataNascimento, "dataNascimento", falhas);
        ValidarData(doc.RgDataEmissao, "rgDataEmissao", falhas);
        ValidarData(doc.CnhValidade, "cnhValidade", falhas);

        // RG deve ter orgao emissor + UF
        if (doc.TipoDocumento == "RG")
        {
            if (string.IsNullOrWhiteSpace(doc.RgNumero))
                falhas.Add(new("RG_NUMERO_AUSENTE", "rgNumero ausente."));
            if (string.IsNullOrWhiteSpace(doc.RgOrgaoEmissor))
                falhas.Add(new("RG_EMISSOR_AUSENTE", "rgOrgaoEmissor ausente."));
        }

        // CNH deve ter numero + categoria
        if (doc.TipoDocumento == "CNH")
        {
            if (string.IsNullOrWhiteSpace(doc.CnhNumero))
                falhas.Add(new("CNH_NUMERO_AUSENTE", "cnhNumero ausente."));
            if (string.IsNullOrWhiteSpace(doc.CnhCategoria))
                falhas.Add(new("CNH_CATEGORIA_AUSENTE", "cnhCategoria ausente."));
        }
    }

    private static void ValidarComprovante(DocumentoExtraido doc, List<FalhaValidacao> falhas)
    {
        // Titular obrigatorio
        if (string.IsNullOrWhiteSpace(doc.Titular))
            falhas.Add(new("TITULAR_AUSENTE", "titular nao extraido do comprovante."));

        // CPF do titular (se presente) deve ser valido
        if (!string.IsNullOrWhiteSpace(doc.CpfTitular) && !ValidacaoCpfService.Validar(doc.CpfTitular))
            falhas.Add(new("CPF_TITULAR_INVALIDO", $"cpfTitular invalido: '{doc.CpfTitular}'."));

        // Endereco: deve ter pelo menos logradouro + cidade + cep ou uf
        var temEndereco = doc.Endereco is JsonElement e && e.ValueKind == JsonValueKind.Object;
        if (!temEndereco)
        {
            falhas.Add(new("ENDERECO_AUSENTE", "endereco nao extraido."));
            return;
        }

        var endereco = doc.Endereco!.Value;
        var logradouro = GetString(endereco, "logradouro");
        var cidade = GetString(endereco, "cidade");
        var uf = GetString(endereco, "uf");
        var cep = GetString(endereco, "cep");

        if (string.IsNullOrWhiteSpace(logradouro))
            falhas.Add(new("LOGRADOURO_AUSENTE", "endereco.logradouro nao extraido."));
        if (string.IsNullOrWhiteSpace(cidade))
            falhas.Add(new("CIDADE_AUSENTE", "endereco.cidade nao extraido."));
        if (!string.IsNullOrWhiteSpace(uf) && uf.Length != 2)
            falhas.Add(new("UF_FORMATO", $"endereco.uf deve ter 2 letras: '{uf}'."));
        if (!string.IsNullOrWhiteSpace(cep) && cep.Length != 8)
            falhas.Add(new("CEP_FORMATO", $"endereco.cep deve ter 8 digitos: '{cep}'."));

        // Datas plausiveis
        ValidarData(doc.DataEmissao, "dataEmissao", falhas);
        ValidarData(doc.DataVencimento, "dataVencimento", falhas);
    }

    private static void ValidarData(string? valor, string campo, List<FalhaValidacao> falhas)
    {
        if (string.IsNullOrWhiteSpace(valor)) return;

        // Aceita formatos comuns: YYYY-MM-DD, DD/MM/YYYY, YYYY/MM/DD
        var formatos = new[] { "yyyy-MM-dd", "dd/MM/yyyy", "yyyy/MM/dd", "dd-MM-yyyy", "d/M/yyyy" };
        DateTime data;
        if (!DateTime.TryParseExact(valor, formatos, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out data)
            && !DateTime.TryParse(valor, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out data))
        {
            falhas.Add(new("DATA_FORMATO_INVALIDO", $"{campo} em formato nao reconhecido (valor: '{valor}')."));
            return;
        }

        if (data > DateTime.Today.AddYears(1))
            falhas.Add(new("DATA_FUTURA", $"{campo} muito no futuro."));
        if (data < new DateTime(1900, 1, 1))
            falhas.Add(new("DATA_ABSURDA", $"{campo} anterior a 1900."));
    }

    private static string? GetString(JsonElement elem, string chave) =>
        elem.TryGetProperty(chave, out var p) && p.ValueKind == System.Text.Json.JsonValueKind.String ? p.GetString() : null;
}

public record FalhaValidacao(string Codigo, string Mensagem);
