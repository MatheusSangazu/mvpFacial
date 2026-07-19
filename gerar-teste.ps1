# Gera um JPEG cinza 200x200 valido (nao e rosto, so para o DeepFace retornar algo)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 200, 200
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.FillRectangle([System.Drawing.Brushes]::LightGray, 0, 0, 200, 200)
$g.Dispose()
$bmp.Save('c:\Users\barra\OneDrive\Documentos\Projetos\mvpFacial\backend\bin\Debug\net9.0\teste-real.jpg', [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()

# Le como bytes e envia para o endpoint
$bytes = [System.IO.File]::ReadAllBytes('c:\Users\barra\OneDrive\Documentos\Projetos\mvpFacial\backend\bin\Debug\net9.0\teste-real.jpg')
Write-Host "Arquivo: $($bytes.Length) bytes"
