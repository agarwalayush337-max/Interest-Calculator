// File: netlify/functions/scanImage.js
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

exports.handler = async function(event) {
  const { GCP_PROJECT_ID, GCP_LOCATION, GOOGLE_CREDENTIALS } = process.env;

  if (!GOOGLE_CREDENTIALS || !GCP_PROJECT_ID || !GCP_LOCATION) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server authentication is not configured." }) };
  }

  try {
    // 1. Manually authenticate using the service account credentials
    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_CREDENTIALS),
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    // 2. Define the API endpoint and the request body
    const apiUrl = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/gemini-1.0-pro-vision:streamGenerateContent`;
    const { image, mimeType } = JSON.parse(event.body);
    
    const requestBody = {
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: mimeType, data: image } },
          { text: `You are an expert at extracting financial data from handwritten notes. From the provided image, identify all loan entries. For each entry, extract the 'LoanNo', 'Principal', and 'Date'. Return the result as a clean JSON array of objects where each object has the keys "no", "principal", and "date". If you cannot find a value for a field, use null. Do not include any text, explanations, or markdown formatting in your response, only the raw JSON array.` }
        ]
      }]
    };

    // 3. Make the direct API call with the access token
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
      return { statusCode: response.status, body: JSON.stringify({ error: errorData.error.message || "Failed to call Gemini API." }) };
    }
    
    const data = await response.json();
    
    // 4. Extract and parse the JSON response from Gemini
    const jsonText = data[0]?.candidates[0]?.content?.parts[0]?.text;
    if (!jsonText) {
      throw new Error("Could not find parsable text in Gemini's response.");
    }
    const loans = JSON.parse(jsonText);

    return {
      statusCode: 200,
      body: JSON.stringify({ loans: loans }),
    };
  } catch (error) {
    console.error('FATAL: Internal function error.', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error processing the request.' }),
    };
  }
};
