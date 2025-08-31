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
        // Prompt for the new search feature: only get loan numbers
        promptText = `From the provided image, extract only the loan numbers (values similar to 'A/123', 'B456', etc.). Return the data as a clean JSON array of strings. Format the 'no' field by replacing any '.',' ','-' with a '/',And if there is nothing between Alphabet And number in 'no' field then add '/'.For any loan number that starts with a letter, the digit '1', and three other digits (e.g., A1531), you must **replace** the '1' with a '/' to get a result like 'A/531'. Do not just add a slash. Provide only the raw JSON array in your response.`;
    } else {
        // Original prompt for the calculator
        promptText = `From the provided image, identify all loan entries. For each entry, extract the 'LoanNo', 'Principal', and 'Date'. Return the result as a clean JSON array of objects where each object has the keys "no", "principal", and "date".Format the 'Date' field into a 'DD/MM/YYYY' string. if a loan number starts with a letter followed immediately by the digit '1' and TWO other digits (e.g., A1531, A1780, A1872), you must **replace** the '1' with a '/' to get a result like 'A/531, A/780, A/872'. Format the 'no' field by replacing any '.',' ','-' with a '/',And if there is nothing between Alphabet And number in 'no' field then add '/'. Do not just add a slash.Do not include any text, explanations, or markdown formatting in your response, only the raw JSON array.`;
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
