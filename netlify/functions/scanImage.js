// File: netlify/functions/scanImage.js
const fetch = require('node-fetch');

// This function finds all matches for a pattern (regex) in a block of text
const findAllMatches = (text, regex) => {
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      text: match[0].trim(),
      index: match.index
    });
  }
  return matches;
};

exports.handler = async function(event) {
  const { GOOGLE_VISION_API_KEY } = process.env;

  if (!GOOGLE_VISION_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Google Vision API key is not configured." }) };
  }

  const apiUrl = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;
  const { image } = JSON.parse(event.body);

  const requestBody = {
    requests: [
      {
        image: { content: image },
        features: [{ type: 'TEXT_DETECTION' }],
      },
    ],
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Google AI Error Response:", errorData);
      return { statusCode: response.status, body: JSON.stringify({ error: errorData.error.message }) };
    }

    const data = await response.json();
    const fullText = data.responses[0]?.fullTextAnnotation?.text;

    if (!fullText) {
      return { statusCode: 200, body: JSON.stringify({ loans: [] }) };
    }
    
    // --- NEW PARSING LOGIC TO FIND MULTIPLE ENTRIES ---
    // Define the patterns (Regular Expressions) to find our data
    const loanNoRegex = /[A-Z]\.\d{3,}/g;
    const principalRegex = /\b\d{4,}\b/g; // A number with 4 or more digits
    const dateRegex = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g;

    // Find all potential candidates for each type
    const loanNoCandidates = findAllMatches(fullText, loanNoRegex);
    const principalCandidates = findAllMatches(fullText, principalRegex);
    const dateCandidates = findAllMatches(fullText, dateRegex);
    
    const loans = [];

    // For each LoanNo found, find the closest Principal and Date
    for (const loanNo of loanNoCandidates) {
      let closestPrincipal = null;
      let closestDate = null;
      let minPrincipalDist = Infinity;
      let minDateDist = Infinity;

      // Find the closest principal based on text position
      for (const principal of principalCandidates) {
        const dist = Math.abs(principal.index - loanNo.index);
        if (dist < minPrincipalDist) {
          minPrincipalDist = dist;
          closestPrincipal = principal;
        }
      }

      // Find the closest date based on text position
      for (const date of dateCandidates) {
        const dist = Math.abs(date.index - loanNo.index);
        if (dist < minDateDist) {
          minDateDist = dist;
          closestDate = date;
        }
      }
      
      if (closestPrincipal && closestDate) {
          loans.push({
              no: loanNo.text,
              principal: closestPrincipal.text,
              date: closestDate.text,
          });
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ loans: loans }),
    };
  } catch (error) {
    console.error('FATAL: Internal function error during fetch.', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error processing the document.' }),
    };
  }
};
