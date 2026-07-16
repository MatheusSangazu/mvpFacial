// Backend C# .NET - Orquestrador do MVP de reconhecimento facial
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

// Servicos
builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });

// CORS - permite o frontend Next.js
var corsOrigins = builder.Configuration["CORS_ORIGINS"]
    ?? "http://localhost:3000";
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(corsOrigins.Split(','))
              .AllowAnyHeader()
              .AllowAnyMethod();
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
app.UseAuthorization();
app.MapControllers();

app.Run();
