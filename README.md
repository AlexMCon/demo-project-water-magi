# Nori Downloader, recuperare pagini și EPUB

Instrumentele proiectului acoperă descărcarea imaginilor, recuperarea paginilor
lipsă, verificarea locală/live și conversia în EPUB cu pagini fixe. Codul este
portabil între Windows și Linux/WSL; imaginile și cărțile rezultate rămân locale.

| Componentă | Rol |
| --- | --- |
| `extension/` | **Nori 46 1.2.1**: downloaderul complet de capitole |
| `extension-repair/` | **Nori 47 1.0.2**: plan editabil de recuperare și verificarea totalurilor API |
| `convert-to-epub/` | EPUB pe capitol, colecții după interval și colecții cu limită de dimensiune |
| `automation/` | Audit local/live, Chromium controlat și distribuțiile extensiilor |
| `research/legacy-codec/` | Decoderul istoric și analiza formatului inițial |

[AGENTS.md](AGENTS.md) păstrează istoricul și regulile proiectului.

## Instalare pe alt calculator

Sunt necesare Node.js 22+ pentru testare/automatizare și Python cu Pillow pentru
verificarea imaginilor și EPUB. Extensiile instalate rulează direct în Chrome,
fără Node sau Python.

```bash
git clone https://github.com/AlexMCon/demo-project-water-magi.git
cd demo-project-water-magi
npm ci
python -m venv .venv
```

Activează mediul Python în terminalul tău:

```bash
# Linux / WSL (folosește python3 la crearea mediului dacă nu există python)
source .venv/bin/activate
```

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

Apoi:

```bash
python -m pip install -r convert-to-epub/requirements.txt
npm run build:extensions
```

Distribuțiile sunt în `output/extensions/nori46/`, `nori47/`, `nori46.zip` și
`nori47.zip`. Generatorul include numai fișierele necesare extensiilor și produce
arhive reproductibile. Poți alege altă destinație:

```bash
node automation/build-distributions.cjs "./output/distributii"
```

În `chrome://extensions`, activează **Developer mode**, apasă **Load unpacked**
și selectează folderul dorit. Pentru ZIP, extrage mai întâi arhiva. După orice
actualizare, apasă **Reload** la extensie și reîmprospătează readerul. Dezactivează
copiile vechi și rulează un singur downloader în același tab.

În WSL, căile Windows se scriu astfel: `C:\Users\…` → `/mnt/c/Users/…`.
Comenzile de mai jos folosesc `./downloads` și `./output`, care sunt ignorate de
Git. Nu include surse manga, EPUB-uri, profiluri sau bundle-uri externe în repo.

## Descărcare și recuperare în Chrome

**Nori 46**: deschide un capitol, completează **De la cap.**, **Până la cap.** sau
**Doar cap.**, apoi **Start** și alege folderul seriei. Debifează omiterea
capitolelor `.5` dacă vrei să incluzi toate fracționarele. Poți configura paginile
de sărit. Rezultatul are subfoldere numerice:

```text
downloads/
  10/001.webp, 002.webp, ...
  10.5/001.webp, ...
  11/001.webp, ...
```

**Nori 47**: alege un interval și un plan, de exemplu:

```text
136: 7
141: 11, 13
145: 6-7, 16-17
183: *
```

`*` înseamnă întregul capitol. **Verifică toate paginile** compară fișierele cu
totalul API, inclusiv paginile de final, și completează planul. **Recuperează
selecția** descarcă numai țintele din plan și interval; fișierele existente sunt
păstrate implicit. Selectează folderul seriei, nu folderul unui capitol.

Sursa este blocată pe durata rulajului. Schimbarea între ediții rămâne manuală:
oprește, alege sursa corectă în reader și pornește următorul interval. Pentru
Aristocrat există preseturi Original 136–170 și K-Manga 171–184; intervalele și
linkurile sunt editabile pentru capitole noi. Rapoartele se salvează în
`_wm-repair/` sub folderul ales; progresul rămas este păstrat în extensie.
[Instrucțiuni complete Nori 47](extension-repair/README.md).

