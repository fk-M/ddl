function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 展开 ICS 的折行（RFC5545：续行以空格或制表符开头） */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of raw) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseIcsDate(value: string): { date: Date; allDay: boolean } | null {
  const text = value.trim();
  // 20261105T070000Z
  let match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(text);
  if (match) {
    const [, y, mo, d, h, mi, s, z] = match;
    const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
    const date = z ? new Date(Date.UTC(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5])) : new Date(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
    return Number.isNaN(date.getTime()) ? null : { date, allDay: false };
  }
  // 20261105（全天）
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : { date, allDay: true };
  }
  return null;
}

export type IcsEvent = {
  uid: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  rrule: string | null;
};

/** 解析 ICS 文本中的 VEVENT（够用即可，不处理时区库与 VALARM） */
export function parseIcs(text: string): IcsEvent[] {
  const lines = unfold(text);
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('BEGIN:VEVENT')) {
      current = { uid: '', title: '未命名日程', description: null, location: null, allDay: false, rrule: null, endsAt: null };
      continue;
    }
    if (upper.startsWith('END:VEVENT')) {
      if (current?.startsAt) {
        events.push({
          uid: current.uid || `ics-${current.startsAt.getTime()}-${events.length}`,
          title: current.title ?? '未命名日程',
          description: current.description ?? null,
          location: current.location ?? null,
          startsAt: current.startsAt,
          endsAt: current.endsAt ?? null,
          allDay: current.allDay ?? false,
          rrule: current.rrule ?? null,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = head.split(';')[0]?.toUpperCase() ?? '';

    if (name === 'UID') current.uid = value.trim();
    else if (name === 'SUMMARY') current.title = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim();
    else if (name === 'DESCRIPTION') current.description = value.replace(/\\n/gi, '\n').replace(/\\,/g, ',');
    else if (name === 'LOCATION') current.location = value.replace(/\\,/g, ',');
    else if (name === 'RRULE') current.rrule = value.toUpperCase().includes('FREQ=') ? value : null;
    else if (name === 'DTSTART') {
      const parsed = parseIcsDate(value);
      if (parsed) {
        current.startsAt = parsed.date;
        current.allDay = parsed.allDay;
      }
    } else if (name === 'DTEND') {
      const parsed = parseIcsDate(value);
      if (parsed) current.endsAt = parsed.date;
    }
  }

  return events;
}

function toIcsUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function toIcsDateOnly(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function fold(line: string): string {
  if (line.length <= 74) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 0) {
    chunks.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  return chunks.join('\r\n');
}

export type IcsExportEvent = {
  uid: string;
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  allDay?: boolean;
  rrule?: string | null;
  done?: boolean;
};

/** 生成 ICS 文本 */
export function buildIcs(events: IcsExportEvent[], calendarName = 'DDL'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DDL//DDL Calendar//CN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
  ];

  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${toIcsUtc(new Date())}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toIcsDateOnly(event.startsAt)}`);
      if (event.endsAt) lines.push(`DTEND;VALUE=DATE:${toIcsDateOnly(event.endsAt)}`);
    } else {
      lines.push(`DTSTART:${toIcsUtc(event.startsAt)}`);
      if (event.endsAt) lines.push(`DTEND:${toIcsUtc(event.endsAt)}`);
    }
    lines.push(fold(`SUMMARY:${escapeIcs(event.title)}`));
    if (event.description) lines.push(fold(`DESCRIPTION:${escapeIcs(event.description)}`));
    const rule = event.rrule?.replace(/^RRULE:/i, '').trim();
    if (rule && /^(FREQ|RRULE)/i.test(rule)) lines.push(`RRULE:${rule}`);
    lines.push(`STATUS:${event.done ? 'COMPLETED' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
