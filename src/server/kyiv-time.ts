// The site's users are in Ukraine, so the server's daily rhythm (lists read at night, moderators' notifications
// silent late in the evening) goes by Kyiv's clock. Daylight saving is the time zone's business.
export const KYIV_TZ = 'Europe/Kyiv';

const HOUR = new Intl.DateTimeFormat('en-GB', {
    timeZone: KYIV_TZ,
    hour: 'numeric',
    hourCycle: 'h23'
});

// The hour, 0–23, on Kyiv's clock at `at` (ms since the epoch).
export const kyivHour = (at: number) => Number(HOUR.format(at));
