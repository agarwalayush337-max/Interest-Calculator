// File: netlify/functions/scanImage.js
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

exports.handler = async function(event) {
  // 1. Get credentials and processor details from environment variables
  const { 
    GOOGLE_CREDENTIALS, 
    GCP_PROJECT_ID, 
    GCP_LOCATION, 
    GCP_PROCESSOR_ID 
  } = process.env;

  if (!GOOGLE_CREDENTIALS || !GCP_PROJECT_ID || !GCP_LOCATION || !GCP_PROCESSOR_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server is not configured for Document AI." }) };
  }

  // 2. Authenticate with Google Cloud
  const auth = new GoogleAuth({
    credentials: JSON.parse(GOOGLE_CREDENTIALS),
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;

  // 3. Construct the API endpoint URL
  const apiUrl = `https://documentai.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/processors/${GCP_PROCESSOR_ID}:process`;

  const { image } = JSON.parse(event.body);

  // 4. Create the request body for Document AI
  const requestBody = {
    rawDocument: {
      content: image,
      mimeType: 'image/jpeg', // Assuming jpeg, change if needed
    },
  };

  try {
    // 5. Call the Document AI API
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
      console.error("Document AI Error:", errorData);
      return { statusCode: response.status, body: JSON.stringify({ error: errorData.error.message }) };
    }

    const data = await response.json();

    // 6. Simplify the complex response into clean key-value pairs
    const extractedData = {};
    const entities = data.document?.entities || [];
    for (const entity of entities) {
        // entity.type is the schema label (e.g., "LoanNo")
        // entity.mentionText is the extracted value (e.g., "D.484")
        extractedData[entity.type] = entity.mentionText;
    }

    return {
      statusCode: 200,
      body: JSON.stringify(extractedData),
    };
  } catch (error) {
    console.error('Internal function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error processing the document.' }),
    };
  }
};
