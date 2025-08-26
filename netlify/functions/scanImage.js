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

    // --- NEW, MOST ROBUST LOGIC: Proximity matching with removal ---
    
    // 1. Filter entities into separate lists
    const loanNoEntities = entities.filter(e => e.type === 'LoanNo');
    let principalEntities = entities.filter(e => e.type === 'Principal');
    let dateEntities = entities.filter(e => e.type === 'Date');

    // 2. Sort the primary "anchor" entity (LoanNo) from top to bottom
    const sortedLoanNos = loanNoEntities.sort((a, b) => getCenterY(a) - getCenterY(b));
    
    const loans = [];
    
    // 3. For each LoanNo, find the closest Principal and Date
    for (const loanNoEntity of sortedLoanNos) {
      const loanNoCenterY = getCenterY(loanNoEntity);
      let closestPrincipal = null;
      let closestDate = null;
      let principalIndex = -1;
      let dateIndex = -1;
      let minPrincipalDist = Infinity;
      let minDateDist = Infinity;

      // Find the closest available principal
      principalEntities.forEach((p, index) => {
        const dist = Math.abs(getCenterY(p) - loanNoCenterY);
        if (dist < minPrincipalDist) {
          minPrincipalDist = dist;
          closestPrincipal = p;
          principalIndex = index;
        }
      });

      // Find the closest available date
      dateEntities.forEach((d, index) => {
        const dist = Math.abs(getCenterY(d) - loanNoCenterY);
        if (dist < minDateDist) {
          minDateDist = dist;
          closestDate = d;
          dateIndex = index;
        }
      });

      // 4. If a close match is found, create the loan and REMOVE the matched items
      const Y_THRESHOLD = 0.05; // A threshold of 5% of the page height
      if (closestPrincipal && minPrincipalDist < Y_THRESHOLD && 
          closestDate && minDateDist < Y_THRESHOLD) {
        
        loans.push({
          no: loanNoEntity.mentionText,
          principal: closestPrincipal.mentionText,
          date: closestDate.mentionText
        });

        // Remove the used entities so they can't be matched again
        principalEntities.splice(principalIndex, 1);
        dateEntities.splice(dateIndex, 1);
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
