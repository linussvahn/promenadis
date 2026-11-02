// datetime-local values are wall times in the event's own time zone.
function partsInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function toDateTimeLocal(value: string, timeZone: string): string {
  const parts = partsInTimeZone(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function wallTimeToIso(value: string, timeZone: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u);
  if (!match) throw new Error("invalid_wall_time");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = partsInTimeZone(new Date(instant).toISOString(), timeZone);
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    instant += target - represented;
  }

  return new Date(instant).toISOString();
}
