const { prisma } = require('../config/database');
const { isPincodeServiceable } = require('../utils/online/serviceability');

// ============================================
// ADMIN: Create a new delivery zone
// ============================================
const createDeliveryZone = async (req, res) => {
  try {
    const { country, state, city, pincodes, isActive, isAllPincodes, coverageType } = req.body;

    const resolvedCoverageType = coverageType || 'city';
    const isAllStatesInCountry = resolvedCoverageType === 'country';
    const isAllCitiesInState = resolvedCoverageType === 'state';
    const cityCoverage = resolvedCoverageType === 'city';

    if (!country) {
      return res.status(400).json({
        success: false,
        message: 'Country is required',
      });
    }

    if (!isAllStatesInCountry && !state) {
      return res.status(400).json({
        success: false,
        message: 'State is required',
      });
    }

    if (cityCoverage && !city) {
      return res.status(400).json({
        success: false,
        message: 'City is required',
      });
    }

    if (cityCoverage && !isAllPincodes && (!pincodes || !Array.isArray(pincodes) || pincodes.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'At least one pincode is required',
      });
    }

    // Clean pincodes - trim whitespace, remove empty strings
    const cleanedPincodes = Array.isArray(pincodes)
      ? pincodes.map(p => p.toString().trim()).filter(p => p.length > 0)
      : [];

    const resolvedState = isAllStatesInCountry ? '*' : state;
    const resolvedCity = isAllStatesInCountry ? '*' : (isAllCitiesInState ? '*' : city);

    // Check if zone already exists for this country+state+city combo
    const existing = await prisma.deliveryZone.findFirst({
      where: {
        country: country,
        state: resolvedState,
        city: resolvedCity,
      },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Delivery zone for ${resolvedCity}, ${resolvedState} already exists`,
      });
    }

    const zone = await prisma.deliveryZone.create({
      data: {
        country: country,
        state: resolvedState,
        city: resolvedCity,
        pincodes: cityCoverage && !isAllPincodes ? cleanedPincodes : [],
        isActive: isActive !== undefined ? isActive : true,
        isAllPincodes: cityCoverage ? (isAllPincodes || false) : true,
        isAllCitiesInState,
        isAllStatesInCountry,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Delivery zone created successfully',
      data: zone,
    });
  } catch (error) {
    console.error('Error creating delivery zone:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create delivery zone',
      error: error.message,
    });
  }
};

// ============================================
// ADMIN: Get all delivery zones
// ============================================
const getAllDeliveryZones = async (req, res) => {
  try {
    const zones = await prisma.deliveryZone.findMany({
      orderBy: [
        { state: 'asc' },
        { city: 'asc' },
      ],
    });

    return res.status(200).json({
      success: true,
      data: zones,
    });
  } catch (error) {
    console.error('Error fetching delivery zones:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch delivery zones',
      error: error.message,
    });
  }
};

// ============================================
// ADMIN: Update a delivery zone
// ============================================
const updateDeliveryZone = async (req, res) => {
  try {
    const { id } = req.params;
    const { country, state, city, pincodes, isActive, isAllPincodes, coverageType } = req.body;

    const existing = await prisma.deliveryZone.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Delivery zone not found',
      });
    }

    const updateData = {};

    if (country !== undefined) updateData.country = country;
    if (state !== undefined) updateData.state = state;
    if (city !== undefined) updateData.city = city;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isAllPincodes !== undefined) updateData.isAllPincodes = isAllPincodes;
    if (pincodes !== undefined) {
      updateData.pincodes = pincodes
        .map(p => p.toString().trim())
        .filter(p => p.length > 0);
    }

    if (coverageType) {
      const isAllStatesInCountry = coverageType === 'country';
      const isAllCitiesInState = coverageType === 'state';
      const cityCoverage = coverageType === 'city';

      updateData.isAllStatesInCountry = isAllStatesInCountry;
      updateData.isAllCitiesInState = isAllCitiesInState;
      updateData.isAllPincodes = cityCoverage ? (isAllPincodes || false) : true;

      if (isAllStatesInCountry) {
        updateData.state = '*';
        updateData.city = '*';
        updateData.pincodes = [];
      } else if (isAllCitiesInState) {
        updateData.city = '*';
        updateData.pincodes = [];
      }
    }

    const zone = await prisma.deliveryZone.update({
      where: { id },
      data: updateData,
    });

    return res.status(200).json({
      success: true,
      message: 'Delivery zone updated successfully',
      data: zone,
    });
  } catch (error) {
    console.error('Error updating delivery zone:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update delivery zone',
      error: error.message,
    });
  }
};

// ============================================
// ADMIN: Delete a delivery zone
// ============================================
const deleteDeliveryZone = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.deliveryZone.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Delivery zone not found',
      });
    }

    await prisma.deliveryZone.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: 'Delivery zone deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting delivery zone:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete delivery zone',
      error: error.message,
    });
  }
};

// ============================================
// PUBLIC: Get list of countries with active zones
// ============================================
const getAvailableCountries = async (req, res) => {
  try {
    const zones = await prisma.deliveryZone.findMany({
      where: { isActive: true },
      select: { country: true },
      distinct: ['country'],
    });

    const countries = zones.map(z => z.country);

    return res.status(200).json({
      success: true,
      data: countries,
    });
  } catch (error) {
    console.error('Error fetching available countries:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch available countries',
      error: error.message,
    });
  }
};

// ============================================
// PUBLIC: Check if a pincode is serviceable
// ============================================
const checkPincode = async (req, res) => {
  try {
    const { pincode } = req.params;
    const { country } = req.query;

    if (!pincode || pincode.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Pincode is required',
      });
    }

    const cleanPincode = pincode.trim();
    let resolvedCity = '';
    let resolvedState = '';
    let resolvedCountry = country || 'India';
    const axios = require('axios');

    // 1. PRIMARY: Use Indian Postal API for Indian pincodes (100% accurate official data)
    const isIndianPincode = /^\d{6}$/.test(cleanPincode) && (!country || country.toLowerCase() === 'india');
    
    if (isIndianPincode) {
      try {
        const postalResponse = await axios.get(`https://api.postalpincode.in/pincode/${cleanPincode}`, { timeout: 5000 });
        if (postalResponse.data?.[0]?.Status === 'Success' && postalResponse.data[0].PostOffice?.length > 0) {
          const postOffice = postalResponse.data[0].PostOffice[0];
          resolvedCity = postOffice.District;
          resolvedState = postOffice.State;
          resolvedCountry = 'India';
          console.log(`Indian Postal API resolved: ${cleanPincode} → ${resolvedCity}, ${resolvedState}`);
        }
      } catch (postalError) {
        console.error('Indian Postal API Error:', postalError.message);
      }
    }

    // 2. ALSO use Groq AI (fills gaps if postal API missed data, or handles non-Indian pincodes)
    if (process.env.GROQ_API_KEY) {
      try {
        const Groq = require("groq-sdk");
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        
        const completion = await groq.chat.completions.create({
          messages: [
            { 
              role: "user", 
              content: `What is the exact District/City and State for pincode "${cleanPincode}" in ${resolvedCountry}? 
              Return ONLY a JSON object: {"city": "DistrictOrCityName", "state": "StateName", "country": "CountryName"}`
            }
          ],
          model: "llama-3.3-70b-versatile",
          response_format: { type: "json_object" },
        });

        if (completion.choices?.[0]?.message?.content) {
          const resolved = JSON.parse(completion.choices[0].message.content);
          // Only fill gaps — Indian Postal API data takes priority
          if (!resolvedCity && resolved.city) resolvedCity = resolved.city;
          if (!resolvedState && resolved.state) resolvedState = resolved.state;
          if (!resolvedCountry && resolved.country) resolvedCountry = resolved.country;
          console.log(`Groq AI resolved: ${cleanPincode} → ${resolvedCity}, ${resolvedState}`);
        }
      } catch (aiError) {
        console.error('AI Pincode Resolution Error:', aiError);
      }
    }

    // Check serviceability with the resolved data
    const { serviceable, zone } = await isPincodeServiceable(cleanPincode, resolvedCountry, resolvedCity, resolvedState);

    if (serviceable && zone) {
      if (zone.isAllStatesInCountry) {
        return res.status(200).json({
          success: true,
          serviceable: true,
          message: `Delivery available across ${zone.country}`,
          data: {
            city: resolvedCity,
            state: resolvedState,
            country: zone.country,
            pincode: cleanPincode,
          },
        });
      }

      if (zone.isAllCitiesInState) {
        return res.status(200).json({
          success: true,
          serviceable: true,
          message: `Delivery available across ${zone.state}`,
          data: {
            city: resolvedCity,
            state: zone.state,
            country: zone.country,
            pincode: cleanPincode,
          },
        });
      }

      return res.status(200).json({
        success: true,
        serviceable: true,
        message: `Delivery available in ${zone.city}, ${zone.state}`,
        data: {
          city: zone.city,
          state: zone.state,
          country: zone.country,
          pincode: cleanPincode,
        },
      });
    }

    // Even if not serviceable, return resolved location data for auto-fill
    return res.status(200).json({
      success: true,
      serviceable: false,
      message: resolvedCity
        ? `We do not deliver to ${resolvedCity}, ${resolvedState} yet`
        : 'We do not deliver to this location yet',
      data: resolvedCity ? {
        city: resolvedCity,
        state: resolvedState,
        country: resolvedCountry,
        pincode: cleanPincode,
      } : null,
    });
  } catch (error) {
    console.error('Error checking pincode:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check pincode',
      error: error.message,
    });
  }
};

