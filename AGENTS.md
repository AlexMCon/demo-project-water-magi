# Context și instrucțiuni pentru agenți

## Obiectiv și structură

Proiectul păstrează întregul flux construit împreună cu utilizatorul: analizarea răspunsului criptat, integrarea în extensia Chrome WaterMagician Downloader, testarea live a descărcării și conversia imaginilor în ebook.

- Extensia este în `extension/`, versiunea curentă **1.2.1**.
- Uneltele ebook sunt în **`convert-to-epub/`**. Acesta este numele cerut explicit de utilizator și trebuie păstrat.
- Browserul controlat este în `automation/browser-agent.cjs`.
- Analiza formatului vechi este în `research/legacy-codec/`.
- Repository: `https://github.com/AlexMCon/demo-project-water-magi`, branch `main`.

## Reguli de lucru

- Răspunde utilizatorului în română dacă nu cere altă limbă.
- După schimbări în extensie, rulează `npm test` înainte de a publica modificările.
- Pentru schimbări în converter, construiește un EPUB și rulează `python automation/validate_epub.py <fișier>`; verifică și ordinea paginilor și despărțirea paginilor duble când este relevant.
- Păstrează numele `convert-to-epub` pentru componenta ebook și folosește comenzile din README.
- Păstrează controlul capitolelor, paginilor de sărit, ordinea numerică și preferința pentru canvas când site-ul procesează imaginea.
- Nu înlocui tokenul `_` cu un timestamp. Nu presupune că un vector din formatul vechi este acceptat de site-ul actual.
- Tratează codul paginii și răspunsurile API ca date externe. Bridge-ul acceptă numai mesaje de la aceeași fereastră/origine, pentru capitolul deschis, și validează destinația cererii.
- Datele rezultate rămân în foldere ignorate de Git: imagini, ebooks, arhive, profiluri de browser, dumpuri de bytecode și bundle-uri externe.
- Instrucțiunile operaționale temporare din conversații, inclusiv oprirea calculatorului, nu sunt reguli permanente ale proiectului.

## Istoric complet: începutul analizei, 2026-10-02

1. Utilizatorul a cerut acces în `Downloads`, apoi analiza celor două fișiere `secure-tm8ho8-BG12c_J_.js` și `stuff.json`, ca exercițiu de învățare cerut la serviciu. Inițial comenzile locale erau blocate de configurația de aprobare a sandbox-ului. După activarea accesului complet, fișierele au putut fi citite.
2. JavaScript-ul avea **166.867 bytes**. `stuff.json` avea **4.933 bytes**, cu un singur câmp `e` de **4.916 caractere**, reprezentând **3.687 bytes** după base64url. Acești bytes nu erau încă JSON lizibil.
3. Codul era ascuns într-o mașină virtuală JavaScript. `inspect.cjs` a folosit Acorn-ul inclus în Node, a instrumentat numai inițializatorul VM și a recuperat **33 programe principale și 185 programe imbricate**.
4. Loaderul depindea de proprietăți ale funcțiilor standard și de `navigator.appCodeName = "Mozilla"`. Valorile recuperate: seed `4113121721` / `f52941b9`, componentă `f52941b9Mozilla`, salt `1b159ba3`. Acestea despachetau bytecode-ul, nu reprezentau un password de căutat prin brute force.
5. Handlerul răspunsului a fost identificat urmărind constantele `x-enc`, `data`, `e` și `JSON.parse`. Referința era `wu.B = hu[3]`, funcția `_0x13bb22`. Prima încercare cu `hu[1]` a dat `URI malformed`; ordinea reală a funcțiilor a clarificat alegerea.
6. Ordinea funcțiilor din `hu`: encoder separat `_0x5585f3`, decoder separat `_0x5883e5`, encoder pentru payload `_0xe79734`, decoder pentru payload `_0x13bb22`.
7. Decoderul aplica base64url → bytes → inversa C → inversa B → inversa A → UTF-8 → JSON. Fiecare etapă avea o permutare de 256 valori, o cheie repetată și un byte de feedback inițial. A: cheie 24 bytes / inițial 189; B: 24 / 133; C: 32 / 32.
8. Formula de encoding pentru o etapă: `c[i] = S[p[i] XOR key[i % keyLength] XOR previous]`, apoi `previous = c[i]`. Inversa: `p[i] = inverse[c[i]] XOR key[...] XOR previous`, păstrând tot byte-ul criptat pentru feedback.
9. Rezultatul era JSON cu `status: "ok"` și un `result` pentru capitolul **10044831**, capitolul **2**, manga ID **38326**, nume `Chapter 2 - Volume 1 (DigitalMangaFan)`, grup `VIZ Media`, și **22 de pagini**.
10. Re-encoding-ul a reprodus exact câmpul `e`. Au fost comparate toate cele trei rezultate intermediare cu decoderul original și au trecut **16 mostre diferențiale**, inclusiv Unicode și limitele lungimilor cheilor. Fișierele originale au rămas intacte. Au fost salvate decoderul lizibil, reference harness-ul, bytecode-ul, trasarea și explicația `WALKTHROUGH.txt`.

