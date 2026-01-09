const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// ✅ CRITICAL: Proper CORS configuration for POST requests
const corsOptions = {
  origin: '*', // Allow all origins (change in production)
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400 // Cache preflight for 24 hours
};

app.use(cors(corsOptions));

// ✅ Handle OPTIONS preflight requests explicitly
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

// ✅ CRITICAL: Execute tool endpoint with proper CORS
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

// Search flights function
async function searchFlights(params) {
  console.log('searchFlights called with:', params);

  const { origin, destination, departure_date, return_date } = params;

  // Validate required parameters
  if (!origin || !destination || !departure_date) {
    return {
      success: false,
      error: 'Missing required parameters: origin, destination, or departure_date'
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

    const searchParams = {
      engine: 'google_flights',
      departure_id: origin,
      arrival_id: destination,
      outbound_date: departure_date,
      type: '2',
      currency: 'INR',
      hl: 'en',
      api_key: SERP_API_KEY
    };

    console.log('Calling SerpAPI...');

    const response = await axios.get(url, {
      params: searchParams,
      timeout: 30000
    });

    console.log('SerpAPI response received');

    const data = response.data;
    const flights = [];

    // Parse best flights
    if (data.best_flights && data.best_flights.length > 0) {
      data.best_flights.forEach(flight => {
        if (flight.flights && flight.flights[0]) {
          const firstLeg = flight.flights[0];
          flights.push({
            type: 'best',
            airline: firstLeg.airline || 'Unknown',
            flight_number: firstLeg.flight_number || 'N/A',
            departure_time: firstLeg.departure_airport?.time || 'N/A',
            arrival_time: firstLeg.arrival_airport?.time || 'N/A',
            duration: firstLeg.duration || 'N/A',
            price: flight.price || 'N/A',
            stops: flight.flights.length - 1
          });
        }
      });
    }

    // Parse other flights
    if (data.other_flights && data.other_flights.length > 0) {
      data.other_flights.slice(0, 5).forEach(flight => {
        if (flight.flights && flight.flights[0]) {
          const firstLeg = flight.flights[0];
          flights.push({
            type: 'other',
            airline: firstLeg.airline || 'Unknown',
            flight_number: firstLeg.flight_number || 'N/A',
            departure_time: firstLeg.departure_airport?.time || 'N/A',
            arrival_time: firstLeg.arrival_airport?.time || 'N/A',
            duration: firstLeg.duration || 'N/A',
            price: flight.price || 'N/A',
            stops: flight.flights.length - 1
          });
        }
      });
    }

    console.log(`Found ${flights.length} flights`);

    return {
      success: true,
      route: `${origin} to ${destination}`,
      date: departure_date,
      flights: flights,
      total_results: flights.length,
      price_insights: data.price_insights || null
    };

  } catch (error) {
    console.error('SerpAPI error:', error.message);
    if (error.response) {
      console.error('SerpAPI error response:', error.response.data);
    }
    return {
      success: false,
      error: error.message,
      fallback_message: `Unable to fetch flights for ${origin} to ${destination} on ${departure_date}. Error: ${error.message}`
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

// ✅ CRITICAL: Listen on 0.0.0.0 and use Railway's PORT
app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log(`🚀 Google Flights MCP Server RUNNING`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`📍 Listening on: 0.0.0.0:${PORT}`);
  console.log(`📍 CORS enabled: YES`);
  console.log(`📍 SERP API: ${SERP_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log('========================================');
});