// ============================================
// ADMIN: Discover/Verify pincodes using AI (Groq)
// ============================================
const discoverPincodesAI = async (req, res) => {
  try {
    const { city, state, country } = req.body;

    if (!city || !state || !country) {
      return res.status(400).json({
        success: false,
        message: 'City, State and Country are required for AI discovery',
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'AI service (Groq) is not configured in the backend',
      });
    }

    const Groq = require("groq-sdk");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const prompt = `You are a postal data expert. List ALL official 6-digit postal pincodes for the city "${city}" in the state "${state}", ${country}. 
    Include ALL valid delivery pincodes for this urban area.
    Only include pincodes that strictly belong to "${city}". 
    Exclude pincodes from neighboring districts or similarly named locations in other states.
    
    Return the result ONLY as a JSON object in this format:
    {
      "city": "${city}",
      "state": "${state}",
      "pincodes": ["pincode1", "pincode2", ...],
      "count": 0
    }`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    if (!completion.choices?.[0]?.message?.content) {
        throw new Error("No response content from AI");
    }

    const aiResponse = JSON.parse(completion.choices[0].message.content);

    return res.status(200).json({
      success: true,
      data: aiResponse,
    });
  } catch (error) {
    console.error('Error in AI pincode discovery:', error);
    return res.status(500).json({
      success: false,
      message: 'AI discovery failed',
      error: error.message,
    });
  }
};

