/**
 * Claude API Integration for Intelligent Title Generation
 * Uses Anthropic's Claude Haiku for fast, cost-effective title/description generation
 */

const https = require('https');

// Load API key from environment
let apiKey = process.env.ANTHROPIC_API_KEY;

// Try to load from .env file if not in environment
try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/ANTHROPIC_API_KEY=(.+)/);
    if (match) {
      apiKey = match[1].trim();
    }
  }
} catch (e) {
  // Ignore - will use fallback generation
}

/**
 * Make a request to Claude API
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string>} - Claude's response
 */
async function callClaude(prompt) {
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('No API key configured');
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(responseData);
          if (response.error) {
            reject(new Error(response.error.message));
            return;
          }
          if (response.content && response.content[0] && response.content[0].text) {
            resolve(response.content[0].text.trim());
          } else {
            reject(new Error('Unexpected response format'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(data);
    req.end();
  });
}

/**
 * Generate a punchy ticker title and clean description using Claude
 * @param {string} headline - Original article headline
 * @param {string} content - Article content/description
 * @returns {Promise<{title: string, content: string}>} - Generated title and cleaned content
 */
async function generateTickerContent(headline, content) {
  const prompt = `You are a knowledgeable Manchester United reporter writing ticker content for a Red Devils fan broadcast. You have deep knowledge of the club and write with subtle United bias, but your content is NEWS-FOCUSED and factual.

TERMINOLOGY:
- Use "United" or "the Reds" - NEVER "Man Utd" or "Manchester United"
- Old Trafford = "the Theatre of Dreams" (use sparingly)
- Keep it professional but with United perspective

CURRENT CONTEXT (January 2026):
- Manager: Michael Carrick (interim) after Amorim sacked
- Recent: Beat City 2-0 in derby
- Position: Fighting for top 4
- Owners: INEOS/Ratcliffe running football ops

KEY PLAYERS:
- Bruno Fernandes - Captain
- Kobbie Mainoo - Academy star, Napoli interested
- Amad Diallo - Breakthrough season
- Marcus Rashford - Academy product
- Lisandro Martinez - "The Butcher"
- Casemiro - Aging, likely leaving

2025 SIGNINGS: Sesko (£65m), Cunha (£60m), Mbeumo (£55m), Lammens (£12m), Dorgu (£30m)

TARGETS: Elliott Anderson (Forest, top choice), Adam Wharton (Palace), Ruben Neves

BIAS GUIDELINES:
- United interest in players = positive framing
- Players leaving = neutral unless deadwood (then good riddance)
- Rival news = factual but with United angle
- Academy players = emphasize homegrown talent
- DON'T be overly emotional or use exclamation marks
- DON'T use phrases like "we'll fight tooth and nail" or hyperbolic language
- DO report facts with subtle United-positive spin

Given this news article, provide:

1. A SHORT PUNCHY TITLE (2-3 words max, ALL CAPS) - news-style, not emotional. Examples: "REDS TARGET", "EXIT LOOMS", "FEE AGREED", "MAINOO STAYS", "CARRICK ERA", "DEAL CLOSE", "NAPOLI BID"

2. A 1-2 sentence FACTUAL summary (max 280 chars) with subtle United bias. Report the news, don't editorialize heavily. No exclamation marks. Use "United" not "we/our".

HEADLINE: ${headline}

CONTENT: ${content.substring(0, 800)}

Respond in this exact format (nothing else):
TITLE: [your title here]
SUMMARY: [your summary here]`;

  try {
    const response = await callClaude(prompt);

    // Parse the response
    const titleMatch = response.match(/TITLE:\s*(.+)/i);
    const summaryMatch = response.match(/SUMMARY:\s*(.+)/is);

    if (titleMatch && summaryMatch) {
      let title = titleMatch[1].trim().toUpperCase();
      let summary = summaryMatch[1].trim();

      // Ensure title is short
      if (title.length > 20) {
        title = title.split(' ').slice(0, 3).join(' ');
      }

      // Clean up summary
      summary = summary
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Ensure proper ending
      if (summary.length > 0 && !/[.!?]$/.test(summary)) {
        summary += '.';
      }

      return { title, content: summary };
    }

    throw new Error('Could not parse Claude response');
  } catch (error) {
    console.error('[ClaudeAPI] Error:', error.message);
    throw error;
  }
}

/**
 * Generate image search suggestions from ticker items
 * @param {Array} tickerItems - Array of ticker items with title and content
 * @returns {Promise<Array>} - Array of image search suggestions
 */
async function generateImageSuggestions(tickerItems) {
  if (!tickerItems || tickerItems.length === 0) {
    return [];
  }

  // Generate exactly ONE image suggestion per ticker item
  const itemsText = tickerItems.map((item, i) =>
    `${i + 1}. TITLE: "${item.title}" | CONTENT: "${item.content}"`
  ).join('\n\n');

  const prompt = `You are creating image search queries for a Manchester United broadcast. Current date: January 2026.

ANALYZE each ticker item and create a SPECIFIC search query for the EXACT subject mentioned:

${itemsText}

CRITICAL RULES - FOLLOW EXACTLY:

1. IDENTIFY THE MAIN SUBJECT from the content - READ THE CONTENT CAREFULLY:
   - If a SPECIFIC PLAYER NAME is mentioned (Casemiro, Mainoo, Rashford, Amass, Harry Amass, etc.) → search for THAT EXACT PLAYER
   - If MICHAEL CARRICK is mentioned → search for "Michael Carrick Manchester United 2026"
   - If a SPECIFIC MANAGER is mentioned → search for that manager
   - If about a CLUB or TRANSFER TARGET → search for that specific person/club
   - If about STADIUM/VENUE → search for that location

2. ALWAYS include "Manchester United" for United players to ensure photos show them IN THE UNITED KIT

3. ALWAYS include "2026" for RECENT high-quality photos (we are in January 2026)

4. **CRITICAL**: NEVER default to Ruben Amorim. Only use Amorim if "Amorim" is EXPLICITLY written in the ticker content. If the content mentions "Carrick" - search for CARRICK, not Amorim.

5. For player transfers/exits (like Casemiro), still show them in United kit: "Casemiro Manchester United 2026"

6. For young/academy players (Harry Amass, Kobbie Mainoo), add "Manchester United" for better results

7. For injuries/setbacks mentioning a manager, search for THAT MANAGER: "Michael Carrick Manchester United manager 2026"

8. **NEVER** use generic "Manchester United" without a specific subject - always identify WHO the article is about

REQUIRED FORMAT - Return ONLY this JSON array with EXACTLY ${tickerItems.length} items (one per ticker):
[
  {"query": "EXACT person/subject name Manchester United 2026", "context": "TICKER TITLE"}
]

READ EACH TICKER CONTENT WORD BY WORD. Find the subject. Search for THAT subject specifically.

JSON ONLY - no other text:`;

  try {
    const response = await callClaudeWithTokens(prompt, 500);

    console.log('[ClaudeAPI] Image suggestions raw response:', response.substring(0, 200));

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const suggestions = JSON.parse(jsonMatch[0]);
      console.log('[ClaudeAPI] Parsed', suggestions.length, 'image suggestions for', tickerItems.length, 'ticker items');
      // Return exactly one suggestion per ticker item
      return suggestions.slice(0, tickerItems.length);
    }

    console.log('[ClaudeAPI] No JSON array found in response');
    return [];
  } catch (error) {
    console.error('[ClaudeAPI] Image suggestion error:', error.message);
    return [];
  }
}

/**
 * Make a request to Claude API with custom max_tokens
 * @param {string} prompt - The prompt to send
 * @param {number} maxTokens - Max tokens for response
 * @returns {Promise<string>} - Claude's response
 */
async function callClaudeWithTokens(prompt, maxTokens = 150) {
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('No API key configured');
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(responseData);
          if (response.error) {
            reject(new Error(response.error.message));
            return;
          }
          if (response.content && response.content[0] && response.content[0].text) {
            resolve(response.content[0].text.trim());
          } else {
            reject(new Error('Unexpected response format'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(data);
    req.end();
  });
}

/**
 * Check if Claude API is available
 * @returns {boolean}
 */
function isAvailable() {
  return apiKey && apiKey !== 'your_api_key_here' && apiKey.length > 10;
}

module.exports = {
  generateTickerContent,
  generateImageSuggestions,
  isAvailable,
  callClaude
};
