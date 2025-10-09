require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const connectDB = require('./models/db'); 
const authRouter = require('./Routes/AuthRouter'); 

const app = express();
const PORT = process.env.PORT || 8080; 
const apiKey = process.env.GEMINI_API_KEY;
let model;

if (!apiKey) {
    console.error("CRITICAL ERROR: GEMINI_API_KEY is not set in the .env file. The /api/ask endpoint will not work.");
 
} else {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
    
        model = genAI.getGenerativeModel({ model: "gemini-pro-latest" });
        console.log("Gemini AI Model initialized successfully.");
    } catch (error) {
        console.error("Error initializing GoogleGenerativeAI. Please check your API key and Google Cloud project permissions:", error.message);
         }
}

app.use(cors()); 
app.use(express.json()); 
app.use(express.static('public')); 
connectDB();

app.use('/api/auth', authRouter); 

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
        const geminiFormattedHistory = (chatHistory || []).map(msg => ({
            role: msg.role === 'bot' ? 'model' : msg.role, 
            parts: [{ text: msg.message }],
        }));

        const chat = model.startChat({
            history: geminiFormattedHistory,
           
        });

        const result = await chat.sendMessage(question);
        const response = result.response;
        const text = await response.text();

        console.log(`Gemini response: ${text.substring(0, 100)}...`); 
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


app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (!apiKey) {
        console.warn("WARNING: GEMINI_API_KEY is not set. The /api/ask endpoint will not function.");
    } else if (!model) {
        console.warn("WARNING: Gemini AI Model failed to initialize. The /api/ask endpoint will not function. Check API key and permissions.");
    }
});