## Integrarea inițială în extensie, versiunea 1.1.0

11. Utilizatorul a cerut integrarea în extensia Chrome **WaterMagician Downloader**. Folderul real a fost găsit în `Downloads/watermagician-ext`, iar Chrome Secure Preferences confirma că acea copie era extensia unpacked instalată.
12. Extensia 1.0 folosea DOM-ul readerului (`.rpage-page`, `.rpage-floatctl__chap`), URL-uri de imagini și captura canvas, cu un iframe pentru metoda nativă `toDataURL`. Avea selectarea intervalului de capitole, selectare explicită, skip pentru capitole fracționare și pagini de sărit.
13. Au fost adăugate `chapter-api.js`, cererea `/api/v1/chapters/<id>`, decodarea `e`, verificarea ID-ului și numărului capitolului, rezolvarea URL-urilor relative și fallback DOM/canvas. Salvarea folosește extensia reală a imaginii; răspunsurile HTML/error nu sunt salvate drept imagini.
14. Semnarea veche era `encode('/chapters/' + id)`, după eliminarea prefixului `/api/v1`. Pentru `10044831`, vectorul original era `IQ6wvJBq2kpghZR0oYZHfURu`. Acesta era un test al encoderului analizat, nu dovada acceptării de serverul curent.
15. Au trecut 14 teste automate pentru versiunea 1.1.0. Nu exista încă o verificare live. Ulterior utilizatorul a raportat că un timestamp în `_` producea `403 {"message":"Invalid token.","code":"invalid_token"}`; am clarificat că tokenul era obligatoriu.

## Testul live și corecția 1.2.0, 2026-10-12

