# WaterMagician Downloader + Convert to EPUB

Fluxul proiectului: **extensia Chrome descarcă paginile → Python le convertește în EPUB**.

| Componentă | Rol |
| --- | --- |
| `extension/` | WaterMagician Downloader 1.2.0: cereri semnate, decriptare, imagini și salvare pe disc |
| `convert-to-epub/` | Conversie în EPUB cu pagini fixe, verificarea imaginilor și previzualizări |
| `automation/` | Browser Playwright pentru teste live și verificarea EPUB-urilor |
| `research/legacy-codec/` | Decoderul inițial și uneltele de analiză a JavaScript-ului obfuscat |

Istoricul complet și instrucțiunile pentru următorul agent sunt în [AGENTS.md](AGENTS.md).

## Instalare

```powershell
git clone https://github.com/AlexMCon/demo-project-water-magi.git
cd demo-project-water-magi
python -m pip install -r convert-to-epub/requirements.txt
```

În Chrome, deschide `chrome://extensions`, activează **Developer mode**, apasă **Load unpacked** și selectează folderul `extension` din acest repository. Apoi deschide sau reîmprospătează pagina capitolului.

## Descărcarea imaginilor

Folosește panoul extensiei: **De la cap.**, **Până la cap.**, **Doar cap.**, paginile de sărit și **Start**. Alege un folder, de exemplu `Downloads/WaterMagician`. Extensia creează subfoldere pentru capitole:

```text
WaterMagician/
  1/001.webp, 002.webp, ...
  2/001.webp, 002.webp, ...
```

Pe comix.to, extensia folosește modulul JavaScript încărcat chiar de site pentru tokenul `_` și pentru decriptarea răspunsului, inclusiv formatul `x-enc: 2`. Imaginile se cer cu `referrerPolicy: no-referrer`. Pentru paginile procesate pe canvas se păstrează imaginea randată.

## Conversia în ebook

Conversia folosește **Python + Pillow**, iar structura EPUB este scrisă cu biblioteca standard Python (`zipfile`, XHTML și OPF). Se produce câte un EPUB pentru fiecare capitol.

```powershell
python convert-to-epub/verify_images.py "C:/Users/alexm/Downloads/WaterMagician"
python convert-to-epub/convert_to_epub.py "C:/Users/alexm/Downloads/WaterMagician" "./output/epub" "Numele seriei"
```

Poți selecta capitolele la finalul comenzii:

```powershell
python convert-to-epub/convert_to_epub.py "./downloads" "./output/epub" "Numele seriei" 1 2 3
```

Setările implicite sunt: maximum **1236 × 1648**, JPEG cu calitate **85**, tonuri de gri, citire de la dreapta la stânga și despărțirea paginilor duble cu jumătatea dreaptă prima. Opțiuni: `--width`, `--height`, `--quality`, `--language`, `--color`, `--ltr`, `--no-split-spreads`. Fișierele `chapter-1` sunt recunoscute și ca numărul `1`.

```powershell
python automation/validate_epub.py "./output/epub/Numele-seriei-ch1.epub"
python convert-to-epub/preview_pages.py "./downloads" 1
```

Imaginile, EPUB-urile, arhivele și profilurile de browser sunt rezultate locale și sunt ignorate de Git.

## Teste și browser controlat

Pentru testele extensiei:

```powershell
npm ci
npm test
```

Pentru testare live opțională:

```powershell
npx playwright install chromium
npm run browser
```

Agentul de browser citește comenzi JSON, câte una pe linie. Exemple:

```json
{"id":1,"type":"goto","url":"https://comix.to/title/emenr-tokyo-ghoulre/10044830-chapter-1"}
{"id":2,"type":"snapshot"}
{"id":3,"type":"close"}
```

Folosește profilul și rezultatele din `output/browser-test`. `WM_OUTPUT_DIR` poate schimba folderul, iar `WM_BROWSER_PATH` poate indica un Chromium existent. Node.js este necesar pentru testare și automatizare; extensia instalată rulează direct în Chrome.

## Verificări efectuate

- **20/20 teste automate** ale extensiei trec.
- Test live pe capitolul `10044830`: **HTTP 200**, răspuns `x-enc: 2`, **48/48 imagini**, **70.392.178 bytes**. Toate imaginile au fost decodate și comparate cu dimensiunile din API.
- Conversie locală: **48 imagini → 51 pagini EPUB**, din cauza celor trei pagini duble; aproximativ **22 MiB**.

## Decoderul istoric

Decoderul pentru exemplul inițial funcționează fără a încărca JavaScript-ul site-ului:

```powershell
node research/legacy-codec/decode-stuff.cjs
```

Pentru comparația cu originalul este necesar fișierul original, păstrat local:

```powershell
$env:WM_LEGACY_SOURCE = "C:/Users/alexm/Downloads/secure-tm8ho8-BG12c_J_.js"
node research/legacy-codec/verify.cjs
node --expose-internals research/legacy-codec/inspect.cjs "$env:WM_LEGACY_SOURCE"
```

Aceste unelte explică formatul vechi; fluxul actual comix.to folosește modulul curent al paginii. Analiza inițială detaliată se află în `research/legacy-codec/WALKTHROUGH.txt`, care păstrează contextul și căile din sesiunea originală.