Pe comix.to se reutilizează modulul încărcat de site pentru tokenul `_` și
răspunsul `x-enc: 2`, inclusiv integrarea `apicore-*` din 2026-10-28 și vechiul
installer `secure-*`. Tokenul nu este înlocuit cu timestamp. Cererile de imagini
folosesc `no-referrer`; canvas-ul procesat de site are prioritate. Bridge-ul
validează fereastra, originea, capitolul curent și destinația GET-ului.

Ambele extensii au acces general la site-uri, iar panourile apar când se găsește
readerul compatibil. Codec-ul MAIN rulează pe comix.to. Numele/descripțiile
neutre sunt etichete; permisiunile rămân vizibile în Chrome.

## Verificarea imaginilor și a paginilor de final

Auditul local decodează complet imaginile, calculează SHA-256 și raportează
goluri, capitole întregi absente între limitele observate/cerute, numere duplicate, duplicate de conținut și pagini
uniforme. Nu modifică imaginile:

```bash
python automation/audit_images.py "./downloads" --from 10 --to 45 --output "./output/audit-local"
```

Fără raport API, poate detecta numai golurile până la cel mai mare număr local;
nu poate demonstra că ultima pagină există. Uniformitatea și imaginile repetate
sunt semnale de inspectat, deoarece unele sunt pagini decorative intenționate.

Auditul live navighează readerul secvențial, doar pentru metadata. Blochează
încărcarea imaginilor CDN în browserul de audit și nu descarcă/scrie imagini:

```bash
npx playwright install chromium
node automation/audit-chapter-counts.cjs "./downloads" "https://comix.to/title/19l0d-a-tale-of-the-secret-saint/9394770-chapter-45" --from 10 --to 45 --output "./output/audit-api"
python automation/audit_images.py "./downloads" --from 10 --to 45 --expected "./output/audit-api/live-totals.json" --output "./output/audit-complet"
```

Pornește de la unul dintre capetele intervalului. Implicit: 5 secunde între
capitole, profil separat, sursă blocată. Opțiuni: `--profile DIR`,
`--pause-seconds 5`, `--wait-seconds 120`, `--headless` și, numai când vrei să
verifici mai multe grupuri în același interval, `--allow-source-change`.
Cloudflare se rezolvă manual în fereastra Chromium; instrumentul nu o ocolește.
Pe Linux pot fi necesare bibliotecile sistemului: `npx playwright install-deps chromium`.

Rapoartele parțiale se păstrează la erori. `complete` în raportul live înseamnă
că toate capitolele din interval au fost vizitate; verifică și `missingPages`.
Auditul local cu `--expected` verifică totalurile, dimensiunile și lipsurile de
final. Acceptă rapoarte live, rapoarte Nori 47 sau batch-uri Aristocrat; poți da
`--expected` de mai multe ori pentru surse/intervale distincte. Un raport Nori 47
poate avea totaluri fără dimensiuni; atunci comparația dimensiunilor nu se face.

Presetul istoric de audit pentru Aristocrat rămâne disponibil:

```bash
node automation/audit-aristocrat.cjs "./downloads" "./output/aristocrat-audit"
```

Acoperă separat 136–170 și 171–184. Pentru un capitol 185 sau altă limită,
folosește comanda generică și URL-ul corect al capătului noului interval.
Utilitarul simplu inițial rămâne disponibil:

```bash
python convert-to-epub/verify_images.py "./downloads"
```

## Conversie și colecții EPUB

Setări implicite: maximum **1236 × 1648**, JPEG **85**, grayscale, fără
upscaling, citire RTL și împărțirea imaginilor landscape cu jumătatea dreaptă
prima. Imaginile originale rămân intacte.

Un EPUB per capitol:

```bash
python convert-to-epub/convert_to_epub.py "./downloads" "./output/epub" "Numele seriei"
python convert-to-epub/convert_to_epub.py "./downloads" "./output/epub" "Numele seriei" 10 11 12
```

Colecții cu limite explicite sau câte N capitole, cu un cuprins per capitol:

```bash
python convert-to-epub/convert_to_epub.py "./downloads" "./output/epub" "Numele seriei" --ranges 10-20 21-30
python convert-to-epub/convert_to_epub.py "./downloads" "./output/epub" "Numele seriei" --group-size 10
```

