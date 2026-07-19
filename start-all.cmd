@echo off
REM Wrapper CMD para start-all.ps1 - util para quem prefere cmd ou atalho duplo-clique.
REM Uso:  start-all.cmd            (inicia)
REM       start-all.cmd -Stop      (para tudo)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1" %*
