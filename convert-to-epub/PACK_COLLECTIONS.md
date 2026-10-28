# Colecții EPUB cu limită de dimensiune

`pack_collections.py` grupează capitole consecutive în EPUB-uri fixed-layout,
fără să taie un capitol între fișiere și fără să depășească limita indicată.
Folosește aceeași conversie ca `convert_to_epub.py`: 1236×1648, JPEG 85, tonuri
de gri, fără upscaling, RTL și despărțirea paginilor landscape cu dreapta prima.
Include câte o intrare în cuprins pentru fiecare capitol, inclusiv fracționare.

```bash
python -m pip install -r convert-to-epub/requirements.txt
python convert-to-epub/pack_collections.py "./downloads" "./output/collections" "Numele seriei" --max-mb 200 --cache "./output/collection-cache"
```

`200 MB` înseamnă strict **200.000.000 bytes**, nu 200 MiB. Dimensiunea reală a
arhivei este măsurată, cu tot cu XML și structura ZIP; colecția primește cât mai
multe capitole consecutive întregi care încap. Ultima colecție poate fi mai mică.
Un capitol care depășește singur limita produce o eroare. Parametrul nu schimbă
calitatea sau rezoluția pentru a umple artificial un fișier până la limită.

Pentru un interval, cu un raport API/Nori salvat anterior:

```bash
python convert-to-epub/pack_collections.py "./downloads" "./output/collections" "Numele seriei" --from 10 --to 45 --max-mb 200 --audit-report "./output/live-totals.json"
```

Raportul poate avea `chapters` ca listă cu `number` și `expectedPages`, sau ca
obiect cu numărul capitolului drept cheie și `expectedPages` în fiecare intrare.
Totalul API detectează și paginile lipsă de la final. Fără acest raport,
verificarea locală poate confirma numai golurile până la ultimul număr existent;
nu dovedește că au fost descărcate toate paginile de final sau fracționarele.

Folderul sursă trebuie să conțină subfoldere numerice (`1`, `2`, `2.1`, etc.)
sau `chapter-1`/`ch-1`, cu fișiere `001.webp`, `002.png`, etc. Pagini nenumerice,
numere duplicate, goluri de numerotare, capitole goale, capitole întregi lipsă
în interval și imagini corupte opresc operația. Paginile decorative nu sunt
eliminate. Imaginile originale sunt doar citite. Output-ul existent nu este
suprascris: alege un folder de ieșire nou sau mută manual vechile EPUB-uri.

Cache-ul conține numai JPEG-urile pregătite și metadata lor, identificate prin
SHA-256 al originalului, setări și versiunea codului converterului. Gruparea și
măsurarea folosesc acești bytes, fără re-encoding repetat. `--workers 4` este
implicit și accelerează pregătirea; poți seta 1–32. Păstrează cache-ul într-un
folder ignorat de Git, precum `output/`.

Fiecare EPUB final trece prin `automation/validate_epub.py`. În plus, scriptul
verifică spine-ul RTL, ordinea numerică a capitolelor, cuprinsul și hashul fiecărui
JPEG din arhivă față de ordinea de conversie. `collections-report.json` păstrează
pentru fiecare pagină capitolul, originalul, SHA-256, jumătatea right/left/whole și
poziția în EPUB. Raportul este rezultat local, nu trebuie publicat în Git.

Testele relevante se rulează astfel:

```bash
python -m unittest discover -s convert-to-epub/tests -p 'test_pack_collections.py' -v
```

Testele verifică limita reală în bytes, păstrarea capitolelor întregi, ordinea
numerică/fracționară, respingerea unei pagini lipsă de final după audit și un
spread sintetic cu jumătăți vizual distincte pentru a demonstra dreapta-prima.
