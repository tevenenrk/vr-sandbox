# VR Sandbox

Symulatory WebXR do testowania na Meta Quest 3 / 3S. Wszystko działa w przeglądarce gogli — nic nie trzeba instalować.

## Symulatory

| Symulator | Opis |
|---|---|
| [🪐 Mała Planeta](sims/energy-ball/?mode=planet) | Ta sama postać i sterowanie nad miniaturową planetą: miasteczka, ludzie, oceany, statki na orbicie. Aura przy ziemi kruszy grunt i podnosi głazy, fala robi wielkie kratery, w pełni naładowana wielka kula rozsadza całą planetę (po chwili powstaje nowa). |
| [⚡ Kula Energii](sims/energy-ball/) | Pustynny kanion (ok. 700 m, ściany ~100 m): kule energii z dłoni, fala, wielka kula, aura i formy mocy, latanie, rywal do walki wręcz i na dystans, kratery i wgniecenia w ścianach. |

## Jak uruchomić na Quest

1. Strona musi być pod adresem **https** (WebXR nie działa przez zwykłe http). Najprościej: GitHub Pages.
2. Na Queście: Ustawienia → Ruch / Śledzenie dłoni → włączone.
3. Otwórz adres w przeglądarce Meta Quest, wybierz symulator, kliknij **Wejdź w VR** lub **Passthrough (AR)**.
4. Odłóż kontrolery — gogle przełączą się na dłonie. (Kontrolery też działają: złącz je razem i pchnij do przodu.)

## Sterowanie (Kula Energii, kontrolery)

**Paski:** życie, stamina (zużywają ją ciosy, kule i lot; odnawia się po chwili spokoju), KI (ładuje je tylko aura).

**Poza walką**

| Przycisk / ruch | Efekt |
|---|---|
| Chwyt jednej ręki (trzymaj), puść | kula z tej dłoni |
| Chwyt obu, dłonie blisko siebie, puść | fala energii |
| Chwyt obu, ręce nad głową, puść | wielka kula |
| Chwyt obu, ręce w dół | aura: ładuje KI (dużo szybciej przy małym życiu) i odnawia staminę |
| Y (krótko) | przy pełnym KI — wyższy poziom: mocniejsze ciosy, szybciej spada stamina |
| Y (przytrzymaj) | niższy poziom |
| Oba spusty | lot w kierunku, w który celujesz; dwa szybkie kliknięcia = **turbo** |
| Prawa gałka w bok / B | obrót o 30° / powrót na start |
| Klik lewej gałki / klik prawej gałki | agresja rywala (Bierny → Łatwy → Normalny → Trudny) / muzyka wł./wył. |

**Pojedynek fal:** gdy ładujesz falę i patrzysz na rywala, on też ładuje swoją. Kiedy puścisz — fale zderzają się w jednym punkcie, który przesuwa się w stronę słabszego. O sile decyduje naładowanie fali, poziom mocy, stamina i to, jak szybko klikasz spust (każde kliknięcie kosztuje odrobinę staminy). Kto przegra, obrywa wielkim wybuchem.

**Teleport**

| Ruch | Efekt |
|---|---|
| Prawy kontroler przy czole + SPUST i CHWYT prawej ręki (trzymaj) | celowanie: lewą ręką wskazujesz miejsce, lewa gałka zmienia odległość; widać linię i kółko lądowania |
| Puść prawą rękę | teleport (koszt: 1/4 KI na poziomie 0, mniej na wyższych) |
| Dwa szybkie SPUST+CHWYT prawej, gdy rywal leci po mocnym ciosie | teleport tuż przed niego i automatyczny cios w inną stronę (koszt: 30% KI) |

Zmiana poziomu (twoja albo rywala, który przechodzi na wyższą formę przy mniejszym życiu) to 5-sekundowy przerywnik — kamera z trzeciej osoby krąży wokół przemieniającej się postaci.

**Trening:** przycisk „Trening” na stronie uruchamia samouczek krok po kroku (B = pomiń zadanie).

**Walka wręcz** — włącza się sama, gdy jesteś blisko rywala. Tylko ręce i nogi, bez kul.

| Przycisk | Efekt |
|---|---|
| Spust (trzymaj, puść) | pięść; mocno naładowana = zamaszysty cios z doskokiem |
| Chwyt (trzymaj, puść) | kopnięcie; mocno naładowane = okrężne |
| Gdzie trzymasz rękę | nad rywalem = cios z góry, pod nim = podbródkowy, z boku = sierpowy |
| X / A (trzymaj) | blok — ręka przechodzi w gardę i chroni ćwiartkę ciała, w której jest: nad głową, z lewej, z prawej albo nisko (wtedy też unosisz kolano); odbija też jego pociski |
| Oba spusty z rękami w górze, puść ruchem w dół | młot — wbija go w ziemię |

