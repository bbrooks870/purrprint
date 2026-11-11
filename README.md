# 🐱 PurrPrint

Print photos, notes, checklists and QR codes on a mini Bluetooth "cat" thermal printer — straight from the browser. No app, no sign-up, nothing uploaded.

**Features**
- 📷 **Photo** — upload, drag & drop, paste, or take a picture; rotate, brightness, contrast, invert
- ✍️ **Text** — 5 fonts, sizes, alignment, bold, date stamp, and giant sideways **banners**
- ✅ **Checklist** — to-do, shopping and packing presets
- 🔳 **QR code** — links, text, or a scannable **Wi-Fi login**
- 🎨 Styles: Auto (detects line art vs photos), Photo, Soft photo, Sharp lines, Comic dots
- 🌑 Darkness levels, print speed, multiple copies, paper feed
- Live preview that shows exactly what prints; works on desktop and Android, installable as an app

## Supported
- **Browsers:** Chrome, Edge, Opera, Samsung Internet (Web Bluetooth). iPhone/iPad: the Bluefy browser.
- **Printers:** cat printers on the `0xAE30` BLE service using the `51 78` command protocol — SC03h, GB01–GB03, GT01, MX05–MX10, YT01, X5/X6 and many unbranded ones. Tested on an SC03h.

## Develop
No build step — plain HTML, CSS and ES modules.
```bash
npm run dev    # http://localhost:5173 (Web Bluetooth works on localhost)
npm test       # protocol encoder vs. a byte capture from a real printer
```
Deploy: import the repo on Vercel with framework preset **Other**, no build command.

## Credits
The printer protocol is ported from [TiMini-Print](https://github.com/Dejniel/TiMini-Print) (Apache-2.0) by Dejniel.

## License
Apache-2.0
