import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDate,
  getNextDayDate,
  getPreviousDayDate,
  isOvernightFlight,
  calculateDuration,
  generateDates,
  createFlightDataUrl,
  extractJsonFromHtml,
} from '../utils';

describe('formatDate', () => {
  it('should format a regular date as YYYY-MM-DD', () => {
    const date = new Date(2026, 5, 15); // June 15, 2026
    expect(formatDate(date)).toBe('2026-06-15');
  });

  it('should pad single-digit day with leading zero', () => {
    const date = new Date(2026, 2, 5); // March 5, 2026
    expect(formatDate(date)).toBe('2026-03-05');
  });

  it('should format the first day of a month correctly', () => {
    const date = new Date(2026, 0, 1); // January 1, 2026
    expect(formatDate(date)).toBe('2026-01-01');
  });

  it('should format the last day of the year correctly', () => {
    const date = new Date(2026, 11, 31); // December 31, 2026
    expect(formatDate(date)).toBe('2026-12-31');
  });
});

describe('getNextDayDate', () => {
  it('should return the next day for a normal date', () => {
    expect(getNextDayDate('2026-03-10')).toBe('2026-03-11');
  });

  it('should roll over to the next month at end of month', () => {
    expect(getNextDayDate('2026-01-31')).toBe('2026-02-01');
  });

  it('should roll over to the next year at end of year', () => {
    expect(getNextDayDate('2026-12-31')).toBe('2027-01-01');
  });
});

describe('getPreviousDayDate', () => {
  it('should return the previous day for a normal date', () => {
    expect(getPreviousDayDate('2026-03-10')).toBe('2026-03-09');
  });

  it('should roll back to the previous month at first of month', () => {
    expect(getPreviousDayDate('2026-02-01')).toBe('2026-01-31');
  });

  it('should roll back to the previous year at first of year', () => {
    expect(getPreviousDayDate('2026-01-01')).toBe('2025-12-31');
  });
});

describe('isOvernightFlight', () => {
  it('should return false for a normal daytime flight (departure < arrival)', () => {
    expect(isOvernightFlight('10:00', '14:00')).toBe(false);
  });

  it('should return true for an overnight flight (departure > arrival)', () => {
    expect(isOvernightFlight('23:00', '02:00')).toBe(true);
  });

  it('should return false when departure and arrival times are equal', () => {
    expect(isOvernightFlight('12:00', '12:00')).toBe(false);
  });
});

describe('calculateDuration', () => {
  it('should calculate duration for a normal 1-hour flight', () => {
    expect(calculateDuration('10:00', '11:00', false)).toBe(60);
  });

  it('should calculate duration for a 30-minute flight', () => {
    expect(calculateDuration('14:00', '14:30', false)).toBe(30);
  });

  it('should calculate duration for an overnight flight with isOvernight flag', () => {
    // 23:00 -> 02:00 next day = 3 hours = 180 minutes
    expect(calculateDuration('23:00', '02:00', true)).toBe(180);
  });

  it('should add 24 hours when duration is negative even without isOvernight flag', () => {
    // The function checks both isOvernight and durationMinutes < 0
    expect(calculateDuration('23:00', '02:00', false)).toBe(180);
  });
});

describe('generateDates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 6)); // March 6, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should generate the correct number of dates starting from today', () => {
    const dates = Array.from(generateDates(4));
    expect(dates).toHaveLength(4);

    expect(formatDate(dates[0])).toBe('2026-03-06');
    expect(formatDate(dates[1])).toBe('2026-03-07');
    expect(formatDate(dates[2])).toBe('2026-03-08');
    expect(formatDate(dates[3])).toBe('2026-03-09');
  });
});

describe('createFlightDataUrl', () => {
  it('should generate the correct URL with all parameters', () => {
    const date = new Date(2026, 2, 6); // March 6, 2026
    const url = createFlightDataUrl(
      'https://www.flightstats.com/v2/flight-tracker',
      'departures',
      'PMI',
      date,
      12
    );
    expect(url).toBe(
      'https://www.flightstats.com/v2/flight-tracker/departures/PMI/?year=2026&month=3&date=6&hour=12'
    );
  });
});

describe('extractJsonFromHtml', () => {
  it('should extract and parse JSON between start and end markers', () => {
    const json = { foo: 'bar', num: 42 };
    const html = `<html>__NEXT_DATA__ = ${JSON.stringify(json)};__NEXT_LOADED_PAGES__</html>`;
    const result = extractJsonFromHtml(html, '__NEXT_DATA__ = ', ';__NEXT_LOADED_PAGES__');
    expect(result).toEqual(json);
  });

  it('should throw an error when markers are not found in the HTML', () => {
    const html = '<html><body>No flight data here</body></html>';
    expect(() =>
      extractJsonFromHtml(html, '__NEXT_DATA__ = ', ';__NEXT_LOADED_PAGES__')
    ).toThrow('Could not find flight data in the page');
  });
});
