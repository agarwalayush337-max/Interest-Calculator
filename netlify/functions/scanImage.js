// File: netlify/functions/scanImage.js

// 1. Import the 'node-fetch' library we installed.
// This is how you use external packages in a Node.js environment.
const fetch = require('node-fetch');

// 2. Define the main function handler.
// Netlify requires this specific 'exports.handler' structure.
// 'event' is an object containing all the request data from the frontend.
exports.handler = async function(event) {
  
  // 3. Securely access the API key.
  // 'process.env' is the object where Netlify places the environment variables you set up in Step 2.
  // This key is NEVER exposed to the user's browser.
  const { GOOGLE_VISION_API_KEY } = process.env;
  const API_URL = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;

  // 4. Get the image data sent from the frontend.
  // 'event.body' is the data payload. It's a string, so we must parse it into a JavaScript object.
  // We expect the object to look like: { image: "..." }
  const { image } = JSON.parse(event.body);

  // 5. Create the request body for the Google Vision API.
  // This tells Google what to do with the image.
  const requestBody = {
    requests: [
      {
        image: {
          content: image, // The base64 image data from the frontend
        },
        features: [
          {
            type: 'DOCUMENT_TEXT_DETECTION', // Use the powerful OCR for documents
          },
        ],
      },
    ],
  };

  // 6. Make the actual API call to Google Cloud Vision.
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    // Check for errors from Google's side
    if (!response.ok) {
      const errorData = await response.json();
      console.error("Google Vision API Error:", errorData);
      return { statusCode: response.status, body: JSON.stringify({ error: errorData.error.message }) };
    }

    const data = await response.json();

    // 7. Extract just the text from Google's complex response object.
    // The '?.' (optional chaining) prevents errors if the path doesn't exist.
    const text = data.responses[0]?.fullTextAnnotation?.text;

    // 8. Send the result back to your frontend.
    // The body MUST be a string, so we use JSON.stringify.
    return {
      statusCode: 200, // 200 OK
      body: JSON.stringify({ text: text || '' }), // Send the extracted text
    };
  } catch (error) {
    // Handle network errors or other issues
    console.error('Internal function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error.' }),
    };
  }
};

