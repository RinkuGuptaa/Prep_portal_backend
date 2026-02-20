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
let genAI;

if (!apiKey) {
    console.error("CRITICAL ERROR: GEMINI_API_KEY is not set in the .env file. The /api/ask endpoint will not work.");
    console.log("Please add GEMINI_API_KEY to your .env file");
} else {
    try {
        genAI = new GoogleGenerativeAI(apiKey);
        // Use gemini-1.5-flash which has free tier quota
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        console.log("Gemini AI Model initialized successfully (gemini-1.5-flash).");
    } catch (error) {
        console.error("Error initializing GoogleGenerativeAI:", error.message);
    }
}

app.use(cors()); 
app.use(express.json()); 
app.use(express.static('public')); 
connectDB();

app.use('/api/auth', authRouter); 

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        gemini: model ? 'available' : 'unavailable',
        message: model ? 'All services running' : 'Gemini API not configured'
    });
});

app.post('/api/ask', async (req, res, next) => {
    if (!model) {
        console.error("Gemini model not initialized");
        return res.status(503).json({ 
            error: 'Gemini service is unavailable. Please check your GEMINI_API_KEY in .env file.',
            hint: 'Get a free API key from https://aistudio.google.com/app/apikey'
        });
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
            generationConfig: {
                temperature: 0.9,
                maxOutputTokens: 2048,
            }
        });

        const result = await chat.sendMessage(question);
        
        if (!result || !result.response) {
            throw new Error('Invalid response from Gemini API');
        }
        
        const text = await result.response.text();

        console.log(`Gemini response: ${text.substring(0, 100)}...`); 
        res.json({ answer: text });

    } catch (error) {
        console.error('Error calling Gemini API:', error.message);
        
        // Check for specific error types
        const errorMessage = error.message || String(error);
        
        if (errorMessage.includes('API key not valid') || errorMessage.includes('invalid_api_key') || errorMessage.includes('API_KEY_INVALID')) {
            return res.status(401).json({ 
                error: 'Invalid API Key',
                details: 'Your GEMINI_API_KEY is not valid. Please get a new one from https://aistudio.google.com/app/apikey'
            });
        } 
        else if (errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('429')) {
            return res.status(429).json({ 
                error: 'API Quota Exceeded',
                details: 'You have exceeded your Gemini API quota. Please check your Google Cloud Console for usage limits.',
                hint: 'gemini-1.5-flash has generous free tier limits. Consider upgrading your plan.'
            });
        } 
        else if (errorMessage.includes('fetch') || errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
            return res.status(502).json({ 
                error: 'Network Error',
                details: 'Failed to connect to Gemini service. Please check your internet connection.'
            });
        } 
        else if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
            return res.status(504).json({ 
                error: 'Request Timeout',
                details: 'The Gemini API request timed out. Please try again.'
            });
        }
        else {
            return res.status(500).json({ 
                error: 'Failed to get answer from Gemini',
                details: errorMessage
            });
        }
    }
});

// Retry endpoint to reinitialize Gemini model
app.post('/api/retry-gemini', async (req, res) => {
    const newApiKey = req.body.apiKey || process.env.GEMINI_API_KEY;
    
    if (!newApiKey) {
        return res.status(400).json({ 
            error: 'No API key provided',
            hint: 'Please provide an API key in the request body or set GEMINI_API_KEY in .env'
        });
    }

    try {
        genAI = new GoogleGenerativeAI(newApiKey);
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // Test the model with a simple prompt
        await model.generateContent('test');
        
        console.log("Gemini AI Model reinitialized successfully");
        res.json({ 
            success: true, 
            message: 'Gemini API reinitialized successfully',
            model: 'gemini-1.5-flash'
        });
    } catch (error) {
        console.error("Error reinitializing Gemini:", error.message);
        model = null;
        res.status(400).json({ 
            error: 'Failed to initialize Gemini API',
            details: error.message
        });
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
        console.log("Get a free API key from: https://aistudio.google.com/app/apikey");
    } else if (!model) {
        console.warn("WARNING: Gemini AI Model failed to initialize.");
    } else {
        console.log("Gemini AI is ready to use!");
    }
});
