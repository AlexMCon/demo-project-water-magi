# Nori 47 — instrucțiuni de recuperare

Extensie Chrome separată: încarcă folderul `extension-repair` din
`chrome://extensions` → Developer mode → Load unpacked. Oprește downloaderul
normal în timpul recuperării. Canalele celor două extensii sunt distincte.

## Aristocrat: două rulaje

1. Alege **Original 136–170**, apoi **Deschide sursa**. Se deschide linkul
   capitolului 170 furnizat de tine; verifică ediția în reader.
2. Apasă **Verifică toate paginile** și alege folderul seriei
   `C:\Users\alexm\Documents\MANGA\aristocrat` (nu folderul unui capitol).
   Auditul merge de la 170 la 136. Compară totalul API cu numerele fișierelor,
   inclusiv paginile de final, și decodează imaginile locale. Nu descarcă imagini.
3. Verifică planul rezultat și apasă **Recuperează selecția**. Poți porni din
   capitolul 136 unde a rămas auditul. Se recuperează doar țintele din 136–170.
4. Alege **K-Manga 171–184**, apoi **Deschide sursa**. Se deschide capitolul 184.
   Verifică manual ediția și repetă auditul și recuperarea. Planul conține deja
   paginile cerute pentru 177, 178, 181 și `183: *` (capitolul lipsă complet).
5. Repetă auditul după recuperare, pornind de la un capăt al intervalului.

Sursa API este blocată la începutul rulajului. Dacă grupul sau seria se schimbă,
extensia se oprește înainte de a descărca din acea sursă. La capătul intervalului
se oprește; schimbi manual sursa și pornești următorul rulaj. Dacă readerul sare
un capitol întreg, auditul îl declară neverificat, nu complet.

## Reutilizare și plan editabil

```text
136: 7
141: 11, 13
145: 6-7, 16-17
183: *
170.5: 1, 3
```

O linie per capitol sau separator `;`. `*` înseamnă toate paginile din API.
Fișierele existente sunt păstrate implicit după verificarea decodării și a
dimensiunilor. Bifează înlocuirea numai pentru a înlocui explicit paginile
selectate. Dacă formatul local diferă de cel nou, operația se oprește, fără
ștergerea fișierului vechi sau crearea unei alternative cu același număr.

Pentru alte serii: **Personalizat**, interval și plan propriu, apoi
**Folosește pagina curentă**. Auditul întregului interval trebuie pornit de la
unul dintre capete. Capitolele fracționare nu sunt omise.

Pauze implicite: 3 secunde între cererile de imagini, 5 secunde între capitole.
Cererile sunt secvențiale. Imaginile se cer fără Referer. Pentru paginile
procesate de site pe canvas se păstrează canvas-ul. Imaginile recuperate se
decodează, se compară cu dimensiunile API, apoi se salvează și se recitesc.

Planul rămas este salvat după fiecare pagină. La reîncărcare completă, eroare
sau Cloudflare, reia manual din pagina potrivită și alege același folder.
**Oprește** păstrează planul rămas. Extensia nu ocolește Cloudflare.

Rapoartele sunt în `_wm-repair` sub folderul ales: sursă, capitol, URL, total
API, lipsuri, fișiere invalide și hashurile imaginilor recuperate.
`complete: true` indică terminarea rulajului; verifică și listele `missing` și
`invalid`. Decodarea/dimensiunile nu dovedesc singure corectitudinea conținutului.

## Dezvoltare

```bash
npm run build:repair
npm test
npm run test:repair-browser
```

Generatorul sincronizează codec-ul din extensia normală, folosind un canal
bridge distinct. Testul browser folosește un reader/API simulat și File System
API real. Nu este dovadă de verificare live a surselor comix.to.

## Acces la site-uri (1.0.1)

Nori 47 folosește acum același acces general ca Nori 46. Panoul apare numai
când pagina conține readerul compatibil, inclusiv dacă acesta se încarcă mai
târziu. Bridge-ul MAIN rămâne limitat la comix.to; tokenul, validarea originii
și blocarea sursei nu se schimbă.

## Compatibilitate 1.0.2

Suport pentru modulul apicore al site-ului din 2026-10-28. Dacă apare eroarea
„interfata modulului site-ului s-a schimbat”, actualizează folderul extensiei,
apasă Reload în chrome://extensions, apoi reîmprospătează complet readerul.
Tokenul și decodarea sunt în continuare preluate din modulul curent al site-ului.
