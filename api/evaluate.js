// ============================================================
//  EvalAI — AI Assignment Evaluation System
//  api/evaluate.js  →  Vercel Serverless Function
//  AI Engine: Google Gemini 1.5 Flash (FREE, no credit card)
// ============================================================

export default async function handler(req, res) {

  // ---- CORS Headers (allow your GitHub Pages site to call this) ----
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request (browser sends this before POST)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ---- Extract data from frontend request ----
  const { referenceAnswer, studentAnswer, maxMarks } = req.body;

  // ---- Validate all fields are present ----
  if (!referenceAnswer || !studentAnswer || !maxMarks) {
    return res.status(400).json({
      error: 'Missing fields. Need: referenceAnswer, studentAnswer, maxMarks'
    });
  }

  if (isNaN(maxMarks) || maxMarks < 1) {
    return res.status(400).json({ error: 'maxMarks must be a number greater than 0' });
  }

  // ---- Check API key is configured ----
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured on server.' });
  }

  // ---- Build the prompt for Gemini ----
  const prompt = `
You are an expert academic evaluator with 20 years of experience.
Your job is to evaluate a student's answer by comparing it with the reference answer (answer key).

=====================
REFERENCE ANSWER (Answer Key):
"""
${referenceAnswer.substring(0, 4000)}
"""

=====================
STUDENT ANSWER (Submission):
"""
${studentAnswer.substring(0, 4000)}
"""

=====================
MAXIMUM MARKS: ${maxMarks}

=====================
YOUR TASK:
1. Read both answers carefully
2. Compare the student's answer with the reference answer
3. Assign a fair score out of ${maxMarks}
4. Identify what the student did well (strengths)
5. Identify what concepts are missing or wrong (missing_concepts)
6. Give actionable improvement suggestions
7. Write a short overall feedback paragraph

SCORING GUIDE:
- Give full marks if student covers all key points from reference
- Deduct marks proportionally for missing or wrong concepts
- Consider partial credit for partially correct answers

=====================
RESPOND ONLY with a valid JSON object. No explanation, no markdown, no code fences.
The JSON must be exactly in this format:

{
  "score": <integer between 0 and ${maxMarks}>,
  "similarity_percentage": <integer between 0 and 100>,
  "grade": "<one of: A+ / A / B+ / B / C / D / F>",
  "strengths": [
    "<strength point 1>",
    "<strength point 2>",
    "<strength point 3>"
  ],
  "missing_concepts": [
    "<missing concept 1>",
    "<missing concept 2>",
    "<missing concept 3>"
  ],
  "suggestions": [
    "<improvement suggestion 1>",
    "<improvement suggestion 2>",
    "<improvement suggestion 3>"
  ],
  "overall_feedback": "<2 to 3 sentences summarizing the student's overall performance>"
}
`;

  try {
    // ---- Call Google Gemini API ----
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.2,       // Low temperature = consistent, accurate results
            maxOutputTokens: 1024,
            topP: 0.8,
            topK: 40
          }
        })
      }
    );

    // ---- Handle Gemini API errors ----
    if (!geminiResponse.ok) {
      const errData = await geminiResponse.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `Gemini API error: ${geminiResponse.status}`;
      console.error('Gemini API Error:', errMsg);
      return res.status(502).json({ error: errMsg });
    }

    // ---- Parse Gemini response ----
    const geminiData = await geminiResponse.json();

    // Check if Gemini returned content
    if (!geminiData.candidates || !geminiData.candidates[0]?.content?.parts?.[0]?.text) {
      return res.status(502).json({ error: 'Gemini returned empty response. Please try again.' });
    }

    const rawText = geminiData.candidates[0].content.parts[0].text;

    // Clean up any accidental markdown fences Gemini might add
    const cleaned = rawText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    // Parse JSON from AI response
    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message, '\nRaw text:', rawText);
      return res.status(502).json({ error: 'AI returned invalid format. Please try again.' });
    }

    // ---- Validate and sanitize result values ----
    result.score = Math.min(Math.max(Number(result.score) || 0, 0), maxMarks);
    result.similarity_percentage = Math.min(Math.max(Number(result.similarity_percentage) || 0, 0), 100);
    result.grade = result.grade || 'N/A';
    result.strengths = Array.isArray(result.strengths) ? result.strengths : [];
    result.missing_concepts = Array.isArray(result.missing_concepts) ? result.missing_concepts : [];
    result.suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
    result.overall_feedback = result.overall_feedback || 'Evaluation complete.';

    // ---- Send result back to frontend ----
    return res.status(200).json(result);

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}