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

    // 1. EXTRACT THE QUERY HERE
    const { query } = JSON.parse(event.body);

    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_CREDENTIALS),
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    const MODEL_ID = 'gemini-2.5-flash-lite'; 
    const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

    // 2. DEFINE THE PROMPT HERE (So it knows what 'query' is)
    const systemPrompt = `
    You are an AI Data Parser for a financial loan app.
    Your ONLY job is to convert the user's natural language question into a strict JSON query.
    Do NOT answer the question. Do NOT perform any math.
    
    You must output ONLY raw JSON in this exact format, with no markdown formatting:
    {
      "isDataQuery": true/false,
      "generalAnswer": "If it's a greeting, answer briefly. If isDataQuery is true, leave empty.",
      "operation": "count" | "sum_principal" | "sum_interest" | "dues",
      "filters": {
        "type": "G" | "S" | null,
        "series": "A string letter like 'R' or null",
        "minNumber": number or null,
        "maxNumber": number or null
      }
    }
    
    Examples:
    "how many s type loan from r/1 to r/100" -> operation: "count", type: "S", series: "R", minNumber: 1, maxNumber: 100
    "what is my pending baki" -> operation: "dues"
    "total principal of gold loans" -> operation: "sum_principal", type: "G"
    
    User Query: "${query}"
    `;

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      generationConfig: {
        temperature: 0.1 
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

    if (!response.ok) {
        const errorData = await response.text();
        console.error("Vertex API Failed:", errorData);
        return { statusCode: 500, body: JSON.stringify({ error: "Google API Error. Check Netlify Logs." }) };
    }

    const data = await response.json();
    let jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!jsonText) throw new Error("No AI output generated.");

    // Clean up any markdown formatting just in case
    const regex = /```json\s*([\s\S]*?)\s*```/;
    const match = jsonText.match(regex);
    if (match) {
      jsonText = match[1];
    }

    const parsedData = JSON.parse(jsonText);

    return {
      statusCode: 200,
      body: JSON.stringify(parsedData),
    };

  } catch (error) {
    console.error('FATAL AI ERROR:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
