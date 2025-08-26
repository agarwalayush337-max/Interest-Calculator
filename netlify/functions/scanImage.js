// File: netlify/functions/scanImage.js
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

// Helper function to find the vertical center of a detected entity
const getCenterY = (entity) => {
  // Ensure we have the necessary data to avoid errors
  const vertices = entity?.pageAnchor?.pageRefs?.[0]?.boundingPoly?.normalizedVertices;
  if (!vertices || vertices.length < 2) return 0;
  // Use the first two vertices to get a stable Y-coordinate
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

    // --- NEW, MOST ROBUST LOGIC: Sort all entities first ---
    
    // 1. Filter and sort each type of entity by its vertical position (top to bottom)
    const sortedLoanNos = entities
      .filter(e => e.type === 'LoanNo')
      .sort((a, b) => getCenterY(a) - getCenterY(b));

    const sortedPrincipals = entities
      .filter(e => e.type === 'Principal')
      .sort((a, b) => getCenterY(a) - getCenterY(b));

    const sortedDates = entities
      .filter(e => e.type === 'Date')
      .sort((a, b) => getCenterY(a) - getCenterY(b));

    // 2. Now, build the loans list by taking the items in their sorted order
    const loans = [];
    const numLoans = sortedLoanNos.length; // Assume LoanNo is the primary key

    for (let i = 0; i < numLoans; i++) {
        // Check if data exists for each corresponding index
        if (sortedLoanNos[i] && sortedPrincipals[i] && sortedDates[i]) {
            loans.push({
                no: sortedLoanNos[i].mentionText,
                principal: sortedPrincipals[i].mentionText,
                date: sortedDates[i].mentionText
            });
        }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ loans: loans }),
    };
  } catch (error) {
    console.error('FATAL: Internal function error during fetch.', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error processing the document.' }),
    };
  }
};
