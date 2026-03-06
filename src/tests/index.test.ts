import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createJsonResponse } from '../utils';

// Mock KV and service module
vi.mock('../service', () => ({
  getFlights: vi.fn().mockResolvedValue([]),
  refreshAllFlightData: vi.fn().mockResolvedValue(undefined),
}));

function createMockKV(): KVNamespace {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

function createMockEnv() {
  return { FLIGHTS_KV: createMockKV() };
}

function createMockCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

describe('Worker handler - date rollover validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 6)); // March 6, 2026
  });

  it('should return 400 for Feb 30 (silently rolls over to Mar 2)', async () => {
    const worker = (await import('../index')).default;
    const request = new Request(
      'https://worker.test/flights?origin=MAD&destination=PMI&date=2026-02-30'
    );
    const response = await worker.fetch(request, createMockEnv(), createMockCtx());

    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('Invalid date');
  });

  it('should return 400 for Feb 31 (silently rolls over to Mar 3)', async () => {
    const worker = (await import('../index')).default;
    const request = new Request(
      'https://worker.test/flights?origin=MAD&destination=PMI&date=2026-02-31'
    );
    const response = await worker.fetch(request, createMockEnv(), createMockCtx());

    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('Invalid date');
  });

  it('should return 400 for Apr 31 (silently rolls over to May 1)', async () => {
    const worker = (await import('../index')).default;
    const request = new Request(
      'https://worker.test/flights?origin=MAD&destination=PMI&date=2026-04-31'
    );
    const response = await worker.fetch(request, createMockEnv(), createMockCtx());

    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('Invalid date');
  });

  it('should accept a valid date like Mar 06', async () => {
    const worker = (await import('../index')).default;
    const request = new Request(
      'https://worker.test/flights?origin=MAD&destination=PMI&date=2026-03-06'
    );
    const response = await worker.fetch(request, createMockEnv(), createMockCtx());

    // Should NOT be 400 (it may be 200 with empty flights from mock)
    expect(response.status).toBe(200);
  });
});

describe('CORS headers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 6));
  });

  it('OPTIONS response should use specific origin instead of wildcard', async () => {
    const worker = (await import('../index')).default;
    const request = new Request('https://worker.test/flights', {
      method: 'OPTIONS',
    });
    const response = await worker.fetch(request, createMockEnv(), createMockCtx());

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://89transfers.com');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('JSON responses from createJsonResponse should use specific origin', () => {
    const response = createJsonResponse({ ok: true });

    expect(response.headers.get('access-control-allow-origin')).toBe('https://89transfers.com');
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('JSON responses should NOT use wildcard CORS', () => {
    const response = createJsonResponse({ ok: true });

    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
  });
});
