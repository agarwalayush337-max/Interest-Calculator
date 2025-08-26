// File: netlify/functions/scanImage.js
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

// Helper function to find the vertical center of a detected entity
const getCenterY = (entity) => {
  const vertices = entity.pageAnchor.pageRefs[0].boundingPoly.normalizedVertices;
  if (!vertices || vertices.length < 4) return 0;
  const yCoords = vertices.map(v => v.y || 0);
  return (Math.min(...yCoords) + Math.max(...yCoords)) / 2;
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

    // --- NEW, SMARTER LOGIC: Group entities by vertical proximity ---
    const loans = [];
    const loanNoEntities = entities.filter(e => e.type === 'LoanNo');
    const principalEntities = entities.filter(e => e.type === 'Principal');
    const dateEntities = entities.filter(e => e.type === 'Date');

    for (const loanNoEntity of loanNoEntities) {
      const loanNoCenterY = getCenterY(loanNoEntity);
      let closestPrincipal = null;
      let closestDate = null;
      let minPrincipalDist = Infinity;
      let minDateDist = Infinity;

      // Find the principal on the same line
      for (const principalEntity of principalEntities) {
        const dist = Math.abs(getCenterY(principalEntity) - loanNoCenterY);
        if (dist < minPrincipalDist) {
          minPrincipalDist = dist;
          closestPrincipal = principalEntity;
        }
      }

      // Find the date on the same line
      for (const dateEntity of dateEntities) {
        const dist = Math.abs(getCenterY(dateEntity) - loanNoCenterY);
        if (dist < minDateDist) {
          minDateDist = dist;
          closestDate = dateEntity;
        }
      }

      // We consider it a match if the items are vertically very close
      // and we haven't used them before. This threshold may need adjustment.
      const Y_THRESHOLD = 0.05; // 5% of the page height
      if (closestPrincipal && minPrincipalDist < Y_THRESHOLD && 
          closestDate && minDateDist < Y_THRESHOLD) {
        loans.push({
          no: loanNoEntity.mentionText,
          principal: closestPrincipal.mentionText,
          date: closestDate.mentionText
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
