const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const { GCP_PROJECT_ID, GOOGLE_CREDENTIALS } = process.env;
  const LOCATION = 'us-central1'; 

  if (!GOOGLE_CREDENTIALS || !GCP_PROJECT_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server config missing." }) };
  }

  try {
    const { query, inventory, stats } = JSON.parse(event.body);

    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_CREDENTIALS),
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    const MODEL_ID = 'gemini-2.5-flash-lite'; 
    const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

    const systemPrompt = `
    You are an AI Financial Assistant built into an "Interest Calculator" app for a commodity lending business.
    The user is asking a question about their current active loans.
    
    Here is the exact state of their current dashboard metrics:
    ${JSON.stringify(stats)}
    
    Here is the array of all their active loans (G = Sona/Gold, S = Chandi/Silver):
    ${JSON.stringify(inventory)}

    Answer the user's query accurately based ONLY on this data. Be concise, direct, and helpful. Use simple markdown (bolding) if needed.
    User Query: "${query}"
    `;

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }]
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
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't analyze the data.";

    return { statusCode: 200, body: JSON.stringify({ answer: answer.replace(/\n/g, '<br>') }) };

  } catch (error) {
    console.error('AI Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal AI Error' }) };
  }
};
