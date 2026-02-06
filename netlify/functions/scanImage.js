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
        // --- UPDATED PROMPT WITH NEW REQUIREMENTS ---
        promptText = `
        Analyze this handwritten list of loans. 
        Columns are generally: Number | Amount | Type (G/S) | Hindi Details.
        
        Return a raw JSON array (key: "loans") where each object has:
        
        1. "no": The loan number (e.g., "11", "12"). 
           - Extract only the number written.
        
        2. "principal": The amount (e.g., "25000"). Digits only.
        
        3. "type": 
           - Look for 'G' or 'S' (they might be circled OR just written plain).
           - CRITICAL RULE: If BOTH 'G' and 'S' are written (like "G/S" or "S/G"), treat it as "S".
           - Fallback: If type is unclear, look at details: "सोना" (Sona) = 'G', "चांदी" (Chandi) = 'S'.
           - Return exactly "G" or "S".
        
        4. "details": Format this string strictly based on the Type found:
           - IF TYPE IS "G": 
             Start with "Sona". Look for "भरी" (Bhari) or "आना" (Aana). 
             Format: "Sona [Number] [Unit]". 
             Examples: "Sona 4 Aana", "Sona 2 Bhari", "Sona 6.5 Aana".
             
           - IF TYPE IS "S": 
             Start with "Chandi". Look for "भरी" (Bhari). 
             Format: "Chandi [Number] Bhari".
             Examples: "Chandi 5 Bhari", "Chandi 17 Bhari".

           - Transliterate all Hindi to English: "सोना"->"Sona", "चांदी"->"Chandi", "भरी"->"Bhari", "आना"->"Aana".
           - Ignore extra index numbers or garbage text at the end.

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
