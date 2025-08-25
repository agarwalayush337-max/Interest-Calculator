// File: netlify/functions/scanImage.js
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

exports.handler = async function(event) {
  console.log('Function starting...');

  const { 
    GOOGLE_CREDENTIALS, 
    GCP_PROJECT_ID, 
    GCP_LOCATION, 
    GCP_PROCESSOR_ID 
  } = process.env;

  if (!GOOGLE_CREDENTIALS || !GCP_PROJECT_ID || !GCP_LOCATION || !GCP_PROCESSOR_ID) {
    console.error('ERROR: Server environment variables are not configured.');
    return { statusCode: 500, body: JSON.stringify({ error: "Server is not configured for Document AI." }) };
  }

  console.log('Authenticating with Google...');
  const auth = new GoogleAuth({
    credentials: JSON.parse(GOOGLE_CREDENTIALS),
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;
  console.log('Authentication successful.');

  const apiUrl = `https://documentai.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/processors/${GCP_PROCESSOR_ID}:process`;

  const { image, mimeType } = JSON.parse(event.body);

  if (!mimeType) {
      console.error('ERROR: mimeType is missing from request body.');
      return { statusCode: 400, body: JSON.stringify({ error: "mimeType is missing from request." }) };
  }

  const requestBody = {
    rawDocument: {
      content: image,
      mimeType: mimeType, 
    },
  };

  // --- DETAILED LOGGING BEFORE THE API CALL ---
  console.log('--- Preparing to send request to Google ---');
  console.log('Endpoint URL:', apiUrl);
  console.log('MIME Type:', mimeType);
  console.log('Image Content (first 50 chars):', image ? image.substring(0, 50) + '...' : 'null');
  console.log('Access Token (first 20 chars):', accessToken ? accessToken.substring(0, 20) + '...' : 'null');
  console.log('Stringified Request Body:', JSON.stringify(requestBody).substring(0, 200) + '...');
  console.log('--- Sending now ---');
  // --- END OF LOGGING ---

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log('Received response from Google with status:', response.status);

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Google AI Error Response:", errorData);
      return { statusCode: response.status, body: JSON.stringify({ error: errorData.error.message }) };
    }

    const data = await response.json();

    const extractedData = {};
    const entities = data.document?.entities || [];
    for (const entity of entities) {
        extractedData[entity.type] = entity.mentionText;
    }

    console.log('Successfully processed document. Returning extracted data.');
    return {
      statusCode: 200,
      body: JSON.stringify(extractedData),
    };
  } catch (error) {
    console.error('FATAL: Internal function error during fetch.', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error processing the document.' }),
    };
  }
};
