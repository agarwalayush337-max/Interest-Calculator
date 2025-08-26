const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

exports.handler = async function(event) {
  const { GCP_PROJECT_ID, GOOGLE_CREDENTIALS } = process.env;
  const LOCATION = 'us-central1'; 
  const MODEL_ID = 'gemini-1.0-pro-vision'; // Updated model ID

  if (!GOOGLE_CREDENTIALS || !GCP_PROJECT_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server authentication is not configured." }) };
  }

  try {
    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_CREDENTIALS),
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;
    
    const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:streamGenerateContent`;

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

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMessage = data[0]?.error?.message || "Failed to call Vertex AI API.";
      console.error("Google AI Error Response:", errorMessage);
      return { statusCode: response.status, body: JSON.stringify({ error: errorMessage }) };
    }
    
    const jsonText = data[0]?.candidates[0]?.content?.parts[0]?.text;
    if (!jsonText) {
      throw new Error("Could not find parsable text in Vertex AI's response.");
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