Fracționarele intră în grupul părții întregi. `--groups 2 3` selectează anumite
grupuri. `--source DIR` adaugă o a doua rădăcină de capitole; coliziunile de
capitol sunt refuzate. `--move-pages 22:1-20=21` permite repararea explicită a
încadrării paginilor în rezultatul EPUB, fără mutarea surselor originale.
Opțiuni comune: `--width`, `--height`, `--quality`, `--language`, `--color`,
`--ltr`, `--no-split-spreads`.

Pentru colecții limitate după dimensiune, vezi
[pack_collections.py](convert-to-epub/PACK_COLLECTIONS.md). MB înseamnă
1.000.000 bytes; limita implicită este 200 MB. Capitolul rămâne întreg, ordinea
numerică și cuprinsul sunt păstrate, iar cache-ul evită reconversia paginilor.

```bash
python convert-to-epub/pack_collections.py "./downloads" "./output/collections" "Numele seriei" --max-mb 200
```

Verifică fiecare EPUB și, opțional, creează previzualizarea:

```bash
python automation/validate_epub.py "./output/epub/Numele-seriei-ch10.epub"
python convert-to-epub/preview_pages.py "./downloads" 10
```

Validatorul verifică arhiva, XML, referințe, spine și imagini. Nu înlocuiește
EPUBCheck sau proba pe dispozitiv.

## Automatizare Chromium și teste

Downloaderul lent folosește extensia reală, include fracționarele, verifică
imaginile și păstrează rezultatele în `output/sequential-download/`:

```bash
node automation/download-chapters.cjs "https://comix.to/title/emenr-tokyo-ghoulre/10044830-chapter-1" 10
```

Are pauze de 3 secunde înaintea cererilor imaginilor și 30 de secunde între
capitole. Un al treilea argument schimbă folderul; `WM_HEADFUL=1` arată browserul
(pe PowerShell: `$env:WM_HEADFUL="1"`). `WM_BROWSER_PATH` alege un Chromium
existent. Readerul poate face și cereri proprii. Reluarea de la cel mai mare
capitol întreg verificat este disponibilă pentru exemplul Tokyo Ghoul:re;
pentru alte serii pornește din URL-ul capitolului dorit și păstrează o destinație
separată per serie. La erori sau Cloudflare se oprește/păstrează diagnosticul.

Harness-ul interactiv citește o comandă JSON per linie:

```bash
npm run browser
```

```json
{"id":1,"type":"goto","url":"https://comix.to/title/emenr-tokyo-ghoulre/10044830-chapter-1"}
{"id":2,"type":"snapshot"}
{"id":3,"type":"close"}
```

Testele automate folosesc mockuri sau un reader local simulat; nu sunt dovezi
live ale site-ului:

```bash
npm test
npm run test:repair-browser
python -m unittest discover -s automation/tests -p "test_*.py"
python -m unittest discover -s convert-to-epub/tests -p "test_*.py"
```

Dovezi live datate: Tokyo Ghoul:re 1 (2026-10-12), 48 imagini descărcate;
Aristocrat 170 și 184 (2026-10-28), metadata 20/19 pagini; Secret Saint 10–45
(2026-10-28), toate cele 41 de capitole/1.380 imagini comparate cu API-ul.
Acestea nu garantează că sursa sau interfața site-ului rămân neschimbate.

## Decoderul istoric

```bash
node research/legacy-codec/decode-stuff.cjs
```

Pentru comparația cu originalul, fișierul local original nu este inclus în repo.
Setează `WM_LEGACY_SOURCE`, apoi:

```bash
node research/legacy-codec/verify.cjs
node --expose-internals research/legacy-codec/inspect.cjs "/cale/secure-original.js"
```

În PowerShell: `$env:WM_LEGACY_SOURCE="C:/cale/secure-original.js"`; în Bash:
`export WM_LEGACY_SOURCE="/cale/secure-original.js"`.
[WALKTHROUGH.txt](research/legacy-codec/WALKTHROUGH.txt) explică formatul vechi.
Fluxul actual folosește modulul curent al paginii și nu vectorii vechi.