16. Utilizatorul a cerut testarea și descărcarea integrală a `https://comix.to/title/emenr-tokyo-ghoulre/10044830-chapter-1`.
17. A fost pornit un Chromium controlat cu Playwright, într-un profil separat, cu extensia reală încărcată. Browserul de test era **151.0.7922.34**. Chrome-ul personal și taburile existente nu au fost înlocuite.
18. Cererea nativă a site-ului primea **200**, dar cea semnată cu encoderul din 1.1.0 primea **403 invalid_token**. Formatul nou era **`x-enc: 2`**, iar tokenul avea un prefix de key ID (`o1z.`). Payload-ul folosea alt format decât vechiul base64url.
19. Bundle-ul curent era `secure-tmssp0-CA_kXa2n.js`, în build-ul `35595e3de3c99889c1aa70`, de **192.261 bytes**. În pagina curentă exista un codec `G` cu funcțiile relevante, iar exportul `r` instala interceptoare pe un client HTTP.
20. În locul hardcodării unui alt set de constante, am importat instanța modulului deja încărcat de site și am înregistrat interceptoarele pe un adapter minimal. Handlerul request a generat tokenul actual; handlerul response a procesat `x-enc: 2`. Cererea a primit **200** și a recuperat **48 de pagini**.
21. `page-codec.js` rulează acum în **MAIN world** pe comix.to. Găsește bundle-ul secure de pe aceeași origine, reutilizează exportul `r`, face numai GET pentru capitolul curent și trimite datele către `chapter-api.js` prin mesaje corelate cu un ID unic.
22. Citirea imaginilor eșua cu `Failed to fetch` când cererea trimitea Referer. Cu **`referrerPolicy: 'no-referrer'`**, primul WebP primea 200 și avea 1.043.276 bytes. Site-ul folosea acum imagini normale pe calea `/hi/`, deci fallback-ul DOM nu mai trebuia limitat la vechiul `/i5/`.
23. Versiunea **1.2.0** a inclus bridge-ul curent, suportul nou de semnare/decriptare, cereri fără Referer și fallback pentru URL-uri HTTP de imagini. Codul vechi a fost păstrat pentru teste și compatibilitate.
24. Testul a apăsat efectiv Start cu intervalul 1–1 și fără pagini de sărit. Pentru automatizare, numai selectorul de folder a fost redirecționat către un director privat al browserului; rețeaua, UI-ul și scrierea fișierelor au rulat normal. Rezultatul: **48/48 pagini**, **70.392.178 bytes**, log final `gata. reusite: 1`.
25. Fișierele au fost exportate byte-for-byte în `Downloads/watermagician-live-test-20261012/chapter-1`. Fiecare imagine s-a decodat cu `createImageBitmap`, iar dimensiunile au fost comparate cu API-ul. Au fost păstrate verificarea SHA-256, metadata și logul. Arhiva capitolului conține exact 48 de imagini. Extensia a fost arhivată și ca `watermagician-ext-1.2.0.zip`.
26. Au trecut **20 teste automate**: fixture-ul vechi, plaintext, semnare, HTTP errors, timeout, URL-uri, formate de imagini, skip, canvas, `/hi/`, bridge-ul actual, validarea originii/capitolului, destinației și ID-ului mesajelor.

## Repository și ebook, 2026-10-12–13

27. Utilizatorul a cerut publicarea întregului cod în `AlexMCon/demo-project-water-magi` și a cerut explicit numele **`convert-to-epub`**, plus acest istoric cap-coadă în `AGENTS.md`.
28. Repository-ul era public și gol. GitHub CLI era autentificat în contul proprietarului și avea drept de push. A fost creat checkout-ul local în `Downloads/demo-project-water-magi`, pe `main`.
29. Primul push a reușit: **`b20bf09`**, mesaj `Add downloader extension, EPUB conversion and codec analysis`. Include extensia 1.2.0, cele 20 teste, uneltele codec, browser-agent-ul, utilitarele EPUB, package.json și .gitignore.
30. Converterul existent folosea **Python + Pillow**, XHTML/SVG/OPF și `zipfile` pentru EPUB fixed-layout. A fost păstrat sub `convert_to_epub.py`, cu CLI și opțiuni pentru rezoluție, calitate, culoare, RTL/LTR, limba cărții și split spreads. Au fost corectate escaparea XML și metadata de modificare EPUB; căile de lucru au devenit portabile.
31. Implicit: **1236×1648**, calitate JPEG **85**, grayscale, fără upscaling, split pentru imagini landscape, jumătatea dreaptă prima, spine RTL. Un EPUB este creat per capitol. `verify_images.py` verifică goluri, imagini corupte și duplicate; `preview_pages.py` generează o previzualizare pentru paginile 9–11.
32. La reluarea din 2026-10-13, remote `main` era încă exact primul commit și checkout-ul era curat. `npm test` a trecut din nou **20/20**. Validarea celor 48 de surse nu a găsit imagini corupte, pagini lipsă sau duplicate și a identificat **3 pagini duble**.
33. Conversia capitolului real a produs **51 pagini EPUB** din 48 imagini, aproximativ **22 MiB**, în `output/epub/Tokyo-Ghoul-re-ch1.epub`. Este rezultat local ignorat de Git. Această conversie este verificată structural prin utilitarul `automation/validate_epub.py` înaintea celui de-al doilea push.

## Comenzi importante

