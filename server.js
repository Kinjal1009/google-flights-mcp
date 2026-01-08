const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SERP_API_KEY = process.env.SERP_API_KEY;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Execute tool endpoint
app.post('/execute-tool', async (req, res) => {
  try {
    const { tool, parameters } = req.body;
    
    console.log('Tool request:', tool, parameters);
    
    if (tool === 'search_flights') {
      const result = await searchFlights(parameters);
      res.json(result);
    } else {
      res.status(400).json({ 
        success: false, 
        error: 'Unknown tool: ' + tool 
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Search flights using SerpAPI
async function searchFlights(params) {
  const { origin, destination, departure_date, return_date } = params;
  
  if (!SERP_API_KEY) {
    return {
      success: false,
      error: 'SERP_API_KEY not configured',
      fallback_message: 'MCP server configuration error'
    };
  }
  
  try {
    const url = 'https://serpapi.com/search';
    
    const searchParams = {
      engine: 'google_flights',
      departure_id: origin,
      arrival_id: destination,
      outbound_date: departure_date,
      return_date: return_date || undefined,
      currency: 'USD',
      hl: 'en',
      api_key: SERP_API_KEY
    };
    
    console.log('Calling SerpAPI with:', searchParams);
    
    const response = await axios.get(url, { 
      params: searchParams,
      timeout: 30000 
    });
    
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
            stops: flight.flights.length - 1,
            carbon_emissions: flight.carbon_emissions?.this_flight || 'N/A'
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
    return {
      success: false,
      error: error.message,
      fallback_message: `Unable to fetch flights for ${origin} to ${destination} on ${departure_date}. Please check airport codes and date format.`
    };
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Google Flights MCP Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});