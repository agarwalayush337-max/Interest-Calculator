exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { key } = JSON.parse(event.body);
        
        // This process.env.DELETE_SECRET is the hidden variable in Netlify
        const actualKey = process.env.DELETE_SECRET; 

        if (key === actualKey) {
            return { statusCode: 200, body: JSON.stringify({ valid: true }) };
        } else {
            return { statusCode: 401, body: JSON.stringify({ error: "Incorrect Key" }) };
        }
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: "Server Error" }) };
    }
};
