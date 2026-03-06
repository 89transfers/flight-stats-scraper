import { CONFIG } from './config';
import { getFlights, refreshAllFlightData } from './service';
import { ApiResponse, ErrorResponse, Env } from './types';
import { createJsonResponse, formatDate, getCorsOrigin } from './utils';

/**
 * Main worker entry point
 * Handles requests to /flights endpoint with query parameters
 * Uses KV storage for caching responses
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Handle CORS preflight requests
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': getCorsOrigin(request),
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Vary': 'Origin',
          },
        });
      }

      // Only allow GET requests
      if (request.method !== 'GET') {
        return createJsonResponse(
          { error: 'Method not allowed' } as ErrorResponse,
          405,
          request
        );
      }

      // Route handling
      if (path === CONFIG.ENDPOINTS.FLIGHTS) {
        // Get query parameters
        const origin = url.searchParams.get('origin')?.toUpperCase();
        const destination = url.searchParams.get('destination')?.toUpperCase();
        const date = url.searchParams.get('date');

        console.log(`Received request - Origin: ${origin}, Destination: ${destination}, Date: ${date}`);

        // Validate parameters
        if (!origin || !destination || !date) {
          return createJsonResponse(
            { error: 'Missing required parameters: origin, destination, date' } as ErrorResponse,
            400,
            request
          );
        }

        // Validate date format and range
        try {
          const requestDate = new Date(date);
          if (isNaN(requestDate.getTime())) {
            throw new Error('Invalid date');
          }
          // Validate the date didn't silently roll over (e.g., Feb 30 -> Mar 2)
          if (formatDate(requestDate) !== date) {
            throw new Error('Invalid date');
          }

          // Check if date is within range (today + 3 days)
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const maxDate = new Date(today);
          maxDate.setDate(maxDate.getDate() + CONFIG.DAYS_TO_FETCH - 1);
          
          if (requestDate < today || requestDate > maxDate) {
            return createJsonResponse(
              {
                error: `Date must be between ${formatDate(today)} and ${formatDate(maxDate)}`
              } as ErrorResponse,
              400,
              request
            );
          }

          // Format date consistently
          const formattedDate = formatDate(requestDate);
          console.log(`Formatted date: ${formattedDate}`);

          // Get flights matching criteria
          const flights = await getFlights(origin, destination, formattedDate, env);
          
          return createJsonResponse({
            totalFlights: flights.length,
            flights
          } as ApiResponse, 200, request);
        } catch (error) {
          return createJsonResponse(
            { error: 'Invalid date format. Use YYYY-MM-DD' } as ErrorResponse,
            400,
            request
          );
        }

      } else if (path === CONFIG.ENDPOINTS.REFRESH) {
        // Manual trigger for refreshing flight data
        await refreshAllFlightData(env);
        return createJsonResponse({ message: 'Flight data refreshed successfully' }, 200, request);

      } else {
        return createJsonResponse(
          { error: 'Not Found' } as ErrorResponse,
          404,
          request
        );
      }

    } catch (error) {
      console.error('Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      return createJsonResponse(
        { error: errorMessage } as ErrorResponse,
        500,
        request
      );
    }
  },

  // Cron trigger for refreshing flight data
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshAllFlightData(env));
  }
};