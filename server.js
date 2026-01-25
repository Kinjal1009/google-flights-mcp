const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// CORS configuration
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Parse JSON bodies
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 3000;
const SERP_API_KEY = process.env.SERP_API_KEY;

console.log('Starting server...');
console.log('PORT:', PORT);
console.log('SERP_API_KEY configured:', !!SERP_API_KEY);

// Root endpoint
app.get('/', (req, res) => {
  console.log('GET / - Root endpoint accessed');
  res.json({
    message: 'Google Flights MCP Server',
    status: 'running',
    version: '1.0.0',
    port: PORT,
    endpoints: {
      root: 'GET /',
      health: 'GET /health',
      execute: 'POST /execute-tool'
    },
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('GET /health - Health check');
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    serp_configured: !!SERP_API_KEY,
    port: PORT,
    cors_enabled: true
  });
});

// Execute tool endpoint
app.post('/execute-tool', async (req, res) => {
  console.log('========================================');
  console.log('POST /execute-tool - Request received');
  console.log('Headers:', req.headers);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('========================================');

  try {
    const { tool, parameters } = req.body;

    if (!tool) {
      return res.status(400).json({
        success: false,
        error: 'Missing "tool" parameter',
        received: req.body
      });
    }

    if (!parameters) {
      return res.status(400).json({
        success: false,
        error: 'Missing "parameters" parameter',
        received: req.body
      });
    }

    if (tool === 'search_flights') {
      const result = await searchFlights(parameters);
      console.log('Sending response:', result.success ? 'SUCCESS' : 'FAILED');
      res.json(result);
    } else {
      res.status(400).json({
        success: false,
        error: 'Unknown tool: ' + tool,
        available_tools: ['search_flights']
      });
    }
  } catch (error) {
    console.error('Error in /execute-tool:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Gemini API error');
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// Search flights function - ONE-WAY ONLY
async function searchFlights(params) {
  console.log('searchFlights called with:', params);

  const { origin, destination, departure_date } = params;

  // Validate required parameters
  if (!origin || !destination || !departure_date) {
    console.error('Missing required parameters');
    return {
      success: false,
      error: 'Missing required parameters: origin, destination, or departure_date',
      received: params
    };
  }

  if (!SERP_API_KEY) {
    console.error('SERP_API_KEY not configured');
    return {
      success: false,
      error: 'SERP_API_KEY not configured',
      fallback_message: 'MCP server configuration error - API key missing'
    };
  }

  try {
    const url = 'https://serpapi.com/search';

    // Build search parameters - ONE-WAY ONLY
    const searchParams = {
      engine: 'google_flights',
      departure_id: origin,
      arrival_id: destination,
      outbound_date: departure_date,
      type: '2',  // Always one-way
      currency: 'INR',  // Indian Rupee
      hl: 'en',
      api_key: SERP_API_KEY
    };

    console.log('Calling SerpAPI...');
    console.log('Search params:', JSON.stringify(searchParams, null, 2));

    // Make API request
    const response = await axios.get(url, {
      params: searchParams,
      timeout: 30000  // 30 second timeout
    });

    console.log('SerpAPI response received, status:', response.status);

    const data = response.data;
    const flights = [];

    // Parse best flights
    if (data.best_flights && data.best_flights.length > 0) {
      console.log('Found', data.best_flights.length, 'best flights');

      data.best_flights.forEach((flight, index) => {
        if (flight.flights && flight.flights[0]) {
          const leg = flight.flights[0];

          const flightData = {
            type: 'best',
            airline: leg.airline || 'Unknown',
            flight_number: leg.flight_number || 'N/A',
            departure_time: leg.departure_airport?.time || 'N/A',
            arrival_time: leg.arrival_airport?.time || 'N/A',
            departure_airport: leg.departure_airport?.id || origin,
            arrival_airport: leg.arrival_airport?.id || destination,
            duration: leg.duration || 'N/A',
            price: flight.price || 'N/A',
            stops: flight.flights.length - 1,
            carbon_emissions: flight.carbon_emissions?.this_flight || null
          };

          flights.push(flightData);

          if (index === 0) {
            console.log('Sample flight:', JSON.stringify(flightData, null, 2));
          }
        }
      });
    } else {
      console.log('No best_flights found in response');
    }

    // Parse other flights
    if (data.other_flights && data.other_flights.length > 0) {
      console.log('Found', data.other_flights.length, 'other flights');

      // Limit to top 5 other flights
      data.other_flights.slice(0, 5).forEach(flight => {
        if (flight.flights && flight.flights[0]) {
          const leg = flight.flights[0];

          flights.push({
            type: 'other',
            airline: leg.airline || 'Unknown',
            flight_number: leg.flight_number || 'N/A',
            departure_time: leg.departure_airport?.time || 'N/A',
            arrival_time: leg.arrival_airport?.time || 'N/A',
            departure_airport: leg.departure_airport?.id || origin,
            arrival_airport: leg.arrival_airport?.id || destination,
            duration: leg.duration || 'N/A',
            price: flight.price || 'N/A',
            stops: flight.flights.length - 1
          });
        }
      });
    } else {
      console.log('No other_flights found in response');
    }

    console.log(`Total flights parsed: ${flights.length}`);

    if (flights.length === 0) {
      console.warn('No flights found for this route');
      return {
        success: false,
        error: 'No flights found',
        fallback_message: `No flights available for ${origin} to ${destination} on ${departure_date}`,
        flights: [],
        total_results: 0
      };
    }

    // Return successful response
    return {
      success: true,
      route: `${origin} to ${destination}`,
      date: departure_date,
      flights: flights,
      total_results: flights.length,
      price_insights: data.price_insights || null
    };

  } catch (error) {
    console.error('========================================');
    console.error('SerpAPI ERROR:');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);

    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }

    if (error.code) {
      console.error('Error code:', error.code);
    }

    console.error('========================================');

    // Return error response
    return {
      success: false,
      error: error.message,
      serp_error: error.response?.data || null,
      fallback_message: `Unable to fetch flights for ${origin} to ${destination} on ${departure_date}. ${error.response?.data?.error || error.message}`
    };
  }
}

// 404 handler for undefined routes
app.use((req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Route not found',
    method: req.method,
    path: req.path,
    available_routes: {
      'GET /': 'Server info',
      'GET /health': 'Health check',
      'POST /execute-tool': 'Execute MCP tool'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 Google Flights MCP Server RUNNING');
  console.log(`📍 Port: ${PORT}`);
  console.log(`📍 Listening on: 0.0.0.0:${PORT}`);
  console.log(`📍 CORS enabled: YES`);
  console.log(`📍 Currency: INR`);
  console.log(`📍 Trip type: One-way only`);
  console.log(`📍 SERP API: ${SERP_API_KEY ? 'CONFIGURED ✓' : 'NOT CONFIGURED ✗'}`);
  console.log('========================================');
});