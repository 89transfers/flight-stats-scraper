export const CONFIG = {
  BASE_URL: 'https://www.flightstats.com/v2/flight-tracker',
  AIRPORT: 'PMI',
  TIME_SLOTS: [0, 6, 12, 18],
  DAYS_TO_FETCH: 4,  // Today + 3 days = 4 days total
  ENDPOINTS: {
    FLIGHTS: '/flights',
    REFRESH: '/refresh-data'
  },
  HEADERS: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  },
  CACHE: {
    ALL_FLIGHTS_KEY: 'all_flights_data',
    EXPIRATION: 60 * 60 * 3, // 3 hours in seconds
  }
} as const;

export const HTML_MARKERS = {
  START: '__NEXT_DATA__ = ',
  END: ';__NEXT_LOADED_PAGES__'
} as const;