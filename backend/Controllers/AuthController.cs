// AuthController - Endpoints de autenticacao e login facial
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    // POST: api/auth/login/facial
    [HttpPost("login/facial")]
    public IActionResult LoginFacial([FromBody] LoginFacialRequest req)
    {
        // TODO: rotear para o motor selecionado (1 ou 2)
        // Motor 1: GeminiService (demo de falha)
        // Motor 2: PythonVisionService (DeepFace + OpenCV)
        return Ok(new
        {
            autenticado = false,
            metricas = new
            {
                motor = req.Motor,
                latenciaMs = 0,
                score = 0.0,
                limiar = 0.60,
                device = req.Dispositivo,
                livenessOk = false
            }
        });
    }
}

// DTO do request de login facial
public class LoginFacialRequest
{
    public int Motor { get; set; }      // 1 ou 2
    public string Dispositivo { get; set; } = "cpu";  // cpu | cuda
    public string Midia { get; set; } = "";  // base64
}