Ładowany cios świeci na pięści (albo stopie): biało → żółto (średni) → pulsujący pomarańczowy (mocny), z wibracją przy każdym progu. Naładowany mocny cios kogoś z wyższego poziomu przebija blok. Ciosy są animowane: kolejny wychodzi dopiero po skończeniu poprzedniego i gdy rywal wróci do zwarcia (jedno wciśnięcie zostaje zapamiętane). Słaby cios tylko go zachwieje, średni odrzuci na kilka metrów, mocny wyrzuci. Przy trafieniu gra na chwilę zamiera, a rywal reaguje zależnie od kierunku ciosu. Mocny cios wyrzuca go z walki — leci, wbija się w ściany i słupy albo robi krater.

Na samych dłoniach (bez kontrolerów): pięść = chwyt, szczypnięcie = spust.

## Tryb „Mała planeta”

Planeta ma ok. 160 m promienia, ludzie są twojej wielkości. Można wznieść się ok. 70 m nad powierzchnię. Planeta obraca się pod tobą, gdy lecisz — zawsze jesteś „na górze”, więc całe sterowanie działa tak samo jak w kanionie.

- **Aura przy ziemi** (ręce w dół + oba chwyty): pod tobą rośnie krater, wokół unoszą się głazy (spadają, gdy puścisz).
- **Fala energii / kule**: kratery niszczą budynki i drzewa, ludzie w pobliżu uciekają, a trafieni wylatują w powietrze.
- **Statki na orbicie**: kule same lekko naprowadzają się na statek w stożku ok. 20°; zestrzelony statek spada i robi krater.
- **W pełni naładowana wielka kula** (ręce w górę, aż kula przestanie rosnąć): planeta pęka, wybucha i rozpada się na odłamki; po ok. 17 s powstaje nowa.

Trening i gra we dwoje są dostępne w trybie kanionu.

## Gra we dwoje

Na stronie symulatora wpiszcie na obu goglach ten sam **kod pokoju**, kliknijcie „Połącz”, a potem „Wejdź w VR”. Pierwsza osoba zostaje gospodarzem, druga dołącza (startuje 90 m dalej, twarzą do pierwszej). Połączenie idzie bezpośrednio między przeglądarkami (WebRTC przez darmowy serwer pośredniczący PeerJS), więc oba urządzenia muszą mieć internet. Działa na każdych goglach z przeglądarką WebXR (Quest, Pico, PC VR). Rywal na ekranie to wtedy druga osoba: ciosy, kule, fale, pojedynek fal, teleporty, przemiany i kratery są wspólne.

## Postać

Domyślna postać (`sims/energy-ball/models/fighter.glb`) to rywal w oryginalnych kolorach, a twoje ręce i ciało są z tego samego modelu w przebarwionym stroju.

## Własny model rywala

Na stronie symulatora jest przycisk **Własny model rywala (.glb)**. Model musi mieć szkielet Mixamo (kości `mixamorig:Hips`, `LeftArm`, `LeftForeArm`, `LeftHand`, `LeftUpLeg`, `LeftLeg`, `LeftFoot` itd. — tak eksportuje mixamo.com i Meshy). Gra skaluje go do ~1,8 m i sama steruje jego kośćmi (ciosy, garda, reakcje na trafienia, lot), więc animacje z pliku nie są potrzebne. Wybrany plik zostaje zapamiętany w przeglądarce; przycisk **Domyślny** go usuwa. Można też położyć plik jako `sims/energy-ball/models/rival.glb`.

## Podgląd na komputerze

Lewa ręka: `Q` spust, `A` chwyt, `Z` blok. Prawa: `E`, `D`, `C`. Pozy rąk: `1` razem, `2` w górę, `3` w dół. `Spacja` = fala, `T` = poziom (przytrzymaj = niżej), `Shift` + `Q`+`E` = turbo, `V` (trzymaj, kółko myszy) = teleport, `X` 2× = teleport za rywalem, `N` = pomiń krok treningu, `G` = agresja, `M` = muzyka, `R` = powrót, mysz = rozglądanie.

## Strojenie gestu

Progi (odległość dłoni, czasy ładowania, zasięg ciosów, siła form) są na górze pliku `sims/energy-ball/main.js` w obiekcie `CFG`. Kod jest podzielony na moduły: `world.js` (kanion, kratery), `enemy.js` (rywal), `avatar.js` (ciało gracza), `fx.js` (efekty), `audio.js` (dźwięki).
