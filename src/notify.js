// Browser reminders: a system notification when it's time to open or close
// the window. There is no server, so reminders fire while WindowWise is open
// in a tab (it can be in the background) or installed as an app.

// The hours where the plan flips between open and closed.
export function upcomingChanges(plan) {
  const out = [];
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].open !== plan[i - 1].open) {
      out.push({ time: plan[i].time, open: plan[i].open, text: plan[i].text, reason: plan[i].reason, hour: plan[i] });
    }
  }
  return out;
}

// "2026-11-09T14:00" is local to the place; turn it into a real timestamp
// using the place's UTC offset, so it works whatever timezone the device is in.
export function toEpoch(localTime, utcOffsetSeconds) {
  const [d, t] = localTime.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, day, h, min || 0) - utcOffsetSeconds * 1000;
}

export function message(change) {
  return {
    title: change.open ? 'Open your window now' : 'Time to close your window',
    body: `${change.text}.`,
  };
}

export const notifySupport = () => {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
};

// Keeps one timer per upcoming change and replaces them all when the plan changes.
export function createScheduler({ show, now = () => Date.now() }) {
  let timers = [];
  const fired = new Set();

  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const schedule = (plan, utcOffsetSeconds, placeName) => {
    clear();
    const changes = upcomingChanges(plan)
      .map((c) => ({ ...c, at: toEpoch(c.time, utcOffsetSeconds) }))
      .filter((c) => c.at > now());

    for (const c of changes) {
      const key = `${placeName}|${c.time}|${c.open}`;
      if (fired.has(key)) continue;
      timers.push(
        setTimeout(() => {
          fired.add(key);
          show(c, placeName);
        }, c.at - now()),
      );
    }
    return changes[0] || null;
  };

  return { schedule, clear };
}

// Show through the service worker when we can: Android Chrome does not allow
// `new Notification()` from a page, only registration.showNotification().
// `msg` lets the interface pass translated text.
export async function showNotification(change, placeName, msg = message(change)) {
  const { title, body } = msg;
  const options = {
    body: placeName ? `${placeName}: ${body}` : body,
    tag: 'windowwise-change',
    renotify: true,
    icon: 'icon.svg',
    badge: 'icon.svg',
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, options);
  } catch {
    /* fall through */
  }
  return new Notification(title, options);
}
