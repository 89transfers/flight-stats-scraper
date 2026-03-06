import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawFlightData, FlightType } from '../types';

// Mock the constant module before importing service
vi.mock('../constant', () => ({
  ICAO_IATA_CODES: {
    BMS: '0B',
    VFC: '0V',
    RYR: 'FR', // Ryanair ICAO -> IATA for testing
  } as Record<string, string>,
}));

// We need to import the service functions dynamically so mocks are applied.
// The transformFlightData function is not exported, so we test it indirectly
// through getFlights / refreshAllFlightData. However, to unit-test transformFlightData
// directly, we can import the module and use its internals.

// Since transformFlightData is NOT exported, we re-implement the test through
// a small trick: import the whole module source. Instead, let's test through
// the exported functions and also test the transform logic by calling
// refreshAllFlightData with mocked fetch.

function createMockRawFlight(overrides: Partial<RawFlightData> = {}): RawFlightData {
  return {
    carrier: {
      fs: 'VY',
      name: 'Vueling',
      flightNumber: '3901',
    },
    departureTime: { time24: '10:00' },
    arrivalTime: { time24: '12:30' },
    airport: { fs: 'BCN', city: 'Barcelona' },
    operatedBy: null,
    isCodeshare: false,
    ...overrides,
  };
}

function buildHtmlWithFlights(flights: RawFlightData[]): string {
  const data = {
    props: {
      initialState: {
        flightTracker: {
          route: { flights },
        },
      },
    },
  };
  return `<html>__NEXT_DATA__ = ${JSON.stringify(data)};__NEXT_LOADED_PAGES__</html>`;
}

