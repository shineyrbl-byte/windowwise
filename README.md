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
7. **Window sun and fan:** tell it when your window gets direct sun (morning, afternoon, all day or shaded) and whether a fan is running. Sun timing changes when a closed room heats up. A fan speeds up cooling and shows how much cooler the room feels.
8. **Reminders:** turn on notifications and WindowWise tells you when it's time to open or close the window. The forecast refreshes every 30 minutes.
9. **Calibrate to your room:** log a few thermometer readings and WindowWise tunes its room model to how your room actually behaves.
10. **Pollen alerts:** with the pollen allergy setting on, the window stays shut during high-pollen hours (where pollen data exists: Europe).
11. **Hostel mode:** share the plan by link with everyone on your floor, or print a notice for the noticeboard.
12. **हिन्दी:** the whole interface, including reasons and notifications, is available in Hindi.

## How it decides

Each hour is checked in this order:

| Check | Window |
| --- | --- |
| Rain chance ≥ 60% | Closed |
| US AQI above your limit (100, or 50 if sensitive) | Closed |
| Pollen is high and you have a pollen allergy | Closed |
| Outside is colder than your comfort range | Closed |
| Outside is at least 1°C cooler than the room | **Open** (unless it's above your comfort range *and* ≥ 90% humid) |
| Outside is at least 1°C hotter than the room | Closed |
| About the same | **Open**, for fresh air |

The room temperature is simulated hour by hour:

```
room(next hour) = room + k × (outside − room) + sun
```

`k` is 0.5 with the window open (0.65 with a fan) and 0.08 with it closed. `sun` is the heat a closed room gains from direct sun in that hour, and depends on when your window gets sun. The same model runs for "window always shut", which gives the comparison in the chart.

### Calibration

Each thermometer reading records the time, the temperature, and whether the window was mostly open or closed since the previous reading. For each pair of readings 1–12 hours apart, WindowWise replays the model through the real outdoor temperatures for those hours (it fetches yesterday's weather too). A grid search then picks the closed-room leak rate, sun strength and open-window airing speed that best match the readings. It needs at least two gaps per window state, because one gap can't tell sun heating apart from heat leaking in. A small pull toward typical values stops a few noisy readings from producing an extreme room.

## Reminders: how they work

GitHub Pages can't run a server, so WindowWise schedules notifications in the browser. A service worker shows them (this is required on Android) and opens the app when one is tapped. Reminders arrive while WindowWise is open in a tab, even in the background, or installed as an app. They can't arrive while it's fully closed (see Limitations).

## Screenshots

_Add screenshots of the main screen, the hour strip and the chart here._

## Tech

- Plain JavaScript, HTML and CSS, built with [Vite](https://vitejs.dev/), with no frameworks
- [Open-Meteo](https://open-meteo.com/) Forecast, Air Quality (including pollen) and Geocoding APIs (free, no API key)
- Hand-drawn inline SVG chart
- Notifications API, a service worker and a web app manifest (installable)
- Web Share API and print styles for hostel mode
- 45 [Vitest](https://vitest.dev/) unit tests: decision rules, room model, calibration, data merging, reminders, share links and translations
- GitHub Actions runs the tests, builds and deploys to GitHub Pages on every push

```
src/engine.js     decision rules, room model, sun/fan, pollen, summary
src/calibrate.js  fitting the room model to thermometer readings
src/data.js       Open-Meteo fetching and hourly merge
src/notify.js     reminder scheduling and notifications
src/share.js      hostel share links
src/i18n.js       English and Hindi text
src/chart.js      SVG temperature chart
src/main.js       interface
public/sw.js      service worker for notifications
test/             unit tests
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

- **The room temperature is an estimate.** Setting when your window gets sun and logging a few thermometer readings makes it much closer to your room, but it is still a model.
- **Reminders need WindowWise open or installed.** Without a server, notifications can't arrive while the app is fully closed. On iPhone, notifications only work after adding WindowWise to the home screen (iOS 16.4 or newer).
- **AQI is modelled data** from Open-Meteo (CAMS), not a sensor on your street. It can differ from local readings.
- **US AQI is a 24-hour average,** so it changes slowly. The least-polluted-hour tip uses hourly PM2.5 for this reason.
- **Pollen data covers Europe only.** Elsewhere the pollen setting has no effect, and the app says so.
- **The Hindi translation** was written with AI help and should be reviewed by a native speaker.
- WindowWise is a guide, not medical advice. On bad-air days, follow local health guidance.

## What I learned

- Combining weather and air-quality data into one decision is harder than showing them side by side, because the rules conflict (cool but polluted, hot but clean). The order of the checks matters.
- US AQI is a rolling 24-hour average, so it can't tell you the best *hour*. Hourly PM2.5 can.
- A simple room model that is easy to explain is more useful in a demo than an accurate model nobody can follow.

## Not built (and why)

- **Notifications when the app is fully closed** need a push server, and GitHub Pages can't run one.
- **Bluetooth room sensors:** cheap sensors don't share a common data format, and Web Bluetooth doesn't work on iPhone or Firefox. Thermometer readings give the same calibration benefit without hardware.
- **Live ground sensors (CPCB, OpenAQ):** these need an API key, and a key can't be kept secret in a site with no server.
- **More regional languages:** the text lives in one dictionary file (`src/i18n.js`), so adding Marathi, Tamil, Kannada or others means translating one file.

## Credits

- Weather, air quality and geocoding data: [Open-Meteo](https://open-meteo.com/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Build tools: Vite and Vitest (MIT)
- AI assistance: Claude (Anthropic) via Claude Code helped write code, tests and documentation.

## License

[MIT](LICENSE)