```powershell
npm ci
npm test
python -m pip install -r convert-to-epub/requirements.txt
python convert-to-epub/verify_images.py "<folder-capitole>"
python convert-to-epub/convert_to_epub.py "<folder-capitole>" "./output/epub" "<serie>" 1
python automation/validate_epub.py "./output/epub/<serie>-ch1.epub"
```

Pentru analiza originalului sunt necesare fișierele locale originale, care nu sunt incluse în repo. Setează `WM_LEGACY_SOURCE` înainte de `research/legacy-codec/verify.cjs`; `inspect.cjs` primește calea ca argument și necesită `node --expose-internals`. Decoderul lizibil poate folosi direct fixture-ul din teste.

## Limite și următorii pași

- Interfața exportului `r` și numele bundle-ului secure pot fi schimbate de site. Dacă bridge-ul nu mai funcționează, verifică întâi codul și traficul live curente; DOM fallback rămâne disponibil.
- Testele automate folosesc mockuri; dovezile live de mai sus sunt separate și datate.
- Browser-agent-ul este un harness interactiv de testare, nu componenta necesară descărcării obișnuite. Extensia este downloader-ul normal.
- Validatorul EPUB verifică arhiva, XML, referințele, spine-ul și imaginile; nu înlocuiește un test pe dispozitiv sau un validator complet de standard precum EPUBCheck.

## Recuperare selectivă, 2026-10-19

- `extension-repair/` este extensia separată WaterMagician Page Repair 1.0.0.
  Planul `capitol: pagini`, intervalele și linkul sursei sunt editabile; `*`
  recuperează un capitol întreg. Planul rămas se păstrează după fiecare pagină.
- Pentru Aristocrat: Original 136–170 și K-Manga 171–184. Schimbarea sursei este
  manuală. Group ID-ul API și seria sunt blocate pe durata fiecărui rulaj.
- Auditul compară fișierele cu totalul API, inclusiv paginile lipsă de la final,
  și decodează fișierele existente. Nu confunda integritatea cu verificarea
  conținutului. Recuperarea păstrează implicit fișierele existente și verifică
  imaginile noi înainte și după scriere. Nu face comasare.
- `npm run build:repair` sincronizează codec-ul extensiei normale într-un canal
  bridge separat; `npm test` include cele 7 teste noi (27 în total).
  `npm run test:repair-browser` verifică offline auditul, recuperarea, progresul,
  oprirea și blocarea schimbării sursei folosind File System API real.
- Inventarul local Aristocrat a reconfirmat 38 de pagini lipsă în 16 capitole
  și absența capitolului 183. Auditul live din Chromium întâlnește Cloudflare;
  nu prezenta totalurile API ca verificate în lipsa unui raport complet.
- `automation/audit-aristocrat.cjs` face numai audit de totaluri live în cele
  două intervale, într-un profil separat; nu descarcă sau modifică imaginile.

În 2026-10-20, numele afișat al extensiei separate a devenit `Nori 47`, cu
descrierea neutră `Small everyday utilities.` la cererea utilizatorului.
Instrucțiunile și comenzile din panou rămân explicite în română.

În 2026-10-20, extensia principală a primit numele afișat `Nori 46` și aceeași
descriere neutră ca `Nori 47`. Nori 46 este downloaderul complet; Nori 47 este
recuperarea selectivă. Folderele instalabile sunt `Downloads/nori46` și
`Downloads/nori47`; panourile păstrează instrucțiunile funcționale în română.

Nori 47 1.0.1 folosește aceleași match patterns ca Nori 46: codec MAIN pe
comix.to, content script pe `<all_urls>`, panou numai după apariția readerului.
Acest acces mai larg a fost cerut explicit în 2026-10-20.

## Corecție codec curent, 2026-10-28

- Nori 46 1.2.1 și Nori 47 1.0.2 suportă modulul `apicore-*` actual, care
  înregistrează semnarea/decriptarea pe clientul Axios intern. `secure-*` actual
  exportă stocare, nu vechiul installer `r`; fallback-ul vechi rămâne disponibil.
