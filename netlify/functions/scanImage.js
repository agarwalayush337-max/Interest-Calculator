// File: netlify/functions/scanImage.js
const fetch = require('node-fetch');

exports.handler = async function(event) {
  const { GOOGLE_VISION_API_KEY } = process.env;
  const API_URL = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;
  const { image } = JSON.parse(event.body);

  const requestBody = {
    requests: [
      {
        image: { content: image },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      },
    ],
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Google Vision API Error:", errorData);
      return { statusCode: response.status, body: JSON.stringify({ error: errorData.error.message }) };
    }

    const data = await response.json();
    
    // **MODIFICATION HERE**
    // Instead of just text, send the structured data (individual words and their locations)
    const annotations = data.responses[0]?.textAnnotations;
    
    // If no text is found at all, return an empty array
    if (!annotations || annotations.length === 0) {
        return {
            statusCode: 200,
            body: JSON.stringify({ words: [] }),
        };
    }

    // We skip the first annotation [0] because it's the entire text block.
    // We only want the individual words.
    const words = annotations.slice(1).map(item => ({
        text: item.description,
        bounds: item.boundingPoly.vertices
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ words: words }),
    };

  } catch (error) {
    console.error('Internal function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error.' }),
    };
  }
};
