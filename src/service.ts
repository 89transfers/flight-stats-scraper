import { CONFIG, HTML_MARKERS } from './config';
import { ICAO_IATA_CODES } from './constant';
import { Flight, FlightType, RawFlightData } from './types';
import {
  createFlightDataUrl,
  extractJsonFromHtml,
  formatDate,
  generateDates,
  getNextDayDate,
  getPreviousDayDate,
  isOvernightFlight,
  calculateDuration
} from './utils';

/**
 * Transforms raw flight data into the new standardized format
 */
function transformFlightData(
  flight: RawFlightData,
  type: FlightType,
  currentDate: string,
): Flight {
  const departureTime = flight.departureTime.time24;
  const arrivalTime = flight.arrivalTime.time24;
  
  let departureDate = currentDate;
  let arrivalDate = currentDate;
  
  // Calculate correct dates for overnight flights
  if (type === 'arrivals') {
    // Early morning arrivals (00:00-06:00) likely departed the previous day
    if (arrivalTime >= '00:00' && arrivalTime <= '06:00') {
      departureDate = getPreviousDayDate(currentDate);
    }
  } else if (isOvernightFlight(departureTime, arrivalTime)) {
    arrivalDate = getNextDayDate(currentDate);
  }

  const originIata = type === 'departures' ? CONFIG.AIRPORT : flight.airport.fs;
  const destinationIata = type === 'departures' ? flight.airport.fs : CONFIG.AIRPORT;
  const originName = type === 'departures' ? 'Palma de Mallorca' : flight.airport.city;
  const destinationName = type === 'departures' ? flight.airport.city : 'Palma de Mallorca';
  flight.carrier.fs = flight.carrier.fs.replace(/[^a-zA-Z0-9]/g, '') 
   if(flight.carrier.fs.length>2) {
    if(ICAO_IATA_CODES[flight.carrier.fs]){
      flight.carrier.fs = ICAO_IATA_CODES[flight.carrier.fs]
    }
  }

  return {
    flight_id: `${flight.carrier.fs}${flight.carrier.flightNumber}_${departureDate}`,
    origin_iata: originIata,
    destination_iata: destinationIata,
    origin_name: originName,
    destination_name: destinationName,
    departure: departureTime,
    arrival: arrivalTime,
    departure_date: departureDate,
    arrival_date: arrivalDate,
    duration: calculateDuration(departureTime, arrivalTime, departureDate !== arrivalDate),
    company: flight.carrier.name,
    company_logo: `https://cdn.jsdelivr.net/gh/spydogenesis/airlines-logo@latest/airlines-logo/200x200_v2/${flight.carrier.fs}.png`,
    flight: `${flight.carrier.fs}${flight.carrier.flightNumber}`
  };
}

/**
 * Fetches flight data for a specific date and time slot
 */
async function fetchFlightDataForTimeSlot(
  type: FlightType,
  date: Date,
  hour: number
): Promise<Flight[]> {
  const url = createFlightDataUrl(CONFIG.BASE_URL, type, CONFIG.AIRPORT, date, hour);
  
  const response = await fetch(url, {
    headers: CONFIG.HEADERS
  });

  if (!response.ok) {
    console.error(`HTTP error! status: ${response.status} for URL: ${url}`);
    return [];
  }

  const html = await response.text();
  
  try {
    const data = extractJsonFromHtml(html, HTML_MARKERS.START, HTML_MARKERS.END);
    const flights = data.props.initialState.flightTracker.route.flights;
    const currentDate = formatDate(date);

    // Filter out codeshare flights and transform the remaining ones
    return flights
      .filter((flight: RawFlightData) => !flight.isCodeshare)
      .map((flight: RawFlightData) => transformFlightData(flight, type, currentDate));
  } catch (error) {
    console.error(`Error processing data from ${url}:`, error);
    return [];
  }
}

/**
 * Fetches all flight data for a specific date concurrently
 */
async function fetchFlightDataForDate(type: FlightType, date: Date): Promise<Flight[]> {
  const fetchPromises = CONFIG.TIME_SLOTS.map(hour => 
    fetchFlightDataForTimeSlot(type, date, hour)
  );

  const results = await Promise.all(fetchPromises);
  return results.flat();
}

/**
 * Refreshes all flight data and stores in cache
 */
export async function refreshAllFlightData(env: { FLIGHTS_KV: KVNamespace }): Promise<void> {
  const dates = Array.from(generateDates(CONFIG.DAYS_TO_FETCH));
  const allFlights: Flight[] = [];

  // Fetch both arrivals and departures
  for (const type of ['arrivals', 'departures'] as FlightType[]) {
    for (const date of dates) {
      const flights = await fetchFlightDataForDate(type, date);
      allFlights.push(...flights);
    }
  }

  // Store all flights in cache
  if (allFlights.length > 0) {
    console.log(`Storing ${allFlights.length} non-codeshare flights in cache`);
    await env.FLIGHTS_KV.put(
      CONFIG.CACHE.ALL_FLIGHTS_KEY,
      JSON.stringify(allFlights),
      { expirationTtl: CONFIG.CACHE.EXPIRATION }
    );
  }
}

/**
 * Gets flights matching the specified criteria
 */
export async function getFlights(
  origin: string,
  destination: string,
  date: string,
  env: { FLIGHTS_KV: KVNamespace },
  retried = false
): Promise<Flight[]> {
  console.log(`Searching flights: ${origin} -> ${destination} on ${date}`);

  // Try to get from cache
  const cached = await env.FLIGHTS_KV.get(CONFIG.CACHE.ALL_FLIGHTS_KEY);
  if (!cached) {
    if (retried) {
      console.error('Cache still empty after refresh, returning empty results');
      return [];
    }
    console.log('Cache miss, refreshing data...');
    await refreshAllFlightData(env);
    return getFlights(origin, destination, date, env, true);
  }

  const allFlights = JSON.parse(cached) as Flight[];
  console.log(`Total flights in cache: ${allFlights.length}`);
  
  // Log some sample flights for debugging
  console.log('Sample flight dates:');
  allFlights.slice(0, 3).forEach(f => {
    console.log(`Flight ${f.flight}: ${f.departure_date}, ${f.origin_iata} -> ${f.destination_iata}`);
  });

  // Filter flights based on criteria
  const matchingFlights = allFlights.filter(flight => {
    const matches = flight.origin_iata === origin &&
      flight.destination_iata === destination &&
      flight.departure_date === date;

    if (matches) {
      console.log(`Found matching flight: ${flight.flight}`);
    }

    return matches;
  });

  // Deduplicate by flight_id
  const seen = new Set<string>();
  const uniqueFlights = matchingFlights.filter(f => {
    if (seen.has(f.flight_id)) return false;
    seen.add(f.flight_id);
    return true;
  });

  console.log(`Found ${uniqueFlights.length} matching flights (${matchingFlights.length - uniqueFlights.length} duplicates removed)`);
  return uniqueFlights;
}