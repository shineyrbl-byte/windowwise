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
12. **7 languages:** English, हिन्दी, मराठी, বাংলা, தமிழ், తెలుగు and ಕನ್ನಡ, including reasons, notifications and dates.
13. **Tonight:** one answer before bed, for example "Sleep with the window open from 22:00 to 06:00".
14. **7-day outlook:** temperature range, worst AQI, rain and wind, open hours and the best night window for each day.
15. **Wind, clouds and rain:** closes for strong gusts; cloud cover reduces sun heating in the room model.
16. **Cross-ventilation and curtains:** windows on two sides air the room faster; a curtain tip says when to block the sun (only when the room is warm).
17. **Damp/monsoon mode:** opens when outside air is drier, to dry out a damp room, and closes when it's humid.
18. **Cold days:** when it's too cold to open, the app suggests the warmest hour to air out for a few minutes.
19. **AC savings:** hours of AC the plan avoids, with kWh, money (your electricity price) and CO₂.
20. **Saved places:** home, hostel and more, each with its own room settings.
21. **Room log and Bluetooth:** a chart of your thermometer readings against outdoor temperature, and reading from Bluetooth thermometers that use the standard Environmental Sensing service.
22. **Installable and offline:** app icons, an install button, and the last forecast saved for offline use.
23. **Accessibility:** high contrast, larger text, read-aloud and a simple view with just the answer.
24. **Embeddable widget:** one line of code puts a live WindowWise card on a hostel or college website.
25. **Smart-home webhook:** call IFTTT, Home Assistant or similar when it's time to open or close.
26. **Push reminders when the app is closed:** a small server checks every 10 minutes and sends a web push when it's time to open or close.
27. **Telegram reminders:** link the app to the WindowWise Telegram bot with one tap and get the same reminders as messages. Send `/stop` to turn them off.
28. **Live hostel plan:** a warden publishes a plan once; everyone who opens the link follows it, and changes reach them automatically.
29. **Community rooms:** share your calibrated room model anonymously (location rounded to about 10 km). New users nearby start from the median of at least 3 rooms instead of a guess.
30. **Ground-station air quality:** the current AQI comes from the nearest government sensor (CPCB in India, AirNow in the US and others, via OpenAQ) when a fresh reading exists.

## How it decides

Each hour is checked in this order:

| Check | Window |
| --- | --- |
| Rain chance ≥ 60% | Closed |
| Wind gusts ≥ 50 km/h | Closed |
| US AQI above your limit (100, or 50 if sensitive) | Closed |
| Pollen is high and you have a pollen allergy | Closed |
| Damp mode: outside humidity ≥ 85% / ≤ 65% | Closed / **Open** to dry the room |
| Outside is colder than your comfort range | Closed |
| Outside is at least 1°C cooler than the room | **Open** (unless it's above your comfort range *and* ≥ 90% humid) |
| Outside is at least 1°C hotter than the room | Closed |
| About the same | **Open**, for fresh air |

The room temperature is simulated hour by hour:

```
room(next hour) = room + k × (outside − room) + sun
```

`k` is 0.5 with the window open (0.75 with cross-ventilation, plus 0.15 with a fan) and 0.08 with it closed. `sun` is the heat a closed room gains from direct sun in that hour. It depends on when your window gets sun, drops by up to 70% under full cloud, and halves with curtains closed.

AC savings count the hours the room would be above your comfort limit with the window shut, minus the hours it still is with the plan, times your AC's power use (1.2 kWh per hour by default) and electricity price. CO₂ uses India's grid average of 0.71 kg per kWh. The same model runs for "window always shut", which gives the comparison in the chart.

### Calibration

Each thermometer reading records the time, the temperature, and whether the window was mostly open or closed since the previous reading. For each pair of readings 1–12 hours apart, WindowWise replays the model through the real outdoor temperatures for those hours (it fetches yesterday's weather too). A grid search then picks the closed-room leak rate, sun strength and open-window airing speed that best match the readings. It needs at least two gaps per window state, because one gap can't tell sun heating apart from heat leaking in. A small pull toward typical values stops a few noisy readings from producing an extreme room.

## Reminders: how they work

There are three channels, and they back each other up:

1. **In the app:** the browser schedules notifications while WindowWise is open or installed. This needs no server.
2. **Web push:** a Cloudflare Worker runs every 10 minutes, fetches the forecast for each subscribed place, runs the same decision engine as the app (`src/engine.js` is shared) and sends a push a few minutes before each change. The push carries no data; the service worker fetches the message text from the server, so no payload encryption is needed. Each reminder is sent only once.
3. **Telegram:** the same server sends the reminder as a Telegram message, in your language.

If the server is down or unreachable, the app keeps working with in-app reminders, the modelled AQI and local settings.

## Screenshots

_Add screenshots of the main screen, the hour strip and the chart here._

## Tech

- Plain JavaScript, HTML and CSS, built with [Vite](https://vitejs.dev/), with no frameworks
- [Open-Meteo](https://open-meteo.com/) Forecast, Air Quality (including pollen) and Geocoding APIs (free, no API key)
- Hand-drawn inline SVG chart
- Notifications API, a service worker (offline cache) and a web app manifest (installable)
- Web Share API, Clipboard API and print styles for hostel mode; an iframe widget
- Web Bluetooth (Environmental Sensing service) and the Web Speech API
- Languages load on demand with dynamic imports
- 75 [Vitest](https://vitest.dev/) unit tests: decision rules, room model, calibration, summaries, data merging, reminders, webhooks, share links, the server (push signing, validation, sensor selection, reminder timing), and a check that every language has every string
- GitHub Actions runs the tests, builds and deploys to GitHub Pages on every push
- Server: a [Cloudflare Worker](https://workers.cloudflare.com/) with a [D1](https://developers.cloudflare.com/d1/) (SQLite) database and a 10-minute cron trigger
- Web Push with VAPID keys signed using WebCrypto (no libraries)
- [Telegram Bot API](https://core.telegram.org/bots/api) and [OpenAQ v3](https://docs.openaq.org/) for ground-station PM2.5

```
src/engine.js     decision rules, room model, summaries (tonight, week, AC savings...)
src/calibrate.js  fitting the room model to thermometer readings
src/data.js       Open-Meteo fetching and hourly merge
src/notify.js     reminder scheduling and notifications
src/webhook.js    smart-home webhook
src/share.js      hostel share links
src/i18n.js       English text and language loading
src/locales/      Hindi, Marathi, Bengali, Tamil, Telugu, Kannada
src/format.js     shared text helpers
src/chart.js      SVG charts
src/main.js       interface
src/embed.js      embeddable widget (embed.html)
src/api.js        server client (falls back quietly when offline)
public/sw.js      service worker: notifications, push and offline cache
worker/           Cloudflare Worker: plans, community, push, Telegram, sensors, cron reminders
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

No API keys or accounts are needed for the app. The server features are optional.

### Server (optional)

```bash
cd windowwise
npx wrangler login
npx wrangler d1 create windowwise          # put the id in worker/wrangler.toml
npx wrangler d1 execute windowwise --remote --file worker/schema.sql --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

Secrets, each set with `npx wrangler secret put NAME --config worker/wrangler.toml`. Every feature switches off cleanly when its secret is missing:

- `VAPID_PRIVATE_JWK`: private key for web push (put the public key in `VAPID_PUBLIC` in wrangler.toml)
- `TELEGRAM_TOKEN`: from @BotFather
- `OPENAQ_KEY`: from explore.openaq.org

Then set `API_BASE` in `src/api.js` to your Worker URL.

## Limitations

- **The room temperature is an estimate.** Setting when your window gets sun and logging a few thermometer readings makes it much closer to your room, but it is still a model.
- **Push can be blocked.** School- or work-managed browsers and some campus networks block the push service, so pushes never arrive. In-app reminders and Telegram still work there. On iPhone, push only works after adding WindowWise to the home screen (iOS 16.4 or newer).
- **Free-plan limits:** each 10-minute server run fetches forecasts for at most 15 places, so reminders could be late if many cities have subscribers.
- **Ground stations** only cover the current hour, and only where a station within 25 km reported in the last 3 hours. Forecast hours still use modelled data.
- **Forecast AQI is modelled data** from Open-Meteo (CAMS), not a sensor on your street. It can differ from local readings.
- **US AQI is a 24-hour average,** so it changes slowly. The least-polluted-hour tip uses hourly PM2.5 for this reason.
- **Pollen data covers Europe only.** Elsewhere the pollen setting has no effect, and the app says so.
- **Translations** were written with AI help and should be reviewed by native speakers.
- **Bluetooth** only works with thermometers that use the standard Environmental Sensing service, in Chrome or Edge (not iPhone or Firefox). I couldn't test it with real hardware.
- **AC savings are rough:** they assume a typical 1.5-ton AC; set your own power use and price in settings.
- **The smart-home webhook** fires from the device, so the app must be open or installed.
- **Air-quality forecasts** run about 5 days ahead, so the last days of the outlook show no AQI.
- WindowWise is a guide, not medical advice. On bad-air days, follow local health guidance.

## What I learned

- Combining weather and air-quality data into one decision is harder than showing them side by side, because the rules conflict (cool but polluted, hot but clean). The order of the checks matters.
- US AQI is a rolling 24-hour average, so it can't tell you the best *hour*. Hourly PM2.5 can.
- A simple room model that is easy to explain is more useful in a demo than an accurate model nobody can follow.

## Not built (and why)

- **WhatsApp reminders** need a verified WhatsApp Business account and paid message templates. Telegram does the same job for free.
- **Other Bluetooth sensors:** many cheap thermometers use their own private formats instead of the standard one.

## Credits

- Ground-station air quality: [OpenAQ](https://openaq.org/) (data from CPCB, AirNow and other agencies)
- Weather, air quality and geocoding data: [Open-Meteo](https://open-meteo.com/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Build tools: Vite and Vitest (MIT)
- AI assistance: Claude (Anthropic) via Claude Code helped write code, tests and documentation.

## License

[MIT](LICENSE)
