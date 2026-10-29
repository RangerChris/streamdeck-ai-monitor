# Generates the AI Monitor action icons: one terminal-card icon per action, lettered to its subject.
# Run from the repo root:  powershell -File tools\make-icons.ps1
param(
	[string]$ImgDir = "$PSScriptRoot\..\com.segment7.aimonitor.sdPlugin\imgs"
)

Add-Type -AssemblyName System.Drawing

$bg = [System.Drawing.Color]::FromArgb(255, 32, 32, 36)
$accent = [System.Drawing.Color]::FromArgb(255, 240, 240, 240) # white glyphs only

# One entry per action in the manifest: folder under imgs\actions, glyph, symbol font.
$icons = @(
	@{ Name = "ollama-balance"; Glyph = '$'; Font = 'Segoe UI Symbol' }
	@{ Name = "claude-usage";   Glyph = 'Σ'; Font = 'Segoe UI Symbol' }
	@{ Name = "claude-sessions"; Glyph = '◉'; Font = 'Segoe UI Symbol' }
	@{ Name = "claude-model";   Glyph = '✦'; Font = 'Segoe UI Symbol' }
	@{ Name = "grove";          Glyph = '♣'; Font = 'Segoe UI Symbol' }
	@{ Name = "ollama-infobar"; Glyph = '≡'; Font = 'Segoe UI Symbol' }
)

function New-Icon {
	param([int]$Size, [string]$Glyph, [string]$GlyphFont, [float]$CornerRadiusRatio = 0.12)

	$bmp = New-Object System.Drawing.Bitmap($Size, $Size)
	$g = [System.Drawing.Graphics]::FromImage($bmp)
	$g.SmoothingMode = 'AntiAlias'
	$g.TextRenderingHint = 'AntiAlias'

	# Card
	$radius = $Size * $CornerRadiusRatio
	$path = New-Object System.Drawing.Drawing2D.GraphicsPath
	$path.AddArc(0, 0, $radius * 2, $radius * 2, 180, 90)
	$path.AddArc($Size - $radius * 2 - 1, 0, $radius * 2, $radius * 2, 270, 90)
	$path.AddArc($Size - $radius * 2 - 1, $Size - $radius * 2 - 1, $radius * 2, $radius * 2, 0, 90)
	$path.AddArc(0, $Size - $radius * 2 - 1, $radius * 2, $radius * 2, 90, 90)
	$path.CloseFigure()
	$cardBrush = New-Object System.Drawing.SolidBrush $bg
	$g.FillPath($cardBrush, $path)

	# Glyph, roughly centered with a little optical lift
	$fontSize = $Size * 0.75
	$font = New-Object System.Drawing.Font($GlyphFont, $fontSize, [System.Drawing.FontStyle]::Bold)
	$brush = New-Object System.Drawing.SolidBrush $accent
	$glyphSize = $g.MeasureString($Glyph, $font)
	$g.DrawString($Glyph, $font, $brush, ($Size - $glyphSize.Width) / 2, ($Size - $glyphSize.Height) / 2 - ($Size * 0.02))

	$g.Dispose()
	return $bmp
}

foreach ($icon in $icons) {
	$dir = Join-Path $ImgDir "actions\$($icon.Name)"
	New-Item -ItemType Directory -Force $dir | Out-Null
	# Action icon (action list), 20px and 40px @2x
	(New-Icon -Size 20 -Glyph $icon.Glyph -GlyphFont $icon.Font).Save("$dir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
	(New-Icon -Size 40 -Glyph $icon.Glyph -GlyphFont $icon.Font).Save("$dir\icon@2x.png", [System.Drawing.Imaging.ImageFormat]::Png)
	# Key image, 72px and 144px @2x
	(New-Icon -Size 72 -Glyph $icon.Glyph -GlyphFont $icon.Font).Save("$dir\key.png", [System.Drawing.Imaging.ImageFormat]::Png)
	(New-Icon -Size 144 -Glyph $icon.Glyph -GlyphFont $icon.Font).Save("$dir\key@2x.png", [System.Drawing.Imaging.ImageFormat]::Png)
}

# Category icon: the monitoring eye
(New-Icon -Size 56 -Glyph '◉' -GlyphFont 'Segoe UI Symbol' -CornerRadiusRatio 0.28).Save("$ImgDir\plugin\category-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
(New-Icon -Size 112 -Glyph '◉' -GlyphFont 'Segoe UI Symbol' -CornerRadiusRatio 0.28).Save("$ImgDir\plugin\category-icon@2x.png", [System.Drawing.Imaging.ImageFormat]::Png)

"Icons written to $ImgDir"