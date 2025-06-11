// --- START OF FILE index.js ---
require('dotenv').config(); // Load environment variables once at the top

const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const connectDB = require('./models/db'); // Assuming './models/db.js' exists and exports connectDB function
const authRouter = require('./Routes/AuthRouter'); // Assuming './routes/AuthRouter.js' exists

const app = express();
const PORT = process.env.PORT || 8080; // Use a single port, defaulting to 8080

// --- Gemini API Configuration ---
const apiKey = process.env.GEMINI_API_KEY;
let model; // Declare model here to be accessible in the route and for startup checks

if (!apiKey) {
    console.error("CRITICAL ERROR: GEMINI_API_KEY is not set in the .env file. The /api/ask endpoint will not work.");
    // Depending on requirements, you might want to exit if the API key is absolutely essential:
    // process.exit(1);
} else {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); // Or your preferred model
        console.log("Gemini AI Model initialized successfully.");
    } catch (error) {
        console.error("Error initializing GoogleGenerativeAI. Please check your API key and Google Cloud project permissions:", error.message);
        // Model will remain undefined, and the /api/ask route will fail gracefully.
    }
}

// --- Middleware ---
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // To parse JSON request bodies
app.use(express.static('public')); // Serve static files from the 'public' directory (if any)

// --- Database Connection ---
// Call connectDB if it's truly needed for this server instance.
// If AuthRouter handles its own DB connection or if DB is not needed for /api/ask, adjust accordingly.
connectDB();

// --- Routes ---
app.use('/api/auth', authRouter); // Authentication routes

// Gemini Chat API Endpoint for '/api/ask'
app.post('/api/ask', async (req, res, next) => {
    if (!model) {
        console.error("Attempted to call /api/ask, but Gemini model is not initialized (check API key and startup logs).");
        return res.status(503).json({ error: 'Gemini service is unavailable due to a configuration error. Please check server logs.' });
    }

    const { question, chatHistory } = req.body;

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    try {
        // Format chat history for the Gemini API
        // Frontend sends: [{ role: 'user'/'bot', message: '...' }]
        // Gemini expects: [{ role: 'user'/'model', parts: [{ text: '...' }] }]
        const geminiFormattedHistory = (chatHistory || []).map(msg => ({
            role: msg.role === 'bot' ? 'model' : msg.role, // Convert 'bot' to 'model'
            parts: [{ text: msg.message }],
        }));

        const chat = model.startChat({
            history: geminiFormattedHistory,
            // Optional: Add generationConfig if needed
            // generationConfig: {
            //   maxOutputTokens: 200,
            //   temperature: 0.7,
            // },
        });

        const result = await chat.sendMessage(question);
        const response = result.response;
        const text = await response.text();

        console.log(`Gemini response: ${text.substring(0, 100)}...`); // Log snippet of response
        res.json({ answer: text });

    } catch (error) {
        console.error('Error calling Gemini API:', error.message || error);
        if (error.message) {
            if (error.message.includes('API key not valid') || (error.status && error.status === 403)) {
                return res.status(401).json({ error: 'Invalid API Key or insufficient permissions. Please check your .env file and Google Cloud Console.' });
            } else if (error.message.includes('quota') || (error.status && error.status === 429)) {
                return res.status(429).json({ error: 'API Quota exceeded. Please check your Google Cloud Console.' });
            } else if (error.message.includes('[GoogleGenerativeAI Error]: Error fetching from') || (error.status && error.status >= 500)) {
                return res.status(502).json({ error: `Failed to communicate with Gemini service: ${error.message}` });
            } else {
                return res.status(500).json({ error: `Failed to get answer from Gemini: ${error.message}` });
            }
        } else {
           next(error);
        }
    }
});


// --- Global error handler (must be after all routes) ---
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error.' });
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (!apiKey) {
        console.warn("WARNING: GEMINI_API_KEY is not set. The /api/ask endpoint will not function.");
    } else if (!model) {
        console.warn("WARNING: Gemini AI Model failed to initialize. The /api/ask endpoint will not function. Check API key and permissions.");
    }
});