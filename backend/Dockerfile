# Backend .NET 9 - multi-estagio (build com SDK, runtime com ASPNET). ADR-020
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY backend.csproj ./
RUN dotnet restore backend.csproj
COPY . .
RUN dotnet publish backend.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app
# .NET 9 roda como usuario `app` por padrao (UID 1654) - nao precisamos de root.
COPY --from=build /app/publish ./
ENV ASPNETCORE_URLS=http://+:5251
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 5251
ENTRYPOINT ["dotnet", "backend.dll"]
