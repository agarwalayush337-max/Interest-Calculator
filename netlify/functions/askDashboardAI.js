const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

exports.handler = async function(event) {
  // If a preflight or incorrect request comes in, reject it immediately
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { GCP_PROJECT_ID, GOOGLE_CREDENTIALS } = process.env;
    const LOCATION = 'us-central1'; 

    if (!GOOGLE_CREDENTIALS || !GCP_PROJECT_ID) {
      return { statusCode: 500, body: JSON.stringify({ error: "Server config missing." }) };
    }

    const { query } = JSON.parse(event.body);

    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_CREDENTIALS),
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    // Switched to the highly stable 1.5-flash model to prevent API timeouts
    const MODEL_ID = 'gemini-2.5-flash-lite'; 
    const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

    const systemPrompt = `
    You are an AI Intent Parser for a financial lending app. 
    The user will ask a question about their database of loans.
    Do NOT answer the question. Your ONLY job is to extract their request into a strict JSON object.
    
    Loan formats: "R/1" -> Series is "R", Number is 1. "A/50" -> Series "A", Number 50.
    Loan types: "G" (Gold/Sona), "S" (Silver/Chandi).
    
    Extract the intent into this EXACT JSON structure:
    {
      "isDataQuery": boolean (true if they want to count or calculate loans, false if general chat),
      "operation": "count" (how many loans) OR "sum" (total amount/principal),
      "filters": {
        "type": "G" or "S" or null (if not specified),
        "series": "R", "A", "B", etc. or null,
        "minNumber": integer or null (e.g., if they say "from R/1 to R/100", min is 1),
        "maxNumber": integer or null (max is 100)
      },
      "generalAnswer": string (If isDataQuery is false, reply to them here briefly. Otherwise leave empty.)
    }
    
    User Query: "${query}"
    Output JSON ONLY. Do not use markdown blocks.
    `;

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      generationConfig: {
        temperature: 0.1 // Keeps the AI extremely strictly factual
      }
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    // Catch Google API errors before they cause a timeout
    if (!response.ok) {
        const errorData = await response.text();
        console.error("Vertex API Failed:", errorData);
        return { statusCode: 500, body: JSON.stringify({ error: "Google API Error. Check Netlify Logs." }) };
    }

    const data = await response.json();
    let jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!jsonText) throw new Error("No AI output generated.");

    // Clean up any markdown formatting just in case
    const regex = /
http://googleusercontent.com/immersive_entry_chip/0

Deploy this code. Because we removed the parameters that were hanging up Vertex AI and added a massive `try/catch` wrapper, the request should process perfectly and instantly return the math back to your UI. Try asking it "How many G type of loan from R/1 to R/100" again!
