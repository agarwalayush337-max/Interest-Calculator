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
        promptText = `
        You are an expert OCR system for handwritten Indian finance ledgers.
        Analyze this image and extract a JSON array of loans. Structure: "Number - Amount - Date".

        CRITICAL HANDWRITING RULES:
        1. **Date Ambiguity**: The writer's '7' often has a long downward stroke (resembling a 'y' or '4'). If a date looks like "04/0y/24" or "04/04/24" but the stroke curves down, it is likely "07" (July).
        2. **Digit '1' vs '4'**: The digit '1' can sometimes be messy. "21" might look like "24". Look closely at the top of the digit.
        3. **Context**: Loan dates are sequential. If surrounding dates are in July (07), an ambiguous date is likely also July.

        Extraction Logic:
         1. "no": Extract the loan number.
           - Replace '1' with '/' if a 4-digit number starts with 1 (e.g., A153 -> A/53).
           - Ensure there is a '/' between the letter and number (e.g., B766 -> B/766).
           - Replace any '.', ' ', or '-' with '/' (e.g., b.579 -> B/579, d.81 -> D/81).
           - Transcription must be perfect.
        
        2. "principal": Extract the amount (e.g., "15000", "25000"). Digits only.
        
        3. "date": Date. 
           - CONTEXT: Years are usually 2023, 2024, or 2025. 
           - Date Format are Usually in DD//MM/YYYY.
           - If year is written as '23', '24', convert to '2023', '2024'.
           - FIX: If you see '04' but it could be '07', prefer '07' if the stroke is long/curved.
           - Format strictly as DD/MM/YYYY.

        4. "box": An array of 4 integers [ymin, xmin, ymax, xmax] on a scale of 0 to 1000. 
           - IMPORTANT: The box must cover the ENTIRE WIDTH of the row (Number + Principal + Date).

        Return strictly raw JSON.`;
    } else {
        // ... existing calculator prompt ...
        promptText = "From the image, extract loan entries into a raw JSON array (keys: \"no\", \"principal\", \"date\") with perfect transcription accuracy (e.g., B1680 is B/680, NOT B/1680)(e.g, D1319 IS D/319, NOT D/1319)(B1455 IS B/455, NOT B/1455)(A11005 IS A/1005); format dates to 'DD/MM/YYYY', and for the 'no' field, replace '1' with '/' for 4-digit numbers starting with it (A1666->A/666) but otherwise add '/' between the letter and number (B766->B/766), also replacing any '.', ' ', or '-' with '/'." 

 
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
