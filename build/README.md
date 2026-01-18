# App Icons

Place your app icons here:

- `icon.icns` - macOS app icon (512x512 or larger, .icns format)
- `icon.ico` - Windows app icon (.ico format with multiple sizes)
- `icon.png` - Source PNG (1024x1024 recommended)

## Creating Icons

### Option 1: Online Tool
1. Create or find a 1024x1024 PNG icon
2. Use https://www.icoconverter.com/ to create .ico
3. Use https://cloudconvert.com/png-to-icns to create .icns

### Option 2: macOS Command Line
```bash
# From a 1024x1024 icon.png:
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
rm -rf icon.iconset
```

### Default Icons
If no icons are provided, electron-builder will use a default icon.
