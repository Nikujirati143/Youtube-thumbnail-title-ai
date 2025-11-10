// server.js
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);

// CORS configuration: allow listed origins or all (not recommended for production)
const corsOptions = ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS } : { origin: true };
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// Rate limiter for /api/generate to avoid abuse
const generateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per windowMs
  message: { error: 'Too many requests, please wait a moment.' }
});

// Health
app.get('/api/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Main endpoint: proxy to Groq to generate metadata
app.post('/api/generate', generateLimiter, async (req, res) => {
  try {
    const { filename, language = 'hi-en', extraNotes = '' } = req.body;
    if(!filename) return res.status(400).json({ error: 'filename required' });
    if(!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured on server' });

    // Build prompt (ask model to return strict JSON)
    const humanLang = language === 'hi' ? 'Hindi' : (language === 'en' ? 'English' : 'Hindi + English mix');
    const prompt = `
You are an expert YouTube/Shorts/Instagram SEO assistant.
Create the following in ${humanLang}.
Input filename: "${filename}"
Extra notes: ${extraNotes}

Produce a JSON object ONLY with keys:
{
  "titles": ["t1","t2","t3","t4","t5"],
  "description": "long SEO optimized description (~120-220 words)",
  "hashtags": ["#...","#..."], 
  "tags": ["tag1","tag2",...]
}
Make titles short, clickable and safe (no misleading clickbait). Use keywords from filename.
`;

    // Groq API call (chat/completion-style)
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a professional content/SEO writer and produce strict JSON output.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.65,
        max_tokens: 900
      })
    });

    if(!response.ok){
      const txt = await response.text();
      console.error('Groq API error', response.status, txt);
      return res.status(502).json({ error: 'Groq API error', status: response.status, detail: txt });
    }

    const data = await response.json();
    // Attempt to extract content (compatible with chat responses)
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || null;
    if(!content) return res.status(502).json({ error: 'No content from Groq', raw: data });

    // Clean fences and attempt JSON parse
    let jsonText = content.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    let parsed = null;
    try { parsed = JSON.parse(jsonText); } catch(e) {
      // try to extract JSON substring
      const m = jsonText.match(/\{[\s\S]*\}/);
      if(m) {
        try { parsed = JSON.parse(m[0]); } catch(err) { parsed = null; }
      }
    }

    if(!parsed){
      // fallback: return raw text so frontend can display and admin can review
      return res.json({ ok: true, raw: content });
    }

    // Normalize arrays and fields
    parsed.titles = parsed.titles && Array.isArray(parsed.titles) ? parsed.titles.slice(0,10) : [];
    parsed.hashtags = parsed.hashtags && Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0,100) : [];
    parsed.tags = parsed.tags && Array.isArray(parsed.tags) ? parsed.tags.slice(0,200) : [];

    return res.json({ ok: true, result: parsed });

  } catch (err) {
    console.error('Server error', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
