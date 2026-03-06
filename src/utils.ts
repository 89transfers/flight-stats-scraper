/**
 * Formats a date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the next day's date in YYYY-MM-DD format
 */
export function getNextDayDate(currentDate: string): string {
  const date = new Date(currentDate);
  date.setDate(date.getDate() + 1);
  return formatDate(date);
}

/**
 * Returns the previous day's date in YYYY-MM-DD format
 */
export function getPreviousDayDate(currentDate: string): string {
  const date = new Date(currentDate);
  date.setDate(date.getDate() - 1);
  return formatDate(date);
}

/**
 * Generates dates for the next N days starting from today
 */
export function* generateDates(days: number): Generator<Date> {
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    yield date;
  }
}

/**
 * Checks if a flight is an overnight flight (arrival time is earlier than departure time)
 */
export function isOvernightFlight(departureTime: string, arrivalTime: string): boolean {
  return arrivalTime < departureTime;
}

/**
 * Calculates flight duration in minutes
 */
export function calculateDuration(departureTime: string, arrivalTime: string, isOvernight: boolean): number {
  const [depHours, depMinutes] = departureTime.split(':').map(Number);
  const [arrHours, arrMinutes] = arrivalTime.split(':').map(Number);
  
  let durationMinutes = (arrHours * 60 + arrMinutes) - (depHours * 60 + depMinutes);
  
  // If it's an overnight flight, add 24 hours (1440 minutes)
  if (isOvernight || durationMinutes < 0) {
    durationMinutes += 1440;
  }
  
  return durationMinutes;
}

/**
 * Creates a URL for fetching flight data
 */
export function createFlightDataUrl(baseUrl: string, type: string, airport: string, date: Date, hour: number): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  
  return `${baseUrl}/${type}/${airport}/?year=${year}&month=${month}&date=${day}&hour=${hour}`;
}

/**
 * Extracts JSON data from HTML response
 * @throws {Error} If markers are not found in the HTML
 */
export function extractJsonFromHtml(html: string, startMarker: string, endMarker: string): any {
  const startIndex = html.indexOf(startMarker);
  const endIndex = html.indexOf(endMarker);
  
  if (startIndex === -1 || endIndex === -1) {
    throw new Error('Could not find flight data in the page');
  }

  const jsonText = html.slice(startIndex + startMarker.length, endIndex);
  return JSON.parse(jsonText);
}

const ALLOWED_ORIGINS = [
  'https://89transfers.com',
  'https://www.89transfers.com',
];

export function getCorsOrigin(request?: Request): string {
  const origin = request?.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.v3-team-2025.pages.dev')) {
    return origin;
  }
  return ALLOWED_ORIGINS[0];
}

/**
 * Creates a JSON response with appropriate headers
 */
export function createJsonResponse(data: any, status: number = 200, request?: Request): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json;charset=UTF-8',
      'access-control-allow-origin': getCorsOrigin(request),
      'vary': 'Origin',
    },
  });
}