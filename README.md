# VR Sandbox

Symulatory WebXR do testowania na Meta Quest 3 / 3S. Wszystko działa w przeglądarce gogli — nic nie trzeba instalować.

## Symulatory

| Symulator | Opis |
|---|---|
| [⚡ Kula Energii](sims/energy-ball/) | Złącz dłonie → rośnie kula energii. Pchnij dłonie do przodu → wystrzał. Tryb VR (płaskowyż o zmierzchu) albo passthrough (AR w Twoim pokoju). |

## Jak uruchomić na Quest

1. Strona musi być pod adresem **https** (WebXR nie działa przez zwykłe http). Najprościej: GitHub Pages.
2. Na Queście: Ustawienia → Ruch / Śledzenie dłoni → włączone.
3. Otwórz adres w przeglądarce Meta Quest, wybierz symulator, kliknij **Wejdź w VR** lub **Passthrough (AR)**.
4. Odłóż kontrolery — gogle przełączą się na dłonie. (Kontrolery też działają: złącz je razem i pchnij do przodu.)

## Podgląd na komputerze

Otwórz stronę w Chrome: przytrzymaj **Spację**, żeby ładować, puść — strzał. Przeciągnij myszą, żeby się rozejrzeć.

Lokalnie: `python3 -m http.server 8000` i wejdź na `http://localhost:8000`.

## Strojenie gestu

Progi (odległość dłoni, prędkość pchnięcia, czas ładowania) są na górze pliku `sims/energy-ball/main.js` w obiekcie `CFG`.