function createMockKV(store: Record<string, string> = {}): KVNamespace {
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

describe('transformFlightData (tested via refreshAllFlightData)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 6)); // March 6, 2026
  });

  it('should transform a departures flight with correct departure and arrival fields', async () => {
    const rawFlight = createMockRawFlight();
    const html = buildHtmlWithFlights([rawFlight]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const store: Record<string, string> = {};
    const kv = createMockKV(store);

    const { refreshAllFlightData } = await import('../service');
    await refreshAllFlightData({ FLIGHTS_KV: kv });

    expect(kv.put).toHaveBeenCalled();
    const storedData = JSON.parse((kv.put as ReturnType<typeof vi.fn>).mock.calls[0][1]);
    // There are 4 days x 4 time slots x 2 types = 32 fetch calls, each returning same flight
    // Find a departures flight
    const departureFlight = storedData.find(
      (f: any) => f.origin_iata === 'PMI' && f.destination_iata === 'BCN'
    );
    expect(departureFlight).toBeDefined();
    expect(departureFlight.origin_iata).toBe('PMI');
    expect(departureFlight.destination_iata).toBe('BCN');
    expect(departureFlight.origin_name).toBe('Palma de Mallorca');
    expect(departureFlight.destination_name).toBe('Barcelona');
    expect(departureFlight.departure).toBe('10:00');
    expect(departureFlight.arrival).toBe('12:30');
    expect(departureFlight.company).toBe('Vueling');
    expect(departureFlight.flight).toBe('VY3901');
    expect(departureFlight.flight_id).toContain('VY3901_');
  });

  it('should transform an arrivals flight with correct origin/destination', async () => {
    const rawFlight = createMockRawFlight({
      departureTime: { time24: '08:00' },
      arrivalTime: { time24: '10:30' },
    });
    const html = buildHtmlWithFlights([rawFlight]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const store: Record<string, string> = {};
    const kv = createMockKV(store);

    const { refreshAllFlightData } = await import('../service');
    await refreshAllFlightData({ FLIGHTS_KV: kv });

    const storedData = JSON.parse((kv.put as ReturnType<typeof vi.fn>).mock.calls[0][1]);
    // Find an arrivals flight (origin=BCN, destination=PMI)
    const arrivalFlight = storedData.find(
      (f: any) => f.origin_iata === 'BCN' && f.destination_iata === 'PMI'
    );
    expect(arrivalFlight).toBeDefined();
    expect(arrivalFlight.origin_iata).toBe('BCN');
    expect(arrivalFlight.destination_iata).toBe('PMI');
    expect(arrivalFlight.origin_name).toBe('Barcelona');
    expect(arrivalFlight.destination_name).toBe('Palma de Mallorca');
  });

  it('should set departureDate to previous day for early morning arrivals (00:00-06:00)', async () => {
    const rawFlight = createMockRawFlight({
      departureTime: { time24: '22:00' },
      arrivalTime: { time24: '03:00' },
    });
    const html = buildHtmlWithFlights([rawFlight]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const store: Record<string, string> = {};
    const kv = createMockKV(store);

    const { refreshAllFlightData } = await import('../service');
    await refreshAllFlightData({ FLIGHTS_KV: kv });

    const storedData = JSON.parse((kv.put as ReturnType<typeof vi.fn>).mock.calls[0][1]);
    // Find an arrivals flight with early morning arrival
    const arrivalFlight = storedData.find(
      (f: any) => f.origin_iata === 'BCN' && f.destination_iata === 'PMI' && f.arrival === '03:00'
    );
    expect(arrivalFlight).toBeDefined();
    // For arrivals with 00:00-06:00 arrival, departureDate should be previous day
    const currentDate = arrivalFlight.arrival_date; // arrival_date stays as currentDate
    const expectedDepartureDate = arrivalFlight.departure_date;
    // departure_date should be one day before arrival_date
    expect(new Date(expectedDepartureDate).getTime()).toBeLessThan(
      new Date(currentDate).getTime()
    );
  });

  it('should set arrivalDate to next day for overnight departures', async () => {
    const rawFlight = createMockRawFlight({
      departureTime: { time24: '23:30' },
      arrivalTime: { time24: '01:30' },
    });
    const html = buildHtmlWithFlights([rawFlight]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const store: Record<string, string> = {};
    const kv = createMockKV(store);

    const { refreshAllFlightData } = await import('../service');
    await refreshAllFlightData({ FLIGHTS_KV: kv });

    const storedData = JSON.parse((kv.put as ReturnType<typeof vi.fn>).mock.calls[0][1]);
    // Find a departures flight with overnight behavior
    const overnightFlight = storedData.find(
      (f: any) =>
        f.origin_iata === 'PMI' &&
        f.destination_iata === 'BCN' &&
        f.departure === '23:30'
    );
    expect(overnightFlight).toBeDefined();
    // arrivalDate should be the day after departureDate
    expect(new Date(overnightFlight.arrival_date).getTime()).toBeGreaterThan(
      new Date(overnightFlight.departure_date).getTime()
    );
  });

  it('should NOT treat 22:00-23:59 departures as overnight for arrivals (regression test)', async () => {
    // This is a regression test: flights with departure 22:00-23:59 in the ARRIVALS context
    // should NOT have their departureDate adjusted - only 00:00-06:00 arrivals trigger that logic
    const rawFlight = createMockRawFlight({
      departureTime: { time24: '22:30' },
      arrivalTime: { time24: '23:50' },
    });
    const html = buildHtmlWithFlights([rawFlight]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const store: Record<string, string> = {};
    const kv = createMockKV(store);

    const { refreshAllFlightData } = await import('../service');
    await refreshAllFlightData({ FLIGHTS_KV: kv });

    const storedData = JSON.parse((kv.put as ReturnType<typeof vi.fn>).mock.calls[0][1]);
    // Find an arrivals flight arriving at 23:50 (NOT in 00:00-06:00 range)
    const arrivalFlight = storedData.find(
      (f: any) => f.origin_iata === 'BCN' && f.destination_iata === 'PMI' && f.arrival === '23:50'
    );
    expect(arrivalFlight).toBeDefined();
    // departure_date and arrival_date should be the SAME (no overnight adjustment)
    expect(arrivalFlight.departure_date).toBe(arrivalFlight.arrival_date);
  });

  it('should sanitize carrier code by removing special characters', async () => {
    const rawFlight = createMockRawFlight({
      carrier: { fs: 'V!Y@', name: 'Vueling', flightNumber: '100' },
    });
    const html = buildHtmlWithFlights([rawFlight]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const store: Record<string, string> = {};
    const kv = createMockKV(store);

    const { refreshAllFlightData } = await import('../service');
    await refreshAllFlightData({ FLIGHTS_KV: kv });

    const storedData = JSON.parse((kv.put as ReturnType<typeof vi.fn>).mock.calls[0][1]);
    // After sanitization, 'V!Y@' becomes 'VY' (2 chars, no ICAO lookup)
    const flight = storedData.find((f: any) => f.flight === 'VY100');
    expect(flight).toBeDefined();
  });

  it('should convert 3-letter ICAO carrier code to IATA', async () => {
    const rawFlight = createMockRawFlight({
      carrier: { fs: 'RYR', name: 'Ryanair', flightNumber: '5000' },
    });
    const html = buildHtmlWithFlights([rawFlight]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const store: Record<string, string> = {};
    const kv = createMockKV(store);

    const { refreshAllFlightData } = await import('../service');
    await refreshAllFlightData({ FLIGHTS_KV: kv });

    const storedData = JSON.parse((kv.put as ReturnType<typeof vi.fn>).mock.calls[0][1]);
    // RYR (3 letters) should be converted to FR via our mock ICAO_IATA_CODES
    const flight = storedData.find((f: any) => f.flight === 'FR5000');
    expect(flight).toBeDefined();
    expect(flight.company).toBe('Ryanair');
  });

  it('should keep original ICAO code when no IATA mapping exists', async () => {
    const rawFlight = createMockRawFlight({
      carrier: { fs: 'XYZ', name: 'Unknown Air', flightNumber: '999' },
    });
    const html = buildHtmlWithFlights([rawFlight]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const store: Record<string, string> = {};
    const kv = createMockKV(store);

    const { refreshAllFlightData } = await import('../service');
    await refreshAllFlightData({ FLIGHTS_KV: kv });

    const storedData = JSON.parse((kv.put as ReturnType<typeof vi.fn>).mock.calls[0][1]);
    // XYZ has no mapping, so it should remain as XYZ
    const flight = storedData.find((f: any) => f.flight === 'XYZ999');
    expect(flight).toBeDefined();
  });
});

describe('getFlights', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 6)); // March 6, 2026
  });

  it('should return matching flights from cache (cache hit)', async () => {
    const cachedFlights = [
      {
        flight_id: 'VY3901_2026-03-06',
        origin_iata: 'PMI',
        destination_iata: 'BCN',
        origin_name: 'Palma de Mallorca',
        destination_name: 'Barcelona',
        departure: '10:00',
        arrival: '12:30',
        departure_date: '2026-03-06',
        arrival_date: '2026-03-06',
        duration: 150,
        company: 'Vueling',
        company_logo: 'https://cdn.jsdelivr.net/gh/spydogenesis/airlines-logo@latest/airlines-logo/200x200_v2/VY.png',
        flight: 'VY3901',
      },
      {
        flight_id: 'FR1234_2026-03-06',
        origin_iata: 'PMI',
        destination_iata: 'LGW',
        origin_name: 'Palma de Mallorca',
        destination_name: 'London',
        departure: '14:00',
        arrival: '16:00',
        departure_date: '2026-03-06',
        arrival_date: '2026-03-06',
        duration: 120,
        company: 'Ryanair',
        company_logo: 'https://cdn.jsdelivr.net/gh/spydogenesis/airlines-logo@latest/airlines-logo/200x200_v2/FR.png',
        flight: 'FR1234',
      },
    ];

    const kv = createMockKV({ all_flights_data: JSON.stringify(cachedFlights) });

    const { getFlights } = await import('../service');
    const result = await getFlights('PMI', 'BCN', '2026-03-06', { FLIGHTS_KV: kv });

    expect(result).toHaveLength(1);
    expect(result[0].flight).toBe('VY3901');
    expect(result[0].origin_iata).toBe('PMI');
    expect(result[0].destination_iata).toBe('BCN');
  });

  it('should filter correctly by origin, destination, and date', async () => {
    const cachedFlights = [
      {
        flight_id: 'VY3901_2026-03-06',
        origin_iata: 'PMI',
        destination_iata: 'BCN',
        departure_date: '2026-03-06',
        departure: '10:00',
        arrival: '12:30',
        arrival_date: '2026-03-06',
        duration: 150,
        company: 'Vueling',
        origin_name: 'Palma de Mallorca',
        destination_name: 'Barcelona',
        company_logo: '',
        flight: 'VY3901',
      },
      {
        flight_id: 'VY3902_2026-03-07',
        origin_iata: 'PMI',
        destination_iata: 'BCN',
        departure_date: '2026-03-07',
        departure: '10:00',
        arrival: '12:30',
        arrival_date: '2026-03-07',
        duration: 150,
        company: 'Vueling',
        origin_name: 'Palma de Mallorca',
        destination_name: 'Barcelona',
        company_logo: '',
        flight: 'VY3902',
      },
      {
        flight_id: 'FR1000_2026-03-06',
        origin_iata: 'BCN',
        destination_iata: 'PMI',
        departure_date: '2026-03-06',
        departure: '08:00',
        arrival: '10:30',
        arrival_date: '2026-03-06',
        duration: 150,
        company: 'Ryanair',
        origin_name: 'Barcelona',
        destination_name: 'Palma de Mallorca',
        company_logo: '',
        flight: 'FR1000',
      },
    ];

    const kv = createMockKV({ all_flights_data: JSON.stringify(cachedFlights) });

    const { getFlights } = await import('../service');

    // Only PMI->BCN on 2026-03-06
    const result = await getFlights('PMI', 'BCN', '2026-03-06', { FLIGHTS_KV: kv });
    expect(result).toHaveLength(1);
    expect(result[0].flight).toBe('VY3901');

    // Different date - should get VY3902
    const result2 = await getFlights('PMI', 'BCN', '2026-03-07', { FLIGHTS_KV: kv });
    expect(result2).toHaveLength(1);
    expect(result2[0].flight).toBe('VY3902');

    // Reverse route
    const result3 = await getFlights('BCN', 'PMI', '2026-03-06', { FLIGHTS_KV: kv });
    expect(result3).toHaveLength(1);
    expect(result3[0].flight).toBe('FR1000');
  });

  it('should deduplicate flights by flight_id', async () => {
    const duplicatedFlights = [
      {
        flight_id: 'IB1669_2026-03-06',
        origin_iata: 'MAD',
        destination_iata: 'PMI',
        origin_name: 'Madrid',
        destination_name: 'Palma de Mallorca',
        departure: '08:00',
        arrival: '09:30',
        departure_date: '2026-03-06',
        arrival_date: '2026-03-06',
        duration: 90,
        company: 'Iberia',
        company_logo: '',
        flight: 'IB1669',
      },
      {
        flight_id: 'IB1669_2026-03-06',
        origin_iata: 'MAD',
        destination_iata: 'PMI',
        origin_name: 'Madrid',
        destination_name: 'Palma de Mallorca',
        departure: '08:00',
        arrival: '09:30',
        departure_date: '2026-03-06',
        arrival_date: '2026-03-06',
        duration: 90,
        company: 'Iberia',
        company_logo: '',
        flight: 'IB1669',
      },
      {
        flight_id: 'VY3901_2026-03-06',
        origin_iata: 'MAD',
        destination_iata: 'PMI',
        origin_name: 'Madrid',
        destination_name: 'Palma de Mallorca',
        departure: '14:00',
        arrival: '15:30',
        departure_date: '2026-03-06',
        arrival_date: '2026-03-06',
        duration: 90,
        company: 'Vueling',
        company_logo: '',
        flight: 'VY3901',
      },
    ];

    const kv = createMockKV({ all_flights_data: JSON.stringify(duplicatedFlights) });

    const { getFlights } = await import('../service');
    const result = await getFlights('MAD', 'PMI', '2026-03-06', { FLIGHTS_KV: kv });

    // Should have 2 unique flights, not 3
    expect(result).toHaveLength(2);
    expect(result[0].flight).toBe('IB1669');
    expect(result[1].flight).toBe('VY3901');
  });

  it('should return empty array when cache is empty and retried=true (no infinite recursion)', async () => {
    const kv = createMockKV({}); // empty cache

    const { getFlights } = await import('../service');
    const result = await getFlights('PMI', 'BCN', '2026-03-06', { FLIGHTS_KV: kv }, true);

    expect(result).toEqual([]);
    // Should NOT call KV.put (no refreshAllFlightData triggered)
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('should call refreshAllFlightData on cache miss when retried=false', async () => {
    // First call: cache miss -> refresh -> second call: has data
    const rawFlight = createMockRawFlight();
    const html = buildHtmlWithFlights([rawFlight]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const store: Record<string, string> = {};
    const kv = createMockKV(store);

    const { getFlights } = await import('../service');
    const result = await getFlights('PMI', 'BCN', '2026-03-06', { FLIGHTS_KV: kv });

    // refreshAllFlightData should have been called (fetch was called)
    expect(global.fetch).toHaveBeenCalled();
    // KV.put should have been called to store refreshed data
    expect(kv.put).toHaveBeenCalled();
    // The result should contain matching flights
    expect(Array.isArray(result)).toBe(true);
  });

  it('should filter out codeshare flights', async () => {
    const normalFlight = createMockRawFlight();
    const codeshareFlight = createMockRawFlight({
      carrier: { fs: 'IB', name: 'Iberia', flightNumber: '5000' },
      isCodeshare: true,
    });
    const html = buildHtmlWithFlights([normalFlight, codeshareFlight]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const store: Record<string, string> = {};
    const kv = createMockKV(store);

    const { refreshAllFlightData } = await import('../service');
    await refreshAllFlightData({ FLIGHTS_KV: kv });

    const storedData = JSON.parse((kv.put as ReturnType<typeof vi.fn>).mock.calls[0][1]);
    // No IB5000 should appear (it's a codeshare)
    const codeshare = storedData.find((f: any) => f.flight === 'IB5000');
    expect(codeshare).toBeUndefined();
    // VY3901 should be present
    const normalFlightResult = storedData.find((f: any) => f.flight === 'VY3901');
    expect(normalFlightResult).toBeDefined();
  });
});