// ============================================
// PUBLIC: Detect location by coordinates (Google Maps + AI fallback)
// ============================================
const detectLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const axios = require('axios');

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and Longitude are required',
      });
    }

    let resolved = {
      city: '',
      state: '',
      country: '',
      pincode: ''
    };

    // 1. Try Google Maps Geocoding first (Most accurate)
    if (process.env.GOOGLE_MAPS_API_KEY) {
      try {
        // Request only specific result types for better accuracy
        const response = await axios.get(
          `https://maps.googleapis.com/maps/api/geocode/json`,
          {
            params: {
              latlng: `${lat},${lng}`,
              key: process.env.GOOGLE_MAPS_API_KEY,
              result_type: 'street_address|premise|sublocality|locality', // Most specific types
              language: 'en'
            },
            timeout: 8000
          }
        );
        
        if (response.data.status === 'OK' && response.data.results.length > 0) {
          console.log(`🗺️ Google Maps returned ${response.data.results.length} results for (${lat}, ${lng})`);
          
          // Use the FIRST result (most accurate for the given coordinates)
          const firstResult = response.data.results[0];
          console.log(`📍 Using result type: ${firstResult.types.join(', ')}`);
          console.log(`📍 Formatted address: ${firstResult.formatted_address}`);
          
          const addressComponents = firstResult.address_components;
          
          addressComponents.forEach(component => {
            const types = component.types;
            
            // Priority order for area/neighborhood
            if (!resolved.area) {
              if (types.includes('sublocality_level_2')) {
                resolved.area = component.long_name;
              } else if (types.includes('sublocality_level_1')) {
                resolved.area = component.long_name;
              } else if (types.includes('neighborhood')) {
                resolved.area = component.long_name;
              }
            }

            // City/District
            if (!resolved.city) {
              if (types.includes('locality')) {
                resolved.city = component.long_name;
              } else if (types.includes('administrative_area_level_2')) {
                resolved.city = component.long_name;
              }
            }
            
            // State
            if (!resolved.state && types.includes('administrative_area_level_1')) {
              resolved.state = component.long_name;
            }
            
            // Country
            if (!resolved.country && types.includes('country')) {
              resolved.country = component.long_name;
            }
            
            // Pincode - use the FIRST one found
            if (!resolved.pincode && types.includes('postal_code')) {
              resolved.pincode = component.long_name;
            }
          });
          
          console.log(`📍 Google Maps resolved: Pincode=${resolved.pincode}, Area=${resolved.area}, City=${resolved.city}, State=${resolved.state}`);
        } else {
          console.log(`⚠️ Google Maps API status: ${response.data.status}`);
        }
      } catch (googleError) {
        console.error('Google Maps Geocoding Error:', googleError.message);
      }
    }

    // 2. For Indian locations, verify pincode with Indian Postal API (Official Government Data)
    if (resolved.pincode && resolved.country === 'India' && /^\d{6}$/.test(resolved.pincode)) {
      try {
        console.log(`🇮🇳 Verifying Indian pincode ${resolved.pincode} with Postal API...`);
        const postalResponse = await axios.get(
          `https://api.postalpincode.in/pincode/${resolved.pincode}`,
          { timeout: 5000 }
        );
        
        if (postalResponse.data?.[0]?.Status === 'Success' && postalResponse.data[0].PostOffice?.length > 0) {
          const postOffice = postalResponse.data[0].PostOffice[0];
          
          // Use official postal data for city and state (more accurate)
          resolved.city = postOffice.District;
          resolved.state = postOffice.State;
          resolved.country = 'India';
          
          // Get the area/locality name from postal data
          const officeName = postOffice.Name;
          if (officeName && !officeName.toLowerCase().includes('head post office')) {
            resolved.area = officeName;
          }
          
          console.log(`✅ Indian Postal API verified: ${resolved.pincode} → ${resolved.area || ''} ${resolved.city}, ${resolved.state}`);
        } else {
          console.log(`⚠️ Indian Postal API could not verify pincode ${resolved.pincode}`);
        }
      } catch (postalError) {
        console.error('Indian Postal API Error:', postalError.message);
      }
    }

    // 3. Fallback to Groq ONLY if we're missing critical data (especially pincode)
    if (!resolved.pincode && process.env.GROQ_API_KEY) {
      try {
        console.log('🤖 Using Groq AI fallback to find pincode...');
        const Groq = require("groq-sdk");
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

        const prompt = `You are a geolocation expert. Given the coordinates latitude: ${lat}, longitude: ${lng}, identify the EXACT 6-digit Pincode (Postal Code) for this precise location.
        ${resolved.city ? `The location is in ${resolved.city}` : ''}
        ${resolved.state ? `, ${resolved.state}` : ''}
        ${resolved.country ? `, ${resolved.country}` : ''}.
        
        Return the result ONLY as a JSON object in this format:
        {
          "pincode": "6DigitPincode",
          "city": "CityName",
          "state": "StateName",
          "country": "CountryName",
          "area": "Neighborhood or Area Name"
        }`;

        const completion = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.1,
          response_format: { type: "json_object" }
        });

        if (completion.choices?.[0]?.message?.content) {
          const aiResolved = JSON.parse(completion.choices[0].message.content);
          
          // Only fill missing data, don't overwrite Google Maps data
          if (!resolved.pincode && aiResolved.pincode) {
            resolved.pincode = aiResolved.pincode;
            console.log(`🤖 Groq AI provided pincode: ${resolved.pincode}`);
          }
          if (!resolved.city && aiResolved.city) resolved.city = aiResolved.city;
          if (!resolved.state && aiResolved.state) resolved.state = aiResolved.state;
          if (!resolved.country && aiResolved.country) resolved.country = aiResolved.country;
          if (!resolved.area && aiResolved.area) resolved.area = aiResolved.area;
        }
      } catch (aiError) {
        console.error('Groq Geocoding Fallback Error:', aiError);
      }
    }

    if (!resolved.pincode) {
      console.log('❌ Failed to resolve pincode from coordinates');
      return res.status(200).json({
        success: false,
        serviceable: false,
        message: "Could not detect pincode from your location",
        data: null
      });
    }

    console.log(`✅ Final resolved data: Pincode=${resolved.pincode}, Area=${resolved.area}, City=${resolved.city}, State=${resolved.state}, Country=${resolved.country}`);
    
    // Check serviceability for the resolved location
    const { serviceable, zone } = await isPincodeServiceable(
      resolved.pincode, 
      resolved.country, 
      resolved.city, 
      resolved.state
    );

    return res.status(200).json({
      success: true,
      serviceable: serviceable,
      message: serviceable 
        ? `Delivery available in ${resolved.area ? resolved.area + ', ' : ''}${resolved.city}` 
        : `We do not deliver to ${resolved.city} yet`,
      data: resolved
    });

  } catch (error) {
    console.error('Error in location detection:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to detect location',
      error: error.message,
    });
  }
};

module.exports = {
  createDeliveryZone,
  getAllDeliveryZones,
  updateDeliveryZone,
  deleteDeliveryZone,
  getAvailableCountries,
  checkPincode,
  discoverPincodesAI,
  detectLocation,
};
