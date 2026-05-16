const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

exports.handler = async function(event) {
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

    const MODEL_ID = 'gemini-2.5-flash-lite'; 
    const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

    // --- EXPANDED AI BRAIN ---
    const systemPrompt = `
    You are an AI Data Parser for a financial loan app.
    Your ONLY job is to convert the user's natural language question into a strict JSON query.
    Do NOT answer the question. Do NOT perform any math.
    
    You must output ONLY raw JSON in this exact format, with no markdown formatting:
    {
      "isDataQuery": true/false,
      "generalAnswer": "If it's a greeting, answer briefly. If isDataQuery is true, leave empty.",
      "operation": "count" | "sum_principal" | "sum_interest" | "avg_principal" | "avg_age" | "max_principal" | "min_principal" | "oldest_loan" | "newest_loan" | "list" | "dues" | "future_projection",
      "filters": {
        "type": "G" | "S" | null,
        "series": "A string letter like 'R' or null",
        "minNumber": number or null,
        "maxNumber": number or null,
        "daysOldMin": number or null,
        "daysOldMax": number or null
      },
      "futureDays": number or null
    }
    
    Examples:
    "average age of gold loans" -> operation: "avg_age", type: "G"
    "projection for next 6 months for series R" -> operation: "future_projection", series: "R", futureDays: 180
    "oldest silver loan" -> operation: "oldest_loan", type: "S"
    "highest loan amount from r1 to r50" -> operation: "max_principal", series: "R", minNumber: 1, maxNumber: 50
    "what will my interest be in 1 year" -> operation: "future_projection", futureDays: 360
    
    User Query: "${query}"
    `;

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      generationConfig: { temperature: 0.1 }
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
        return { statusCode: 500, body: JSON.stringify({ error: "Google API Error." }) };
    }

    const data = await response.json();
    let jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!jsonText) throw new Error("No AI output generated.");

    const regex = /```json\s*([\s\S]*?)\s*```/;
    const match = jsonText.match(regex);
    if (match) jsonText = match[1];

    return {
      statusCode: 200,
      body: JSON.stringify(JSON.parse(jsonText)),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
    };
  }
};
