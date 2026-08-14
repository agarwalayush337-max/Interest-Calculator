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

    // --- UPGRADED SYSTEM PROMPT (Syntax Crash Prevention) ---
    const systemPrompt = `
    You are an elite JavaScript data analyst for a financial loan app.
    The user has TWO JavaScript arrays available in scope:
    1. 'activeInventory': Array of currently active (given) loans. Format: { no: "R/12", principal: "50000", date: "15/04/2026", type: "G" }
    2. 'finalisedReports': Array of redeemed/closed reports. Format: { reportDate: "20/05/2026", totals: { principal: "50000", interest: "1500" }, loans: [{no: "R/12", principal: "50000", date: "15/04/2026", type: "G"}] }
    
    The user will ask a question about their data.
    Your ONLY job is to write a standalone JavaScript code block that calculates the answer and returns an HTML string formatting the result.
    
    RULES:
    1. The code must be synchronous.
    2. You MUST use 'activeInventory' when calculating current/active/given loans, and 'finalisedReports' when calculating redeemed/closed/history data.
    3. You must parse dates manually. 'date' in activeInventory is when the loan was given. 'reportDate' in finalisedReports is when the loan was redeemed.
    4. You must parse strings like 'principal' or 'totals.principal' to a Float.
    5. CRITICAL RANGE RULE: Extract the letter series and number, parse the number, and use >= and <=. NEVER use .startsWith().
    6. CRITICAL REGEX RULE: Because your output is parsed as JSON, you MUST NOT use backslash shorthands (like \\d, \\w, \\s) in Regular Expressions. Furthermore, NEVER put literal forward slashes inside regex literals. ALWAYS use [^a-zA-Z0-9]* to match the separator between the series letter and the number (e.g., the slash in R/1).
    7. The final line of your code MUST be: return \`<strong>Bot:</strong> \${yourResultVariable}\`;
    8. Output ONLY raw JSON with no markdown formatting.
    
    Format Example (Redeemed History):
    {
      "javascriptCode": "let total = 0; finalisedReports.forEach(r => total += parseFloat(r.totals.principal || 0)); return \`<strong>Bot:</strong> Total redeemed is ₹\${total}\`;"
    }

    Format Example (Complex Ranges - STRICTLY NO BACKSLASHES OR LITERAL SLASHES IN REGEX):
    {
      "javascriptCode": "let count = 0; activeInventory.forEach(l => { if(l.type === 'S') { const match = String(l.no).toUpperCase().match(/^([A-Z]+)[^a-zA-Z0-9]*([0-9]+)/); if(match && match[1] === 'R') { let num = parseInt(match[2], 10); if(num >= 100 && num <= 200) count++; } } }); return \`<strong>Bot:</strong> I found \${count} matching loans.\`;"
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

    jsonText = jsonText.replace(/\\([^"\\\/bfnrt])/g, '\\\\$1');

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
