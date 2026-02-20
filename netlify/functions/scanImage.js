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
        Analyze this handwritten list of loans. The format is usually "Number - Amount - Date".
        Return a raw JSON array of objects. Each object must have 4 fields:
        
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
           - Format strictly as DD/MM/YYYY.
           CRITICAL HANDWRITING RULES:
           - Writer's 2 in the MM coloumn Generally touches with The / so it looks like 4, Read it 2 only.
           - Generally if the MM is 04 It will not touch with the "/" of the Date format.
           - If The Month is 04 Twice check it it might be 02.
          

        4. "box": An array of 4 integers [ymin, xmin, ymax, xmax] on a scale of 0 to 1000. 
           - IMPORTANT: The box must cover the ENTIRE WIDTH of the row (Number + Principal + Date).

        Do not include markdown formatting. Just the JSON.`;
    } else if (scanType === 'loan_entry') {
        // --- LOGIC-FIRST PROMPT: Context Rules Over Vision ---
        promptText = `
        Analyze this handwritten list of loans. 
        Columns: Number | Amount | Type (Symbol) | Details (Hindi/English).

        Return a raw JSON array (key: "loans") by following these steps for EACH row:

        STEP 1: Transcribe the 'Details' column strictly.
           - Look for keywords: "Aana" (आना), "Ratti" (रत्ती), "Gram" (ग्राम), "Masha" (माशा), "Bhari" (भरी), or just numbers (e.g., "930").

        STEP 2: Determine "type" ('G' or 'S') based on strict rules:
           - RULE A: If details contain "Aana", "Ratti", "Gram", "Masha", "Sona" -> Type is AUTOMATICALLY 'G' (Ignore the symbol).
           - RULE B: If details contain "Bhari" or "Chandi" -> Type is AUTOMATICALLY 'S' (Ignore the symbol).
           - RULE C (Tie-Breaker): If details are ONLY numbers (e.g., "930") or unclear, look at the circled letter to decide.
           - CRITICAL: "Aana" is NEVER Silver. "Bhari" is NEVER Gold.

        STEP 3: Format the Output JSON:
           1. "no": Loan number (digits only, e.g., "46").
           2. "principal": Amount (digits only).
           3. "type": The final 'G' or 'S' decided in Step 2.
           4. "details": Format strictly based on the final Type:
              - If Type 'G': Start with "Sona". (e.g., "Sona 2 Aana", "Sona 930").
              - If Type 'S': Start with "Chandi". (e.g., "Chandi 7 Bhari").
              - Keep the numbers and units exactly as written.

        Output JSON only. No markdown.`;
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
    console.log("===== RAW AI RESPONSE =====", jsonText);
    
    const regex = /```json\s*([\s\S]*?)\s*```/;
    const match = jsonText.match(regex);
    if (match) {
      jsonText = match[1];
    }
    
    // --- NEW: Return the correct JSON structure based on scan type ---
    // --- FIXED: Return the correct JSON structure based on scan type ---
    let parsedData;
    try {
        parsedData = JSON.parse(jsonText);
    } catch (e) {
        throw new Error("Failed to parse AI response as JSON.");
    }

    let responseBody;

    if (scanType === 'loan_numbers') {
        // Handle if AI returns [ ... ] OR { "loanNumbers": [ ... ] }
        const finalArray = Array.isArray(parsedData) ? parsedData : (parsedData.loanNumbers || []);
        responseBody = JSON.stringify({ loanNumbers: finalArray });

    } else { 
        // FIX: Handle if AI returns [ ... ] OR { "loans": [ ... ] }
        let finalLoans = [];
        if (Array.isArray(parsedData)) {
            finalLoans = parsedData;
        } else if (parsedData.loans && Array.isArray(parsedData.loans)) {
            finalLoans = parsedData.loans;
        }
        responseBody = JSON.stringify({ loans: finalLoans });
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
