// File: netlify/functions/scanImage.js
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

exports.handler = async function(event) {
  const { GCP_PROJECT_ID, GOOGLE_CREDENTIALS } = process.env;
  const LOCATION = 'us-central1'; // A supported region for Gemini 1.5 Flash

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

    const MODEL_ID = 'gemini-2.5-flash-lite'; // Using the latest flash model
    const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

    // --- NEW: Check for the type of scan requested ---
    const { image, mimeType, scanType } = JSON.parse(event.body);
    
    let promptText;
    if (scanType === 'loan_numbers') {
        // Updated Prompt: Asks for text AND bounding box coordinates (0-1000 scale)
        promptText = `From the provided image, identify all loan numbers (e.g., 'A/123', 'B456'). 
        Return a raw JSON array of objects. 
        Each object must have two fields: 
        1. "no": The formatted loan number string (replace '1' with '/' if 3-digit starts with it, e.g., A153 -> A/53).
        2. "box": An array of 4 integers representing the bounding box [ymin, xmin, ymax, xmax] on a scale of 0 to 1000.
        Do not include markdown formatting. Just the JSON.`;
    } else {
        // Original prompt for the calculator (unchanged)
        promptText = "From the image, extract loan entries into a raw JSON array (keys: \"no\", \"principal\", \"date\") with perfect transcription accuracy (e.g., B1680 is B/680, NOT B/1680)(e.g, D1319 IS D/319, NOT D/1319)(B1455 IS B/455, NOT B/1455)(A11005 IS A/1005); format dates to 'DD/MM/YYYY', and for the 'no' field, replace '1' with '/' for 3-digit numbers starting with it (A166->A/66) but otherwise add '/' between the letter and number (B766->B/766), also replacing any '.', ' ', or '-' with '/'." 
    }

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mimeType: mimeType, data: image } },
          { text: promptText } // Use the selected prompt
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
      const errorMessage = data?.error?.message || "Failed to call Gemini API.";
      console.error("Google AI Error Response:", errorMessage);
      return { statusCode: response.status, body: JSON.stringify({ error: errorMessage }) };
    }
    
    let jsonText = data?.candidates[0]?.content?.parts[0]?.text;
    if (!jsonText) {
      throw new Error("Could not find parsable text in Gemini's response.");
    }
    
    const regex = /```json\s*([\s\S]*?)\s*```/;
    const match = jsonText.match(regex);
    if (match) {
      jsonText = match[1];
    }
    
    // --- NEW: Return the correct JSON structure based on scan type ---
    let responseBody;
    if (scanType === 'loan_numbers') {
        const loanNumbers = JSON.parse(jsonText);
        responseBody = JSON.stringify({ loanNumbers });
    } else {
        const loans = JSON.parse(jsonText);
        responseBody = JSON.stringify({ loans });
    }

    return {
      statusCode: 200,
      body: responseBody,
    };

  } catch (error) {
    console.error('FATAL: Internal function error.', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error processing the request.' }),
    };
  }
};
