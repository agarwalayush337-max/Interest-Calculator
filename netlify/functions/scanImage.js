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

  // --- Authentication and API Call ---
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
    
    // --- DETAILED LOGGING STARTS HERE ---
    console.log("--- STEP 1: Raw entities detected by Document AI ---");
    console.log(JSON.stringify(entities, null, 2));
    
    // --- FINAL, MOST ROBUST LOGIC: Anchor and Match ---
    
    // 1. Separate all entities by type
    const loanNoEntities = entities.filter(e => e.type === 'LoanNo');
    const principalEntities = entities.filter(e => e.type === 'Principal');
    const dateEntities = entities.filter(e => e.type === 'Date');

    const loans = [];
    const Y_THRESHOLD = 0.035; // A forgiving threshold for being "on the same line"

    // 2. Use the most reliable entity (e.g., Date) as the "anchor" to build each row
    for (const dateEntity of dateEntities) {
      const dateCenterY = getCenterY(dateEntity);
      let closestLoanNo = null;
      let closestPrincipal = null;
      let minLoanNoDist = Infinity;
      let minPrincipalDist = Infinity;

      // Find the closest LoanNo to this Date
      for (const loanNoEntity of loanNoEntities) {
        const dist = Math.abs(getCenterY(loanNoEntity) - dateCenterY);
        if (dist < minLoanNoDist) {
          minLoanNoDist = dist;
          closestLoanNo = loanNoEntity;
        }
      }

      // Find the closest Principal to this Date
      for (const principalEntity of principalEntities) {
        const dist = Math.abs(getCenterY(principalEntity) - dateCenterY);
        if (dist < minPrincipalDist) {
          minPrincipalDist = dist;
          closestPrincipal = principalEntity;
        }
      }

      // 3. If a full row is found within the threshold, create the loan object
      if (closestLoanNo && minLoanNoDist < Y_THRESHOLD &&
          closestPrincipal && minPrincipalDist < Y_THRESHOLD) {
        
        loans.push({
          no: closestLoanNo.mentionText,
          principal: closestPrincipal.mentionText,
          date: dateEntity.mentionText
        });
      }
    }
    
    // 4. Sort the final loans array from top to bottom before returning
    const sortedLoans = loans.sort((a, b) => {
        const entityA = dateEntities.find(e => e.mentionText === a.date);
        const entityB = dateEntities.find(e => e.mentionText === b.date);
        return getCenterY(entityA) - getCenterY(entityB);
    });

    console.log("\n--- STEP 2: Final complete loans after resilient grouping ---");
    console.log(JSON.stringify(sortedLoans, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({ loans: sortedLoans }),
    };
  } catch (error) {
    console.error('FATAL: Internal function error during fetch.', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error processing the document.' }),
    };
  }
};
