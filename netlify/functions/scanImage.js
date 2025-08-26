// File: netlify/functions/scanImage.js
const { VertexAI } = require('@google-cloud/vertexai');

exports.handler = async function(event) {
  const { GCP_PROJECT_ID, GCP_LOCATION, GOOGLE_CREDENTIALS } = process.env;

  // Initialize Vertex AI
  const vertex_ai = new VertexAI({
    project: GCP_PROJECT_ID,
    location: GCP_LOCATION,
    credentials: JSON.parse(GOOGLE_CREDENTIALS),
  });

  // Define the model to use (Gemini 1.0 Pro Vision)
  const model = 'gemini-1.0-pro-vision-001';

  const { image, mimeType } = JSON.parse(event.body);

  // Define the parts of our request
  const imagePart = {
    inlineData: {
      mimeType: mimeType,
      data: image,
    },
  };

  const textPart = {
    text: `You are an expert at extracting financial data from handwritten notes. From the provided image, identify all loan entries. For each entry, extract the 'LoanNo', 'Principal', and 'Date'. Return the result as a clean JSON array of objects where each object has the keys "no", "principal", and "date". If you cannot find a value for a field, use null. Do not include any text, explanations, or markdown formatting in your response, only the raw JSON array.`,
  };

  // Construct the full request
  const request = {
    contents: [{ role: 'user', parts: [imagePart, textPart] }],
  };

  try {
    // Get a reference to the generative model
    const generativeModel = vertex_ai.getGenerativeModel({ model: model });

    // Send the request to the model
    const result = await generativeModel.generateContent(request);
    const response = result.response;
    
    // Extract the text and parse it as JSON
    const jsonText = response.candidates[0].content.parts[0].text;
    const loans = JSON.parse(jsonText);

    return {
      statusCode: 200,
      body: JSON.stringify({ loans: loans }),
    };
  } catch (error) {
    console.error('Gemini API Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'There was an internal error processing the document with Gemini.' }),
    };
  }
};
