# WindowWise

**Know when to open your windows.** WindowWise reads your local forecast and air quality and gives you an hour-by-hour plan that cools your room for free and keeps polluted air out.

**Live demo:** https://shineyrbl-byte.github.io/windowwise/ (no sign-up, no install)

**Demo video (3 min):** https://youtu.be/Bh7E0GbJn2U

Built for **LaunchPad Hacks** (October 16 – November 20, 2026). All code in this repository was written during the event.

## The problem

Millions of students live in hostels, PGs and shared flats without air conditioning. Opening the windows at the right time is the cheapest way to cool a room. At the wrong time, it lets in hot afternoon air, rain, or smoke and PM2.5 on high-pollution days.

Weather apps show temperature and AQI on separate screens. None of them answer the simple question: **should my window be open right now, and when should I change that?**

## Who it's for

- Students and renters in rooms without AC
- People with asthma or allergies who need to keep polluted air out
- Anyone who wants a cooler room without paying for electricity

## What it does

1. **Search your city** or use your location.
2. **Get one clear answer for right now:** "Open your window" or "Keep your window closed", with the reason and the time of the next change ("Close it at 08:00: outside is hotter").
3. **See the next 24 hours** as a colour strip and as plain-language blocks, each with its reason.
4. **See the benefit:** a chart compares your room temperature if you follow the plan with keeping the window shut ("your room should peak around 26°C instead of 29°C").
5. **Bad-air days:** when pollution keeps the window shut most of the day, WindowWise picks the least-polluted hour (by hourly PM2.5) to air the room out for 10–15 minutes.
6. **Personalise:** set your current room temperature and comfort range, and turn on a stricter air limit for sensitive lungs (AQI 50 instead of 100).

## How it decides

Each hour is checked in this order:

| Check | Window |
| --- | --- |
| Rain chance ≥ 60% | Closed |
| US AQI above your limit (100, or 50 if sensitive) | Closed |
| Outside is colder than your comfort range | Closed |
| Outside is at least 1°C cooler than the room | **Open** (unless it's above your comfort range *and* ≥ 90% humid) |
| Outside is at least 1°C hotter than the room | Closed |
| About the same | **Open**, for fresh air |

The room temperature is simulated hour by hour with a simple model. An open window pulls the room strongly toward the outdoor temperature. A closed window lets heat in slowly, and the sun adds heat to a closed room during the day. The same model runs for "window always shut", which gives the comparison in the chart.

## Screenshots

_Add screenshots of the main screen, the hour strip and the chart here._

## Tech

- Plain JavaScript, HTML and CSS, built with [Vite](https://vitejs.dev/), with no frameworks
- [Open-Meteo](https://open-meteo.com/) Forecast, Air Quality and Geocoding APIs (free, no API key)
- Hand-drawn inline SVG chart
- [Vitest](https://vitest.dev/) unit tests for the decision engine and data merging
- GitHub Actions runs the tests, builds and deploys to GitHub Pages on every push

```
src/engine.js   decision rules, room model, summary and least-polluted hour
src/data.js     Open-Meteo fetching and hourly merge
src/chart.js    SVG temperature chart
src/main.js     interface
test/           unit tests
```

## Run it locally

Requires Node.js 18 or newer.

```bash
git clone https://github.com/shineyrbl-byte/windowwise.git
cd windowwise
npm install
npm run dev      # open the printed localhost URL
npm test         # run the unit tests
npm run build    # production build in dist/
```

No API keys or accounts are needed.

## Limitations

- **The room temperature is an estimate.** The model doesn't know your room's size, insulation, which way it faces, or whether a fan is running. Entering your current room temperature in settings makes it more accurate.
- **AQI is modelled data** from Open-Meteo (CAMS), not a sensor on your street. It can differ from local readings.
- **US AQI is a 24-hour average,** so it changes slowly. The least-polluted-hour tip uses hourly PM2.5 for this reason.
- Pollen isn't included, because Open-Meteo only provides it for Europe.
- WindowWise is a guide, not medical advice. On bad-air days, follow local health guidance.

## What I learned

- Combining weather and air-quality data into one decision is harder than showing them side by side, because the rules conflict (cool but polluted, hot but clean). The order of the checks matters.
- US AQI is a rolling 24-hour average, so it can't tell you the best *hour*. Hourly PM2.5 can.
- A simple room model that is easy to explain is more useful in a demo than an accurate model nobody can follow.

## Credits

- Weather, air quality and geocoding data: [Open-Meteo](https://open-meteo.com/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Build tools: Vite and Vitest (MIT)
- AI assistance: Claude (Anthropic) via Claude Code helped write code, tests and documentation.

## License

[MIT](LICENSE)
