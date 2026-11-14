# VR Sandbox

Symulatory WebXR do testowania na Meta Quest 3 / 3S. Wszystko działa w przeglądarce gogli — nic nie trzeba instalować.

## Symulatory

| Symulator | Opis |
|---|---|
| [⚡ Kula Energii](sims/energy-ball/) | Pustynna arena: kula energii z dłoni, aura mocy, wielka kula nad głową, latanie i kratery w ziemi. Tryb VR albo passthrough (AR). |

## Jak uruchomić na Quest

1. Strona musi być pod adresem **https** (WebXR nie działa przez zwykłe http). Najprościej: GitHub Pages.
2. Na Queście: Ustawienia → Ruch / Śledzenie dłoni → włączone.
3. Otwórz adres w przeglądarce Meta Quest, wybierz symulator, kliknij **Wejdź w VR** lub **Passthrough (AR)**.
4. Odłóż kontrolery — gogle przełączą się na dłonie. (Kontrolery też działają: złącz je razem i pchnij do przodu.)

## Sterowanie (Kula Energii)

| Ruch | Efekt |
|---|---|
| Dłonie razem, potem mocne pchnięcie do przodu | mała kula + promień |
| Ręce w dół + zaciśnięte pięści (kontrolery: oba przyciski chwytu) | aura mocy — szybsze ładowanie, większe kule, szybszy lot |
| Obie ręce nad głową, potem zamach do przodu | wielka kula nad głową, rzut |
| Oba spusty (albo szczypnięcie kciuk+palec obiema dłońmi) | lot w kierunku, w który celujesz |
| Prawa gałka w bok / przycisk B lub Y | obrót o 30° / powrót na środek |

## Podgląd na komputerze

`Spacja` mała kula, `E` wielka kula, `Q` aura, `F` lot, `R` powrót. Przeciągnij myszą, żeby się rozejrzeć.

Lokalnie: `python3 -m http.server 8000` i wejdź na `http://localhost:8000`.

## Strojenie gestu

Progi (odległość dłoni, prędkość pchnięcia, czas ładowania) są na górze pliku `sims/energy-ball/main.js` w obiekcie `CFG`.
