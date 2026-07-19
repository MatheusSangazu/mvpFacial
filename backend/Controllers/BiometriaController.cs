// BiometriaController - Endpoints de biometria facial.
// - /api/biometria/gemini/comparar: Motor 1 (DEMO - ADR-002). Mostra limitacoes do LLM para biometria.
// - /api/biometria/cadastrar: Motor 2 (DeepFace) - gera embeddings, cifra com AES-256 e grava (ADR-004, ADR-009).
// - /api/biometria/vetores: lista os vetores do usuario autenticado.
using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class BiometriaController(
    AppDbContext db,
    CriptografiaService crypto,
    PythonVisionService vision,
    Motor1GeminiService motor1,
    JwtService jwt) : ControllerBase
{
    /// <summary>Motor 1 (DEMO): compara 2 fotos faciais via Gemini 3.5 Flash.
    /// Mostra limitacoes de usar LLM para biometria 1:1 (sem score calibravel, sem embedding).</summary>
    [HttpPost("gemini/comparar")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> CompararGemini(
        [FromForm] IFormFile referencia,
        [FromForm] IFormFile atual,
        CancellationToken ct)
    {
        if (referencia is null || referencia.Length == 0)
            return BadRequest(new { erro = "REFERENCIA_AUSENTE" });
        if (atual is null || atual.Length == 0)
            return BadRequest(new { erro = "ATUAL_AUSENTE" });

        var mimesOk = new[] { "image/jpeg", "image/png", "image/webp" };
        var mimeReferencia = string.IsNullOrWhiteSpace(referencia.ContentType) ? "image/jpeg" : referencia.ContentType;
        var mimeAtual = string.IsNullOrWhiteSpace(atual.ContentType) ? "image/jpeg" : atual.ContentType;
        if (!mimesOk.Contains(mimeReferencia) || !mimesOk.Contains(mimeAtual))
            return BadRequest(new { erro = "MIME_NAO_SUPORTADO" });

        if (referencia.Length > 10 * 1024 * 1024 || atual.Length > 10 * 1024 * 1024)
            return BadRequest(new { erro = "IMAGEM_MUITO_GRANDE", mensagem = "Maximo 10 MB por imagem." });

        var refB64 = await Motor1GeminiService.ParaBase64Async(referencia, ct);
        var atualB64 = await Motor1GeminiService.ParaBase64Async(atual, ct);

        ComparacaoFacialResult resultado;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            resultado = await motor1.CompararAsync(refB64, atualB64, mimeReferencia, ct);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("ausente"))
        {
            return StatusCode(503, new { erro = "GEMINI_NAO_CONFIGURADO", mensagem = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { erro = "MOTOR1_FALHOU", mensagem = ex.Message });
        }
        sw.Stop();

        // Marcador claro: esse endpoint e DEMO. Nao usar para autenticacao real.
        Response.Headers["X-Motor"] = "1-gemini-demo";
        Response.Headers["X-Warning"] = "DEMO: LLM nao serve para biometria 1:1 em producao. Use Motor 2 (DeepFace).";

        return Ok(new
        {
            motor = "1-gemini-demo",
            latenciaMs = sw.ElapsedMilliseconds,
            resultado,
            aviso = "Saida de IA generativa. Nao deterministica. Para producao, use Motor 2 (DeepFace)."
        });
    }

    /// <summary>Cadastro facial (Motor 2 - DeepFace). Recebe 1-3 fotos, gera embeddings,
    /// cifra com AES-256-GCM (ADR-009) e grava em Vetores_Faciais. Registra metricas em Biometria_Logs.</summary>
    [HttpPost("cadastrar")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Cadastrar(
        [FromForm] List<IFormFile> fotos,
        [FromForm] string? pose,
        [FromForm] string? poses,
        CancellationToken ct)
    {
        // 1. Identificar usuario a partir do JWT
        var sub = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (!long.TryParse(sub, out var userId))
            return Unauthorized();

        // 2. Validar fotos (1-3 por ADR-004)
        if (fotos is null || fotos.Count == 0)
            return BadRequest(new { erro = "FOTOS_AUSENTES", mensagem = "Envie 1 a 3 fotos faciais." });
        if (fotos.Count > 3)
            return BadRequest(new { erro = "FOTOS_EXCESSO", mensagem = "Maximo de 3 fotos por cadastro (ADR-004)." });

        var mimesOk = new[] { "image/jpeg", "image/png", "image/webp" };
        foreach (var f in fotos)
        {
            if (f.Length == 0) return BadRequest(new { erro = "FOTO_VAZIA" });
            if (f.Length > 10 * 1024 * 1024)
                return BadRequest(new { erro = "FOTO_MUITO_GRANDE", mensagem = "Maximo 10 MB por foto." });
            var mime = string.IsNullOrWhiteSpace(f.ContentType) ? "image/jpeg" : f.ContentType;
            if (!mimesOk.Contains(mime))
                return BadRequest(new { erro = "MIME_NAO_SUPORTADO", mensagem = $"Tipo {mime} nao suportado." });
        }

        // 3. Bloquear re-cadastro sem remocao explicita
        var jaTem = await db.Vetores_Faciais.AnyAsync(v => v.UsuarioId == userId, ct);
        if (jaTem)
            return Conflict(new { erro = "VETORES_JA_EXISTEM", mensagem = "Usuario ja possui cadastro facial. Remova antes de re-cadastrar." });

        // 4. Carregar bytes das fotos
        var imagens = new List<(byte[] bytes, string mime)>();
        foreach (var f in fotos)
        {
            using var ms = new MemoryStream();
            await f.CopyToAsync(ms, ct);
            var mime = string.IsNullOrWhiteSpace(f.ContentType) ? "image/jpeg" : f.ContentType;
            imagens.Add((ms.ToArray(), mime));
        }

        // 5. Chamar vision-service (Motor 2)
        EmbeddingsResponse embRes;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            embRes = await vision.GerarEmbeddingsAsync(imagens, ct);
        }
        catch (VisionException vex)
        {
            sw.Stop();
            await RegistrarLogAsync(userId, "cadastro", motor: 2, autenticado: false,
                score: null, limiar: null, latenciaMs: (int)sw.ElapsedMilliseconds,
                device: null, livenessOk: null, erro: vex.Codigo, ct);
            // 422 Unprocessable - problema com a foto (SEM_ROSTO, ROSTOS_DEMAIS, etc.)
            return UnprocessableEntity(new { erro = vex.Codigo, mensagem = vex.Message });
        }
        catch (Exception ex)
        {
            sw.Stop();
            await RegistrarLogAsync(userId, "cadastro", motor: 2, autenticado: false,
                score: null, limiar: null, latenciaMs: (int)sw.ElapsedMilliseconds,
                device: null, livenessOk: null, erro: "VISION_FALHOU", ct);
            return StatusCode(502, new { erro = "VISION_FALHOU", mensagem = ex.Message });
        }
        sw.Stop();

        // 6. Visao deve ter encontrado pelo menos 1 rosto
        if (embRes.Embeddings is null || embRes.Embeddings.Count == 0)
        {
            await RegistrarLogAsync(userId, "cadastro", motor: 2, autenticado: false,
                score: null, limiar: null, latenciaMs: embRes.LatenciaMs,
                device: embRes.Device, livenessOk: null, erro: "SEM_ROSTO", ct);
            return UnprocessableEntity(new { erro = "SEM_ROSTO", mensagem = "Nenhum rosto detectado nas fotos enviadas." });
        }

        // 7. Cifrar (AES-256-GCM) e gravar vetores
        // Pose: se o cliente enviou "poses" (CSV 1-por-foto), usa cada uma na sua posicao;
        // caso contrario, usa a "pose" unica para todos (compat retroativo).
        var poseFinal = string.IsNullOrWhiteSpace(pose) ? "frente" : pose;
        var posesPorFoto = (poses ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(p => string.IsNullOrWhiteSpace(p) ? "frente" : p)
            .ToList();

        var ids = new List<long>();
        for (int i = 0; i < embRes.Embeddings.Count; i++)
        {
            var emb = embRes.Embeddings[i];
            var poseVetor = i < posesPorFoto.Count ? posesPorFoto[i] : poseFinal;
            var json = System.Text.Json.JsonSerializer.Serialize(emb);
            var cifrado = crypto.Criptografar(json);
            var vetor = new VetorFacial
            {
                UsuarioId = userId,
                Embedding = cifrado,
                Pose = poseVetor,
                Modelo = embRes.Modelo
            };
            db.Vetores_Faciais.Add(vetor);
            await db.SaveChangesAsync(ct);
            ids.Add(vetor.Id);
        }

        // 7b. ADR-018: persistir a primeira foto (frontal) como referencia CIFRADA
        // para o Motor 1 (Gemini) poder comparar identidade no /verificar-comparativo.
        // Replace se ja existia (re-cadastro apos remocao explicita de vetores).
        var fotoAnterior = await db.Fotos_Referencia.FirstOrDefaultAsync(f => f.UsuarioId == userId, ct);
        var bytesRef = imagens[0].bytes;
        var mimeRef = imagens[0].mime;
        var conteudoCifrado = crypto.CriptografarBytes(bytesRef);
        if (fotoAnterior is null)
        {
            db.Fotos_Referencia.Add(new FotoReferencia
            {
                UsuarioId = userId,
                ConteudoCifrado = conteudoCifrado,
                Mime = mimeRef,
                Origem = "cadastro"
            });
        }
        else
        {
            // Atualiza foto existente (re-cadastro)
            fotoAnterior.ConteudoCifrado = conteudoCifrado;
            fotoAnterior.Mime = mimeRef;
            fotoAnterior.Origem = "atualizacao";
        }
        await db.SaveChangesAsync(ct);

        // 8. Metricas em Biometria_Logs (ADR-008)
        await RegistrarLogAsync(userId, "cadastro", motor: 2, autenticado: true,
            score: null, limiar: null, latenciaMs: embRes.LatenciaMs,
            device: embRes.Device, livenessOk: null, erro: null, ct);

        Response.Headers["X-Motor"] = "2-deepface";
        return CreatedAtAction(nameof(ListarVetores), null, new
        {
            usuarioId = userId,
            modelo = embRes.Modelo,
            device = embRes.Device,
            latenciaMs = embRes.LatenciaMs,
            vetoresCriados = ids.Count,
            vetoresIds = ids,
            pose = poseFinal
        });
    }

    /// <summary>Lista os vetores faciais do usuario autenticado (sem devolver o conteudo cifrado).</summary>
    [HttpGet("vetores")]
    public async Task<IActionResult> ListarVetores(CancellationToken ct)
    {
        var sub = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (!long.TryParse(sub, out var userId))
            return Unauthorized();

        var vetores = await db.Vetores_Faciais.AsNoTracking()
            .Where(v => v.UsuarioId == userId)
            .Select(v => new { v.Id, v.Pose, v.Modelo, v.CriadoEm })
            .ToListAsync(ct);
        return Ok(vetores);
    }

    /// <summary>Verificacao facial (login por biometria) - Motor 2 (DeepFace).
    /// Recebe foto atual + CPF, decifra vetores cadastrados, chama vision-service /verificar,
    /// aplica regra do ADR-014 (livenessOk=false => nunca AUTENTICADO) e grava metricas.</summary>
    [HttpPost("verificar")]
    [AllowAnonymous]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Verificar(
        [FromForm] IFormFile foto,
        [FromForm] string cpf,
        [FromForm] string? limiar,
        CancellationToken ct)
    {
        // 1. Validar CPF e localizar usuario
        var cpfNorm = ValidacaoCpfService.Formatar(cpf);
        if (cpfNorm is null)
            return BadRequest(new { erro = "CPF_INVALIDO" });

        var usuario = await db.Usuarios.AsNoTracking().FirstOrDefaultAsync(u => u.Cpf == cpfNorm, ct);
        if (usuario is null)
            return NotFound(new { erro = "USUARIO_NAO_ENCONTRADO" });

        // 2. Validar foto recebida
        if (foto is null || foto.Length == 0)
            return BadRequest(new { erro = "FOTO_AUSENTE" });
        var mimesOk = new[] { "image/jpeg", "image/png", "image/webp" };
        var mime = string.IsNullOrWhiteSpace(foto.ContentType) ? "image/jpeg" : foto.ContentType;
        if (!mimesOk.Contains(mime))
            return BadRequest(new { erro = "MIME_NAO_SUPORTADO" });
        if (foto.Length > 10 * 1024 * 1024)
            return BadRequest(new { erro = "FOTO_MUITO_GRANDE" });

        // 3. Carregar vetores cadastrados (cifrados) e decifrar
        var vetoresCifrados = await db.Vetores_Faciais.AsNoTracking()
            .Where(v => v.UsuarioId == usuario.Id)
            .ToListAsync(ct);
        if (vetoresCifrados.Count == 0)
        {
            await RegistrarLogAsync(usuario.Id, "login", motor: 2, autenticado: false,
                score: null, limiar: null, latenciaMs: 0, device: null, livenessOk: null,
                erro: "SEM_VETORES", ct);
            return Conflict(new { erro = "SEM_VETORES", mensagem = "Usuario nao possui cadastro facial." });
        }

        List<List<float>> vetores;
        try
        {
            vetores = vetoresCifrados.Select(v =>
                System.Text.Json.JsonSerializer.Deserialize<List<float>>(crypto.Descriptografar(v.Embedding))!)
                .ToList();
        }
        catch (Exception ex)
        {
            await RegistrarLogAsync(usuario.Id, "login", motor: 2, autenticado: false,
                score: null, limiar: null, latenciaMs: 0, device: null, livenessOk: null,
                erro: "DECIFRA_FALHOU", ct);
            return StatusCode(500, new { erro = "DECIFRA_FALHOU", mensagem = ex.Message });
        }

        // 4. Ler bytes da foto atual e converter para base64
        using var ms = new MemoryStream();
        await foto.CopyToAsync(ms, ct);
        var fotoBytes = ms.ToArray();
        var imagemB64 = Convert.ToBase64String(fotoBytes);

        // 5. Threshold default (ADR-004). Parse manual com InvariantCulture para evitar
        //    bug de cultura: em pt-BR, "0.60" vira 60 (ponto = separador de milhar).
        double limiarFinal;
        if (string.IsNullOrWhiteSpace(limiar))
        {
            limiarFinal = 0.60;
        }
        else if (!double.TryParse(limiar, System.Globalization.NumberStyles.Any,
                     System.Globalization.CultureInfo.InvariantCulture, out limiarFinal)
                 || limiarFinal is < 0 or > 1)
        {
            return BadRequest(new { erro = "LIMIAR_INVALIDO", mensagem = "limiar deve estar entre 0 e 1 (ex.: 0.60)." });
        }

        // 6. Chamar vision-service /verificar
        VerificarResponse vresp;
        try
        {
            vresp = await vision.VerificarAsync(imagemB64, vetores, limiarFinal, ct);
        }
        catch (VisionException vex)
        {
            await RegistrarLogAsync(usuario.Id, "login", motor: 2, autenticado: false,
                score: null, limiar: limiarFinal, latenciaMs: 0, device: null, livenessOk: null,
                erro: vex.Codigo, ct);
            return UnprocessableEntity(new { erro = vex.Codigo, mensagem = vex.Message });
        }
        catch (Exception ex)
        {
            await RegistrarLogAsync(usuario.Id, "login", motor: 2, autenticado: false,
                score: null, limiar: limiarFinal, latenciaMs: 0, device: null, livenessOk: null,
                erro: "VISION_FALHOU", ct);
            return StatusCode(502, new { erro = "VISION_FALHOU", mensagem = ex.Message });
        }

        // 7. Regra ADR-014: livenessOk=false => nunca AUTENTICADO (mesmo com score alto)
        var autenticadoFinal = vresp.Autenticado && vresp.LivenessOk;

        // 8. Resultado canonico (parecerTexto/Json virao no endpoint /laudo - ADR-014)
        var resultado = autenticadoFinal ? "AUTENTICADO" : (vresp.Score >= limiarFinal ? "INCONCLUSIVO" : "REJEITADO");

        // 9. Gravar metricas em Biometria_Logs
        var log = new BiometriaLog
        {
            UsuarioId = usuario.Id,
            Operacao = "login",
            Motor = 2,
            Autenticado = autenticadoFinal,
            Score = vresp.Score,
            Limiar = limiarFinal,
            LatenciaMs = vresp.LatenciaMs,
            Device = vresp.Device,
            LivenessOk = vresp.LivenessOk,
            Erro = null
        };
        db.Biometria_Logs.Add(log);
        await db.SaveChangesAsync(ct);

        // 10. Emitir JWT somente se autenticado (login facial efetivado)
        string? token = null;
        if (autenticadoFinal)
        {
            token = jwt.Gerar(usuario.Id, usuario.Cpf, usuario.Nome);
        }

        Response.Headers["X-Motor"] = "2-deepface";
        return Ok(new
        {
            usuarioId = usuario.Id,
            nome = usuario.Nome,
            resultado,
            autenticado = autenticadoFinal,
            metricas = new
            {
                motor = 2,
                score = vresp.Score,
                limiar = limiarFinal,
                latenciaMs = vresp.LatenciaMs,
                device = vresp.Device,
                livenessOk = vresp.LivenessOk
            },
            logId = log.Id,
            token,
            expiraEmHoras = autenticadoFinal ? 8 : (int?)null,
            // Ponteiro para o Laudo Tecnico (ADR-014) - endpoint a ser implementado
            laudoUrl = $"/api/biometria/laudo/{log.Id}"
        });
    }

    /// <summary>Verificacao COMPARATIVA com UMA foto (ADR-017).
    /// Envia 1 foto + CPF; o backend roda Motor 1 (liveness) e Motor 2 (identidade) em paralelo.
    /// Motor 1 NAO compara identidade - apenas diz se a foto e live/printed/screen e a qualidade.
    /// Motor 2 compara o embedding da foto contra os vetores cadastrados (ADR-009).
    /// Se Motor 1 detectar spoofing (printed/screen/mask), faz veto no Motor 2 (ADR-014 estendido).
    /// Nenhuma foto e persistida; so o log do Motor 2 e gravado (ADR-013).</summary>
    [HttpPost("verificar-comparativo")]
    [AllowAnonymous]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> VerificarComparativo(
        [FromForm] IFormFile foto,
        [FromForm] string cpf,
        [FromForm] string? limiar,
        CancellationToken ct)
    {
        // 1. Validar CPF + localizar usuario
        var cpfNorm = ValidacaoCpfService.Formatar(cpf);
        if (cpfNorm is null)
            return BadRequest(new { erro = "CPF_INVALIDO" });

        var usuario = await db.Usuarios.AsNoTracking().FirstOrDefaultAsync(u => u.Cpf == cpfNorm, ct);
        if (usuario is null)
            return NotFound(new { erro = "USUARIO_NAO_ENCONTRADO" });

        // 2. Validar foto unica
        if (foto is null || foto.Length == 0)
            return BadRequest(new { erro = "FOTO_AUSENTE" });

        var mimesOk = new[] { "image/jpeg", "image/png", "image/webp" };
        var mime = string.IsNullOrWhiteSpace(foto.ContentType) ? "image/jpeg" : foto.ContentType;
        if (!mimesOk.Contains(mime))
            return BadRequest(new { erro = "MIME_NAO_SUPORTADO" });
        if (foto.Length > 10 * 1024 * 1024)
            return BadRequest(new { erro = "IMAGEM_MUITO_GRANDE" });

        // 3. Parse limiar
        double limiarFinal;
        if (string.IsNullOrWhiteSpace(limiar))
        {
            limiarFinal = 0.60;
        }
        else if (!double.TryParse(limiar, System.Globalization.NumberStyles.Any,
                     System.Globalization.CultureInfo.InvariantCulture, out limiarFinal)
                 || limiarFinal is < 0 or > 1)
        {
            return BadRequest(new { erro = "LIMIAR_INVALIDO", mensagem = "limiar deve estar entre 0 e 1 (ex.: 0.60)." });
        }

        // 4. Ler bytes da foto
        using var ms = new MemoryStream();
        await foto.CopyToAsync(ms, ct);
        var fotoB64 = Convert.ToBase64String(ms.ToArray());

        // 5. Carregar vetores cadastrados (cifrados) e decifrar (para Motor 2)
        var vetoresCifrados = await db.Vetores_Faciais.AsNoTracking()
            .Where(v => v.UsuarioId == usuario.Id)
            .ToListAsync(ct);

        List<List<float>> vetores = new();
        if (vetoresCifrados.Count > 0)
        {
            try
            {
                vetores = vetoresCifrados.Select(v =>
                    System.Text.Json.JsonSerializer.Deserialize<List<float>>(crypto.Descriptografar(v.Embedding))!)
                    .ToList();
            }
            catch (Exception ex)
            {
                await RegistrarLogAsync(usuario.Id, "login", motor: 2, autenticado: false,
                    score: null, limiar: limiarFinal, latenciaMs: 0, device: null, livenessOk: null,
                    erro: "DECIFRA_FALHOU", ct);
                return StatusCode(500, new { erro = "DECIFRA_FALHOU", mensagem = ex.Message });
            }
        }

        // 5b. ADR-018: carregar foto de referencia cifrada para o Motor 1 comparar
        var fotoRef = await db.Fotos_Referencia.AsNoTracking().FirstOrDefaultAsync(f => f.UsuarioId == usuario.Id, ct);
        string? refB64 = null;
        string? refMime = null;
        if (fotoRef is not null)
        {
            try
            {
                var bytesRef = crypto.DescriptografarBytes(fotoRef.ConteudoCifrado);
                refB64 = Convert.ToBase64String(bytesRef);
                refMime = fotoRef.Mime ?? "image/jpeg";
            }
            catch (Exception ex)
            {
                await RegistrarLogAsync(usuario.Id, "login", motor: 2, autenticado: false,
                    score: null, limiar: limiarFinal, latenciaMs: 0, device: null, livenessOk: null,
                    erro: "DECIFRA_FOTO_FALHOU", ct);
                return StatusCode(500, new { erro = "DECIFRA_FOTO_FALHOU", mensagem = ex.Message });
            }
        }

        // 6. Disparar ambos os motores em paralelo
        var swTotal = System.Diagnostics.Stopwatch.StartNew();

        // Motor 1 (Gemini) - comparacao identidade + liveness + ICAO (ADR-018)
        // Usa a foto de referencia decifrada + foto atual. Se nao tem referencia, faz so liveness.
        var motor1Task = Task.Run(async () =>
        {
            if (!motor1.Configurado)
                return new { ok = false, erro = "GEMINI_NAO_CONFIGURADO", dados = (object?)null, latenciaMs = 0L };
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                object? resultado;
                if (refB64 is not null)
                {
                    // Modo comparacao completa: identidade + liveness + ICAO (ADR-018)
                    var r = await motor1.CompararAsync(refB64, fotoB64, refMime!, ct);
                    resultado = r;
                }
                else
                {
                    // Fallback: sem foto de referencia, so liveness (usuario legado anterior ao ADR-018)
                    var r = await motor1.AnalisarLivenessAsync(fotoB64, mime, ct);
                    resultado = r;
                }
                sw.Stop();
                return new { ok = true, erro = (string?)null, dados = resultado, latenciaMs = sw.ElapsedMilliseconds };
            }
            catch (Exception ex)
            {
                sw.Stop();
                return new { ok = false, erro = ex.Message, dados = (object?)null, latenciaMs = sw.ElapsedMilliseconds };
            }
        }, ct);

        // Motor 2 (DeepFace) - identidade: compara embedding da foto contra vetores cadastrados
        var motor2Task = Task.Run(async () =>
        {
            if (vetores.Count == 0)
            {
                return new
                {
                    ok = false,
                    erro = "SEM_VETORES",
                    score = (double?)null,
                    limiar = limiarFinal,
                    autenticado = false,
                    livenessOk = (bool?)null,
                    device = (string?)null,
                    latenciaMs = 0L
                };
            }
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                var vresp = await vision.VerificarAsync(fotoB64, vetores, limiarFinal, ct);
                sw.Stop();
                return new
                {
                    ok = true,
                    erro = (string?)null,
                    score = (double?)vresp.Score,
                    limiar = limiarFinal,
                    autenticado = vresp.Autenticado && vresp.LivenessOk, // ADR-014
                    livenessOk = (bool?)vresp.LivenessOk,
                    device = vresp.Device,
                    latenciaMs = sw.ElapsedMilliseconds
                };
            }
            catch (VisionException vex)
            {
                sw.Stop();
                return new
                {
                    ok = false,
                    erro = vex.Codigo,
                    score = (double?)null,
                    limiar = limiarFinal,
                    autenticado = false,
                    livenessOk = (bool?)null,
                    device = (string?)null,
                    latenciaMs = sw.ElapsedMilliseconds
                };
            }
            catch (Exception ex)
            {
                sw.Stop();
                return new
                {
                    ok = false,
                    erro = ex.Message,
                    score = (double?)null,
                    limiar = limiarFinal,
                    autenticado = false,
                    livenessOk = (bool?)null,
                    device = (string?)null,
                    latenciaMs = sw.ElapsedMilliseconds
                };
            }
        }, ct);

        await Task.WhenAll(motor1Task, motor2Task);
        swTotal.Stop();

        var m1 = await motor1Task;
        var m2 = await motor2Task;

        // Normaliza resultado do Motor 1 (pode ser ComparacaoFacialResult ou AnaliseLivenessResult - ADR-018)
        // Extrai campos comuns para decisao e response.
        ComparacaoFacialResult? m1Comp = null;
        AnaliseLivenessResult? m1Live = null;
        if (m1.dados is ComparacaoFacialResult c) m1Comp = c;
        else if (m1.dados is AnaliseLivenessResult l) m1Live = l;

        var m1Liveness = m1Comp?.Liveness ?? m1Live?.Liveness;
        var m1Icao = m1Comp?.IcaoConformidade ?? m1Live?.IcaoConformidade;
        var m1Qualidade = m1Live?.Qualidade;
        var m1Justificativa = m1Comp?.Justificativa ?? m1Live?.Justificativa;
        var m1SimilaridadePct = m1Comp?.SimilaridadeFacial;  // so existe no modo comparacao
        var m1Confianca = m1Comp?.Confianca;

        // 7. Veto anti-spoofing do Motor 1 sobre o Motor 2 (ADR-014 estendido)
        // Se Motor 1 disse que a foto e printed/screen/mask, veto Motor 2 mesmo se a identidade bate.
        var m1LivenessClass = m1Liveness?.Classificacao?.ToLowerInvariant();
        var m1DetectouSpoofing = m1.ok && m1LivenessClass is "printed_photo" or "screen_replay" or "mask";
        var vetoM1 = m1DetectouSpoofing;
        var autenticadoFinal = m2.autenticado && !vetoM1;

        // 8. Gravar log apenas do Motor 2 (consistente com ADR-013), mas registrando veto do M1
        var log = new BiometriaLog
        {
            UsuarioId = usuario.Id,
            Operacao = "login",
            Motor = 2,
            Autenticado = autenticadoFinal,
            Score = m2.score,
            Limiar = m2.limiar,
            LatenciaMs = (int)m2.latenciaMs,
            Device = m2.device,
            LivenessOk = m2.livenessOk,
            Erro = vetoM1 ? $"VETO_M1_SPOOFING:{m1LivenessClass}" : m2.erro
        };
        db.Biometria_Logs.Add(log);
        await db.SaveChangesAsync(ct);

        // 9. Concordancia: ambos os motores concordam sobre aprovar ou nao.
        // M1 aprovado = (tem similaridade >= limiar) E (liveness OK se houver).
        var m1AprovadoIdentidade = m1Comp is not null && m1SimilaridadePct.HasValue && m1SimilaridadePct.Value >= (limiarFinal * 100);
        var m1AprovadoLiveness = m1LivenessClass == "live";
        var m1Aprovado = m1.ok && (m1Comp is null ? m1AprovadoLiveness : (m1AprovadoIdentidade && m1AprovadoLiveness));
        var m2Aprovado = autenticadoFinal;
        var concordancia = (m1Aprovado && m2Aprovado) || (!m1Aprovado && !m2Aprovado);

        // 10. JWT so se resultado final for autenticado (identidade OK + sem veto de liveness)
        string? token = null;
        if (autenticadoFinal)
            token = jwt.Gerar(usuario.Id, usuario.Cpf, usuario.Nome);

        Response.Headers["X-Motor"] = "comparativo-m1-m2";
        Response.Headers["X-Latencia-Total-Ms"] = swTotal.ElapsedMilliseconds.ToString();

        return Ok(new
        {
            usuarioId = usuario.Id,
            nome = usuario.Nome,
            concordancia,
            latenciaTotalMs = swTotal.ElapsedMilliseconds,
            motor1 = new
            {
                motor = "1-gemini",
                papel = m1Comp is not null ? "comparacao+liveness" : "liveness",
                ok = m1.ok,
                erro = m1.erro,
                similaridadePct = m1SimilaridadePct,        // so vem no modo comparacao (com foto de referencia)
                confianca = m1Confianca,
                liveness = m1Liveness,
                icaoConformidade = m1Icao,
                qualidade = m1Qualidade,
                justificativa = m1Justificativa,
                latenciaMs = m1.latenciaMs
            },
            motor2 = new
            {
                motor = "2-deepface",
                papel = "identidade",
                ok = m2.ok,
                erro = m2.erro,
                score = m2.score,
                limiar = m2.limiar,
                autenticado = autenticadoFinal,
                vetoSpoofing = vetoM1,
                livenessOk = m2.livenessOk,
                device = m2.device,
                latenciaMs = m2.latenciaMs,
                logId = log.Id
            },
            laudoUrl = $"/api/biometria/laudo/{log.Id}",
            token
        });
    }

    /// <summary>Remove todos os vetores faciais do usuario autenticado (LGPD: direito de exclusao).
    /// ADR-018: tambem remove a foto de referencia cifrada.</summary>
    [HttpDelete("vetores")]
    public async Task<IActionResult> RemoverVetores(CancellationToken ct)
    {
        var sub = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (!long.TryParse(sub, out var userId))
            return Unauthorized();

        var existentes = await db.Vetores_Faciais.Where(v => v.UsuarioId == userId).ToListAsync(ct);
        var fotoRef = await db.Fotos_Referencia.Where(f => f.UsuarioId == userId).ToListAsync(ct);
        if (existentes.Count == 0 && fotoRef.Count == 0)
            return NotFound(new { erro = "VETORES_NAO_ENCONTRADOS" });

        db.Vetores_Faciais.RemoveRange(existentes);
        db.Fotos_Referencia.RemoveRange(fotoRef);
        await db.SaveChangesAsync(ct);
        return Ok(new { removidos = existentes.Count, fotosReferenciaRemovidas = fotoRef.Count });
    }

    // Auxiliar: registra uma linha em Biometria_Logs (ADR-008)
    private async Task RegistrarLogAsync(
        long? userId, string operacao, byte motor, bool autenticado,
        double? score, double? limiar, int? latenciaMs,
        string? device, bool? livenessOk, string? erro, CancellationToken ct)
    {
        db.Biometria_Logs.Add(new BiometriaLog
        {
            UsuarioId = userId,
            Operacao = operacao,
            Motor = motor,
            Autenticado = autenticado,
            Score = score,
            Limiar = limiar,
            LatenciaMs = latenciaMs,
            Device = device,
            LivenessOk = livenessOk,
            Erro = erro
        });
        await db.SaveChangesAsync(ct);
    }
}
