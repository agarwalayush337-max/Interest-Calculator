// File: netlify/functions/scanImage.js
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

// Helper function to find the vertical center of a detected entity
const getCenterY = (entity) => {
  const vertices = entity?.pageAnchor?.pageRefs?.[0]?.boundingPoly?.normalizedVertices;
  if (!vertices || vertices.length < 2) return 0;
  return (vertices[0].y + vertices[1].y) / 2;
};

exports.handler = async function(event) {
  const { 
    GOOGLE_CREDENTIALS, 
    GCP_PROJECT_ID, 
    GCP_LOCATION, 
    GCP_PROCESSOR_ID 
  } = process.env;

  if (!GOOGLE_CREDENTIALS || !GCP_PROJECT_ID || !GCP_LOCATION || !GCP_PROCESSOR_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server is not configured for Document AI." }) };
  }

  // --- Authentication and API Call (same as your working version) ---
  const auth = new GoogleAuth({
    credentials: JSON.parse(GOOGLE_CREDENTIALS),
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;
  const apiUrl = `https://${GCP_LOCATION}-documentai.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/processors/${GCP_PROCESSOR_ID}:process`;
  const { image, mimeType } = JSON.parse(event.body);

  if (!mimeType) {
      return { statusCode: 400, body: JSON.stringify({ error: "mimeType is missing from request." }) };
  }

  const requestBody = {
    rawDocument: {
      content: image,
      mimeType: mimeType, 
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Google AI Error Response:", errorData);
      return { statusCode: response.status, body: JSON.stringify({ error: errorData.error.message }) };
    }

    const data = await response.json();
    const entities = data.document?.entities || [];

    // --- NEW LOGIC: Group entities into rows based on Y-coordinate ---
    const rows = new Map();
    const Y_THRESHOLD = 0.02; // A threshold to be considered "on the same line"

    for (const entity of entities) {
        const y = getCenterY(entity);
        let foundRow = false;

        // Check if this entity belongs to an existing row
        for (const [rowY, rowData] of rows.entries()) {
            if (Math.abs(y - rowY) < Y_THRESHOLD) {
                rowData[entity.type] = entity.mentionText;
                foundRow = true;
                break;
            }
        }
        
        // If it doesn't belong to any existing row, create a new one
        if (!foundRow) {
            rows.set(y, { [entity.type]: entity.mentionText });
        }
    }

    // Convert the map of rows into a sorted array of loan objects
    const loans = Array.from(rows.values())
      .filter(row => row.LoanNo && row.Principal && row.Date) // Only include complete rows
      .map(row => ({
        no: row.LoanNo,
        principal: row.Principal,
        date: row.Date,
      }));

    return {
      statusCode: 200,
      body: JSON.stringify({ loans: loans }), // Return an object with a "loans" array
    };
  } catch (error) {
    console.error('FATAL: Internal function error during fetch.', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error processing the document.' }),
    };
  }
};
