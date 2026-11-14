# VR Sandbox

Symulatory WebXR do testowania na Meta Quest 3 / 3S. Wszystko działa w przeglądarce gogli — nic nie trzeba instalować.

## Symulatory

| Symulator | Opis |
|---|---|
| [⚡ Kula Energii](sims/energy-ball/) | Pustynny kanion: kule energii z dłoni, fala, wielka kula, aura i formy mocy, latanie, rywal do walki wręcz i na dystans, kratery i wgniecenia w ścianach. |

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
| Oba spusty | lot w kierunku, w który celujesz |
| Prawa gałka w bok / B | obrót o 30° / powrót na start |

**Walka wręcz** — włącza się sama, gdy jesteś blisko rywala. Tylko ręce i nogi, bez kul.

| Przycisk | Efekt |
|---|---|
| Spust (trzymaj, puść) | pięść; mocno naładowana = zamaszysty cios z doskokiem |
| Chwyt (trzymaj, puść) | kopnięcie; mocno naładowane = okrężne |
| Gdzie trzymasz rękę | nad rywalem = cios z góry, pod nim = podbródkowy, z boku = sierpowy |
| X / A (trzymaj) | blok — ręka tam, skąd leci cios (czerwony znacznik); odbija też jego pociski |
| Oba spusty z rękami w górze, puść ruchem w dół | młot — wbija go w ziemię |

Ciosy są animowane: kolejny wychodzi dopiero po skończeniu poprzedniego (jedno wciśnięcie zostaje zapamiętane). Przy trafieniu gra na chwilę zamiera, a rywal reaguje zależnie od kierunku ciosu. Mocny cios wyrzuca go z walki — leci, wbija się w ściany i słupy albo robi krater.

Na samych dłoniach (bez kontrolerów): pięść = chwyt, szczypnięcie = spust.

## Podgląd na komputerze

Lewa ręka: `Q` spust, `A` chwyt, `Z` blok. Prawa: `E`, `D`, `C`. Pozy rąk: `1` razem, `2` w górę, `3` w dół. `Spacja` = fala, `T` = poziom (przytrzymaj = niżej), `R` = powrót, mysz = rozglądanie.

## Strojenie gestu

Progi (odległość dłoni, czasy ładowania, zasięg ciosów, siła form) są na górze pliku `sims/energy-ball/main.js` w obiekcie `CFG`. Kod jest podzielony na moduły: `world.js` (kanion, kratery), `enemy.js` (rywal), `avatar.js` (ciało gracza), `fx.js` (efekty), `audio.js` (dźwięki).
