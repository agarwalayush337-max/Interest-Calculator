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
        promptText = `
        Analyze this handwritten list of loans.
        Columns: Number | Amount | Date (IGNORE) | Hindi Details | Circled Letter (rightmost)
        
        Return a raw JSON array of objects with exactly 4 fields:
        
        1. "no": Loan number with '/' between letter and digits.
           - If a 4-digit number starts with 1, replace that 1 with '/' (R155 -> R/155).
           - Otherwise just add '/' (R766 -> R/766).
        
        2. "principal": Numeric amount only, no commas (e.g., "110000").
        
        3. "type": Look ONLY at the circled letter at the FAR RIGHT of each row.
           
           HOW TO DISTINGUISH G vs S IN A CIRCLE:
           - Circled 'G': The letter inside has a horizontal bar/shelf stroke going inward 
             on the right side. Looks like the English letter G.
           - Circled 'S': The letter inside has two opposite curves like a snake or the 
             number 5. No horizontal bar. No gap on the right.
           - In this handwriting, S and G can look similar. If there is NO horizontal 
             inward stroke, it is S. If there IS a horizontal inward stroke, it is G.
           - Take extra time on this — it is the most critical field.
           - Output ONLY "G" or "S".
        
        4. "details":
           STEP A — Read the Hindi/Devanagari unit word carefully:
           - "भरी" or "भर" or "बरी" = Bhari
           - "आना" or "आन" = Aana  
           - "रत्ती" or "रती" = Ratti → DISCARD this word AND its preceding digit entirely
           
           CRITICAL UNIT DISTINCTION:
           - भरी (Bhari) has a distinct hook/curve at the bottom right
           - आना (Aana) starts with the vowel 'आ' which has a vertical stroke on the left
           - When unsure between भरी and आना, look for the initial 'आ' shape — 
             if absent, it is भरी
           
           STEP B — Extract primary number and unit after discarding Ratti:
           - "1 भरी" → "1 Bhari"
           - "5 भरी" → "5 Bhari"  
           - "9 भरी" → "9 Bhari"  ← NOTE: 9 and 1 look different, do not confuse them
           - "4 आना" → "4 Aana"
           - "10 आना" → "10 Aana"
           - "1 आना 3 रत्ती" → "1 Aana" (discard रत्ती part)
           
           CRITICAL NUMBER READING:
           - The digit 9 has a circular top with a descending tail going down-right
           - The digit 1 is just a single vertical stroke, sometimes with a small top serif
           - Do NOT confuse 9 with 1 under any circumstance
           
           STEP C — Format based on type:
           - type "G": "Sona [number] [unit]"   → e.g., "Sona 1 Bhari", "Sona 10 Aana"
           - type "S": "Chandi [number] [unit]" → e.g., "Chandi 5 Bhari", "Chandi 9 Bhari"
           - The unit (Bhari/Aana) comes STRICTLY from the Hindi text, NOT from the type.
           - S-type can have Bhari. G-type can have Bhari. Read the Hindi carefully.
        
        KNOWN PATTERNS IN THIS HANDWRITING:
        - Most entries in this list are G type. Be extra careful to not auto-assume G.
        - भरी is far more common than आना in this list. If unsure of unit, prefer भरी.
        - The writer's circled S can look rounded and may resemble G — look for the 
          horizontal inward bar to confirm G. No bar = S.
        
        Output raw JSON array only. No markdown, no explanation.`;
    } else {
        // ... existing calculator prompt ...
        promptText = "From the image, extract loan entries into a raw JSON array (keys: \"no\", \"principal\", \"date\") with perfect transcription accuracy (e.g., B1680 is B/680, NOT B/1680)(e.g, D1319 IS D/319, NOT D/1319)(B1455 IS B/455, NOT B/1455)(A11005 IS A/1005); format dates to 'DD/MM/YYYY', and for the 'no' field, replace '1' with '/' for 4-digit numbers starting with it (A1666->A/666) but otherwise add '/' between the letter and number (B766->B/766), also replacing any '.', ' ', or '-' with '/'. CRITICAL INSTRUCTIONS: If you only see loan numbers but no amounts or dates, extract the numbers anyway and leave \"principal\" and \"date\" as empty strings \"\". If you find absolutely nothing in the image, return []. Output JSON only. No markdown. No conversational text." 
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