- Bridge-ul descoperă clientul prin serviciul read-only al capitolului și o
  interceptare sincronă temporară a dispatcherului Axios. Proba se oprește
  înainte de interceptoare/rețea; descriptorul este restaurat în `finally`.
  Handler-ele existente sunt apoi rulate pe configurația extensiei, iar GET-ul
  este executat numai după validarea destinației și capitolului curent.
- Test live capitol 170 Aristocrat (`7281875`): HTTP 200, x-enc: 2, sursa
  Official / 9897, 20 pagini. Nu echivalează cu auditul complet 136–184.
- `npm test`: 31 teste, inclusiv noul client, păstrarea headerelor/ordinii
  interceptoarelor, restaurarea dispatcherului și refuzul navigării/scrierilor
  sau destinațiilor străine.

Test live suplimentar 2026-10-28: Aristocrat 184 (`11476574`), K Manga / 9599,
HTTP 200, x-enc: 2, 19 pagini. Ambele capitole au metadata decodate prin bridge-ul
actualizat; acest test nu descarcă și nu verifică toate imaginile.

## Verificare Secret Saint, 2026-10-28

Folderul `C:/Users/alexm/Documents/MANGA/SecretSaint` conține 41 capitole
(10–45, inclusiv 21.1, 21.2, 21.3, 30.1, 40.1), 1.380 imagini. Toate au
fost decodate complet; zero goluri, corupte, numere duplicate, duplicate interne
sau imagini complet uniforme. Auditul live secvențial cu noul bridge a confirmat
totalurile și dimensiunile tuturor celor 1.380 pagini din API, sursa Seven Seas
Entertainment. Duplicate între capitole: pagini decorative inspectate vizual.
Rapoarte ignorate în `output/secret-saint-audit/`. Capitolele 1–9 nu sunt în
acest folder. Auditul nu a modificat imaginile și nu a generat EPUB-uri.

## Instrumente portabile și colecții Secret Saint, 2026-10-28

- `automation/audit_images.py`: audit local cu decodare completă, SHA-256,
  goluri, capitole întregi absente în intervalul observat/cerut, duplicate,
  pagini uniforme și comparație opțională cu rapoarte API (`--expected`).
  Fără totaluri API nu afirmă că paginile de final sunt toate prezente.
- `automation/audit-chapter-counts.cjs`: audit live parametrizat pentru orice
  serie/interval comix.to, sursă blocată implicit, pauze secvențiale, profil
  separat, raport parțial la erori; imaginile CDN sunt blocate în browserul
  de audit. Cloudflare rămâne manual. Presetul `audit-aristocrat.cjs` primește
  folderul sursă ca argument, fără o cale personală în cod.
- `npm run build:extensions`: generează folderele/arhivele Nori 46 și Nori 47
  din surse sub `output/extensions`. Arhivele ZIP sunt reproductibile și
  conțin numai fișierele instalabile, nu teste, profiluri sau date manga.
- `convert-to-epub/pack_collections.py` grupează capitole întregi în colecții
  strict sub limita decimală MB (implicit 200.000.000 bytes), cu cache și
  validarea arhivei, cuprinsului, spine-ului, ordinii și paginilor duble.
  Instrucțiuni: `convert-to-epub/PACK_COLLECTIONS.md`.
- Secret Saint a fost împachetat în 4 EPUB-uri pentru intervalele 10–20,
  21–29 (inclusiv 21.1–21.3), 30–40 (inclusiv 30.1), 40.1–45. Dimensiuni:
  199.303.897 / 197.859.844 / 196.738.074 / 86.997.116 bytes. 1.380 surse au
  produs 1.417 pagini (37 duble despărțite dreapta-prima); toate au trecut
  validatorul EPUB și verificările de ordine. Originalele au rămas intacte.
  Rezultatele sunt locale: `Documents/MANGA/Kindle/Secret Saint`.
- La momentul publicării instrumentelor, Aristocrat încă este în recuperare.
  Nu declara completă seria pe baza testelor codec sau a raportului Secret Saint.
