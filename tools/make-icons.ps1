# Generates the RunCommand plugin icons (terminal prompt glyph on a rounded card).
# Run from the repo root:  powershell -File tools\make-icons.ps1
param(
	[string]$ImgDir = "$PSScriptRoot\..\com.elleby.runcommands.sdPlugin\imgs"
)

Add-Type -AssemblyName System.Drawing

$bg = [System.Drawing.Color]::FromArgb(255, 32, 32, 36)
$accent = [System.Drawing.Color]::FromArgb(255, 78, 201, 176) # terminal green/teal

function New-IconPath {
	param([int]$Size, [string]$Glyph, [float]$GlyphScale, [float]$CornerRadiusRatio = 0.12)

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

	# Prompt glyph, roughly centered with a little optical lift
	$fontSize = $Size * $GlyphScale
	$font = New-Object System.Drawing.Font('Consolas', $fontSize, [System.Drawing.FontStyle]::Bold)
	$brush = New-Object System.Drawing.SolidBrush $accent
	$glyphSize = $g.MeasureString($Glyph, $font)
	$g.DrawString($Glyph, $font, $brush, ($Size - $glyphSize.Width) / 2, ($Size - $glyphSize.Height) / 2 - ($Size * 0.02))

	$g.Dispose()
	return $bmp
}

# Action icon (shows in the action list), 20px and 40px @2x
(New-IconPath -Size 20 -Glyph '>_' -GlyphScale 0.42).Save("$ImgDir\actions\run-command\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
(New-IconPath -Size 40 -Glyph '>_' -GlyphScale 0.42).Save("$ImgDir\actions\run-command\icon@2x.png", [System.Drawing.Imaging.ImageFormat]::Png)

# Key image, 72px and 144px @2x
(New-IconPath -Size 72 -Glyph '>_' -GlyphScale 0.5).Save("$ImgDir\actions\run-command\key.png", [System.Drawing.Imaging.ImageFormat]::Png)
(New-IconPath -Size 144 -Glyph '>_' -GlyphScale 0.5).Save("$ImgDir\actions\run-command\key@2x.png", [System.Drawing.Imaging.ImageFormat]::Png)

# Plugin / category icons, terminal prompt on dark
(New-IconPath -Size 56 -Glyph '>_' -GlyphScale 0.5 -CornerRadiusRatio 0.28).Save("$ImgDir\plugin\category-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
(New-IconPath -Size 112 -Glyph '>_' -GlyphScale 0.5 -CornerRadiusRatio 0.28).Save("$ImgDir\plugin\category-icon@2x.png", [System.Drawing.Imaging.ImageFormat]::Png)

"Icons written to $ImgDir"