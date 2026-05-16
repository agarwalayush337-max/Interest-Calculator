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

    // --- UPGRADED SYSTEM PROMPT (Strict Range Rules) ---
    const systemPrompt = `
    You are an elite JavaScript data analyst for a financial loan app.
    The user has a JavaScript array called 'inventory'. 
    Each object in the array looks like this: { no: "R/12", principal: "50000", date: "15/04/2026", type: "G" }
    
    The user will ask a question about their data.
    Your ONLY job is to write a standalone JavaScript code block that calculates the answer and returns an HTML string formatting the result.
    
    RULES:
    1. The code must be synchronous.
    2. Assume 'inventory' is available as a variable.
    3. You must parse dates manually (format is DD/MM/YYYY).
    4. You must parse 'principal' to a Float.
    5. CRITICAL RANGE RULE: If checking a range of loan numbers (e.g., R/1 to R/100), you MUST use a Regex match to extract the letter series and the number, parse the number to an integer, and use mathematical operators (>= and <=). NEVER use .startsWith() or string matching for ranges.
    6. The final line of your code MUST be: return \`<strong>Bot:</strong> \${yourResultVariable}\`;
    7. Output ONLY raw JSON with no markdown formatting.
    
    Format Example 1 (Simple):
    {
      "javascriptCode": "let total = 0; inventory.forEach(l => total += parseFloat(l.principal)); return \`<strong>Bot:</strong> Total is ₹\${total}\`;"
    }

    Format Example 2 (Complex Ranges):
    {
      "javascriptCode": "let count = 0; inventory.forEach(l => { if(l.type === 'S') { const match = String(l.no).toUpperCase().match(/^([A-Z]+)[^\\\\w]*(\\d+)/); if(match && match[1] === 'R') { let num = parseInt(match[2], 10); if(num >= 100 && num <= 200) count++; } } }); return \`<strong>Bot:</strong> I found \${count} matching loans.\`;"
    }
    
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
