Nori 46 (WaterMagician Downloader) 1.2.1

Instalare și actualizare
-----------------------
În Chrome: chrome://extensions -> Developer mode -> Load unpacked -> selectează
acest folder. După actualizare apasă Reload la Nori 46 și reîmprospătează tabul
capitolului. Dezactivează copiile vechi și nu porni simultan Nori 46 și Nori 47.

Completează De la cap., Până la cap. sau Doar cap., verifică paginile de sărit,
apoi Start. Alege folderul seriei; capitolele se salvează în subfoldere numerice.
Debifează omiterea capitolelor .5 pentru a include toate fracționarele.

Pe comix.to, tokenul _ și decodarea x-enc: 2 sunt preluate din modulul curent
al site-ului. Integrarea suportă apicore-* din 2026-10-28 și vechiul installer
secure-*. Nu folosește un timestamp drept token și nu hardcodează constantele
actuale de criptare. Codec-ul vechi rămâne doar pentru compatibilitate/teste.

Bridge-ul MAIN acceptă mesaje de la aceeași fereastră și origine, numai pentru
capitolul deschis. Clientul apicore este identificat printr-o probă sincronă,
oprită înainte de rețea; dispatcherul este restaurat imediat. Handler-ele de
semnare și răspuns existente sunt reutilizate. Destinația GET-ului este validată
înaintea cererii, iar schimbarea capitolului în timpul operației o oprește.

Imaginile se cer cu referrerPolicy: no-referrer și păstrează formatul real.
Când site-ul procesează pagina pe canvas, este preferat rezultatul randat.
Există fallback DOM/canvas când API-ul nu poate fi folosit. Erorile HTTP/HTML
nu sunt salvate ca imagini; paginile lipsă sunt raportate.

Extensia funcționează direct în Chrome. Node.js este necesar numai pentru
uneltele de dezvoltare, teste și automatizare. Numele/descripția neutră nu
schimbă permisiunile: scriptul content are acces general și panoul apare numai
când găsește readerul compatibil; codec-ul MAIN este limitat la comix.to.

Verificare
----------
Din rădăcina repository-ului:
  npm test
  npm run test:repair-browser

Testele folosesc mockuri sau un reader local simulat. Dovezile live sunt
separate: 2026-10-12, Tokyo Ghoul:re 1, 48/48 imagini; 2026-10-28, Aristocrat
170/184, metadata 20/19 pagini; Secret Saint 10-45, toate totalurile și
dimensiunile celor 1.380 imagini locale corespund API-ului. Aceste verificări
nu garantează că interfața site-ului nu se va schimba din nou.

Pentru recuperarea selectivă și verificarea paginilor lipsă de la final,
folosește Nori 47 (extension-repair). Pentru documentația și uneltele complete,
vezi README.md și AGENTS.md din repository.
