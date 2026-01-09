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
    
    // Properly detect round-trip
    const isRoundTrip = return_date && return_date !== null && return_date !== 'null' && return_date.trim() !== '';
    
    console.log('=== FLIGHT SEARCH DEBUG ===');
    console.log('Return date received:', return_date);
    console.log('Is round trip?', isRoundTrip);
    console.log('Trip type will be:', isRoundTrip ? '1 (round-trip)' : '2 (one-way)');
    
    const searchParams = {
      engine: 'google_flights',
      departure_id: origin,
      arrival_id: destination,
      outbound_date: departure_date,
      type: isRoundTrip ? '1' : '2',
      currency: 'INR',
      hl: 'en',
      api_key: SERP_API_KEY
    };
    
    // Only add return_date for round-trip
    if (isRoundTrip) {
      searchParams.return_date = return_date;
      console.log('Added return_date to search:', return_date);
    }
    
    console.log('Calling SerpAPI with params:', JSON.stringify(searchParams, null, 2));
    
    const response = await axios.get(url, { 
      params: searchParams,
      timeout: 30000 
    });
    
    console.log('SerpAPI response received, status:', response.status);
    
    const data = response.data;
    const flights = [];
    
    // Parse best flights
    if (data.best_flights && data.best_flights.length > 0) {
      console.log('Found', data.best_flights.length, 'best flights');
      
      data.best_flights.forEach(flight => {
        if (flight.flights && flight.flights.length > 0) {
          console.log('Processing flight with', flight.flights.length, 'legs');
          
          const flightData = {
            type: 'best',
            price: flight.price || 'N/A',
            is_round_trip: isRoundTrip
          };
          
          if (isRoundTrip && flight.flights.length >= 2) {
            // Round-trip: Parse both legs
            console.log('Parsing as ROUND-TRIP with', flight.flights.length, 'legs');
            
            // Find outbound (origin → destination)
            const outboundLeg = flight.flights.find(leg => 
              leg.departure_airport?.id === origin || 
              leg.departure_airport?.name?.includes(origin)
            ) || flight.flights[0];
            
            // Find return (destination → origin)
            const returnLeg = flight.flights.find((leg, idx) => 
              idx > 0 && (
                leg.departure_airport?.id === destination || 
                leg.arrival_airport?.id === origin ||
                leg.departure_airport?.name?.includes(destination)
              )
            ) || flight.flights[flight.flights.length - 1];
            
            console.log('Outbound leg:', outboundLeg.departure_airport?.id, '→', outboundLeg.arrival_airport?.id);
            console.log('Return leg:', returnLeg.departure_airport?.id, '→', returnLeg.arrival_airport?.id);
            
            // Outbound details
            flightData.outbound = {
              departure_time: outboundLeg.departure_airport?.time || 'N/A',
              arrival_time: outboundLeg.arrival_airport?.time || 'N/A',
              departure_airport: outboundLeg.departure_airport?.id || origin,
              arrival_airport: outboundLeg.arrival_airport?.id || destination,
              duration: outboundLeg.duration || 'N/A',
              airline: outboundLeg.airline || 'Unknown',
              flight_number: outboundLeg.flight_number || 'N/A'
            };
            
            // Return details
            flightData.return = {
              departure_time: returnLeg.departure_airport?.time || 'N/A',
              arrival_time: returnLeg.arrival_airport?.time || 'N/A',
              departure_airport: returnLeg.departure_airport?.id || destination,
              arrival_airport: returnLeg.arrival_airport?.id || origin,
              duration: returnLeg.duration || 'N/A',
              airline: returnLeg.airline || 'Unknown',
              flight_number: returnLeg.flight_number || 'N/A'
            };
            
            // Main airline and flight number (use outbound)
            flightData.airline = outboundLeg.airline || 'Unknown';
            flightData.flight_number = outboundLeg.flight_number || 'N/A';
            flightData.stops = flight.flights.length - 2; // Subtract 2 for outbound and return
            
            console.log('Round-trip flight data:', JSON.stringify(flightData, null, 2));
            
          } else {
            // One-way: Parse single leg
            console.log('Parsing as ONE-WAY');
            
            const leg = flight.flights[0];
            
            flightData.airline = leg.airline || 'Unknown';
            flightData.flight_number = leg.flight_number || 'N/A';
            flightData.departure_time = leg.departure_airport?.time || 'N/A';
            flightData.arrival_time = leg.arrival_airport?.time || 'N/A';
            flightData.duration = leg.duration || 'N/A';
            flightData.stops = flight.flights.length - 1;
            
            // Also add to outbound for compatibility
            flightData.outbound = {
              departure_time: leg.departure_airport?.time || 'N/A',
              arrival_time: leg.arrival_airport?.time || 'N/A',
              departure_airport: leg.departure_airport?.id || origin,
              arrival_airport: leg.arrival_airport?.id || destination,
              duration: leg.duration || 'N/A',
              airline: leg.airline || 'Unknown',
              flight_number: leg.flight_number || 'N/A'
            };
          }
          
          flights.push(flightData);
        }
      });
    }
    
    // Parse other flights
    if (data.other_flights && data.other_flights.length > 0) {
      console.log('Found', data.other_flights.length, 'other flights');
      
      data.other_flights.slice(0, 5).forEach(flight => {
        if (flight.flights && flight.flights.length > 0) {
          
          const flightData = {
            type: 'other',
            price: flight.price || 'N/A',
            is_round_trip: isRoundTrip
          };
          
          if (isRoundTrip && flight.flights.length >= 2) {
            // Round-trip: Parse both legs
            
            // Find outbound (origin → destination)
            const outboundLeg = flight.flights.find(leg => 
              leg.departure_airport?.id === origin || 
              leg.departure_airport?.name?.includes(origin)
            ) || flight.flights[0];
            
            // Find return (destination → origin)
            const returnLeg = flight.flights.find((leg, idx) => 
              idx > 0 && (
                leg.departure_airport?.id === destination || 
                leg.arrival_airport?.id === origin ||
                leg.departure_airport?.name?.includes(destination)
              )
            ) || flight.flights[flight.flights.length - 1];
            
            // Outbound details
            flightData.outbound = {
              departure_time: outboundLeg.departure_airport?.time || 'N/A',
              arrival_time: outboundLeg.arrival_airport?.time || 'N/A',
              departure_airport: outboundLeg.departure_airport?.id || origin,
              arrival_airport: outboundLeg.arrival_airport?.id || destination,
              duration: outboundLeg.duration || 'N/A',
              airline: outboundLeg.airline || 'Unknown',
              flight_number: outboundLeg.flight_number || 'N/A'
            };
            
            // Return details
            flightData.return = {
              departure_time: returnLeg.departure_airport?.time || 'N/A',
              arrival_time: returnLeg.arrival_airport?.time || 'N/A',
              departure_airport: returnLeg.departure_airport?.id || destination,
              arrival_airport: returnLeg.arrival_airport?.id || origin,
              duration: returnLeg.duration || 'N/A',
              airline: returnLeg.airline || 'Unknown',
              flight_number: returnLeg.flight_number || 'N/A'
            };
            
            // Main airline and flight number (use outbound)
            flightData.airline = outboundLeg.airline || 'Unknown';
            flightData.flight_number = outboundLeg.flight_number || 'N/A';
            flightData.stops = flight.flights.length - 2;
            
          } else {
            // One-way: Parse single leg
            const leg = flight.flights[0];
            
            flightData.airline = leg.airline || 'Unknown';
            flightData.flight_number = leg.flight_number || 'N/A';
            flightData.departure_time = leg.departure_airport?.time || 'N/A';
            flightData.arrival_time = leg.arrival_airport?.time || 'N/A';
            flightData.duration = leg.duration || 'N/A';
            flightData.stops = flight.flights.length - 1;
            
            // Also add to outbound for compatibility
            flightData.outbound = {
              departure_time: leg.departure_airport?.time || 'N/A',
              arrival_time: leg.arrival_airport?.time || 'N/A',
              departure_airport: leg.departure_airport?.id || origin,
              arrival_airport: leg.arrival_airport?.id || destination,
              duration: leg.duration || 'N/A',
              airline: leg.airline || 'Unknown',
              flight_number: leg.flight_number || 'N/A'
            };
          }
          
          flights.push(flightData);
        }
      });
    }
    
    console.log(`Total flights parsed: ${flights.length}`);
    console.log('=== END DEBUG ===');
    
    return {
      success: true,
      route: `${origin} to ${destination}`,
      date: departure_date,
      return_date: return_date || null,
      trip_type: isRoundTrip ? 'round-trip' : 'one-way',
      flights: flights,
      total_results: flights.length,
      price_insights: data.price_insights || null
    };
    
  } catch (error) {
    console.error('========================================');
    console.error('SerpAPI ERROR:');
    console.error('Message:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    console.error('========================================');
    
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