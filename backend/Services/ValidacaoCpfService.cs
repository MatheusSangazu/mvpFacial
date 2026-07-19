// ValidacaoCpfService - Camada 1 do ADR-006: validacao sintatica de CPF (digitos verificadores)
namespace backend.Services;

public static class ValidacaoCpfService
{
    /// <summary>True se o CPF tem 11 digitos e os 2 digitos verificadores sao validos.</summary>
    public static bool Validar(string? cpf)
    {
        if (string.IsNullOrWhiteSpace(cpf)) return false;

        // Mantem so digitos
        var digitos = new string(cpf.Where(char.IsDigit).ToArray());
        if (digitos.Length != 11) return false;

        // Rejeita CPFs obviamente invalidos (todos iguais)
        if (digitos.Distinct().Count() == 1) return false;

        // Digito verificador 1
        var soma = 0;
        for (var i = 0; i < 9; i++) soma += (digitos[i] - '0') * (10 - i);
        var dv1 = soma % 11;
        dv1 = dv1 < 2 ? 0 : 11 - dv1;
        if (dv1 != (digitos[9] - '0')) return false;

        // Digito verificador 2
        soma = 0;
        for (var i = 0; i < 10; i++) soma += (digitos[i] - '0') * (11 - i);
        var dv2 = soma % 11;
        dv2 = dv2 < 2 ? 0 : 11 - dv2;
        return dv2 == (digitos[10] - '0');
    }

    /// <summary>Formata como 000.000.000-00 ou devolve null se invalido.</summary>
    public static string? Formatar(string? cpf)
        => Validar(cpf) ? new string(cpf!.Where(char.IsDigit).ToArray()) : null;
}
