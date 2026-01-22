/**
 * News Scraper Module
 * Fetches Manchester United news from Stretty News RSS (primary)
 * with Daily Mail as fallback
 *
 * Uses Claude API for intelligent title/description generation when available
 */

const https = require('https');
const http = require('http');

// Claude API integration (optional, falls back to rule-based generation)
let claudeApi;
try {
  claudeApi = require('./claudeApi');
  if (claudeApi.isAvailable()) {
    console.log('[NewsScraper] Claude API available - using AI-powered title generation');
  } else {
    console.log('[NewsScraper] Claude API not configured - using rule-based generation');
    claudeApi = null;
  }
} catch (e) {
  console.log('[NewsScraper] Claude API module not found - using rule-based generation');
  claudeApi = null;
}

/**
 * Fetch HTML content from a URL
 * @param {string} url - URL to fetch
 * @returns {Promise<string>} - HTML content
 */
/**
 * Decode HTML entities
 * @param {string} text - Text with HTML entities
 * @returns {string} - Decoded text
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
      }
    };

    protocol.get(url, options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://www.dailymail.co.uk${res.headers.location}`;
        return fetchUrl(redirectUrl).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Extract headlines with URLs from Daily Mail HTML
 * @param {string} html - Raw HTML content
 * @returns {Array} - Array of headline objects with URLs
 */
function parseDailyMailHeadlines(html) {
  const headlines = [];
  const seenUrls = new Set();

  // Daily Mail uses full URLs like: href="https://www.dailymail.co.uk/sport/football/article-123/headline.html"
  // Match article links with headline text
  const linkPattern = /<a[^>]*href="(https?:\/\/www\.dailymail\.co\.uk\/sport\/[^"]*article[^"]*\.html)"[^>]*>([^<]{20,})<\/a>/gi;

  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const url = match[1];
    let text = decodeHtmlEntities(match[2].trim());

    // Skip duplicates and invalid headlines
    if (seenUrls.has(url)) continue;
    if (text.length < 25 || text.length > 400) continue;
    if (text.includes('<!') || text.includes('function')) continue;
    if (headlines.some(h => h.raw.toLowerCase() === text.toLowerCase())) continue;

    seenUrls.add(url);
    headlines.push({
      raw: text,
      url: url,
      source: 'dailymail'
    });
  }

  // Also try relative URLs: href="/sport/football/article-123/headline.html"
  const relativePattern = /<a[^>]*href="(\/sport\/[^"]*article[^"]*\.html)"[^>]*>([^<]{20,})<\/a>/gi;
  while ((match = relativePattern.exec(html)) !== null) {
    const url = 'https://www.dailymail.co.uk' + match[1];
    let text = decodeHtmlEntities(match[2].trim());

    if (seenUrls.has(url)) continue;
    if (text.length < 25 || text.length > 400) continue;
    if (text.includes('<!') || text.includes('function')) continue;
    if (headlines.some(h => h.raw.toLowerCase() === text.toLowerCase())) continue;

    seenUrls.add(url);
    headlines.push({
      raw: text,
      url: url,
      source: 'dailymail'
    });
  }

  console.log(`[NewsScraper] Found ${headlines.length} headlines with URLs`);
  return headlines.slice(0, 15);
}

/**
 * Parse Stretty News RSS feed (primary source)
 * @param {string} xml - RSS XML content
 * @returns {Array} - Array of headline objects with title, description, and URL
 */
function parseStrettyNewsRSS(xml) {
  const items = [];
  const seenTitles = new Set();

  // Match <item> blocks
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemPattern.exec(xml)) !== null) {
    const itemContent = itemMatch[1];

    // Extract title
    const titleMatch = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i.exec(itemContent);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1] || titleMatch[2] || '').trim() : '';

    // Try content:encoded first (has full content), fall back to description
    const contentMatch = /<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i.exec(itemContent);
    const descMatch = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i.exec(itemContent);

    let description = '';
    if (contentMatch && contentMatch[1]) {
      // Use content:encoded - it has the full article text
      description = contentMatch[1].trim();
    } else if (descMatch) {
      description = (descMatch[1] || descMatch[2] || '').trim();
    }

    // Clean up description - remove HTML tags and decode entities
    description = description
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    description = decodeHtmlEntities(description);

    // Extract link
    const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemContent);
    const url = linkMatch ? linkMatch[1].trim() : '';

    // Skip if no title or duplicate
    if (!title || seenTitles.has(title.toLowerCase())) continue;
    if (title.length < 20 || title.length > 300) continue;

    seenTitles.add(title.toLowerCase());

    items.push({
      raw: title,
      description: description,
      url: url,
      source: 'strettynews'
    });
  }

  console.log(`[NewsScraper] Found ${items.length} items from Stretty News RSS`);
  return items.slice(0, 15);
}

/**
 * Fetch article content and extract key information
 * @param {string} url - Article URL
 * @returns {Promise<string>} - Article summary/key points
 */
async function fetchArticleContent(url) {
  try {
    const html = await fetchUrl(url);

    // Extract article body paragraphs
    const paragraphs = [];

    // Daily Mail uses <p class="mol-para-with-font"> for article text
    const paraPattern = /<p[^>]*class="[^"]*mol-para[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = paraPattern.exec(html)) !== null && paragraphs.length < 5) {
      let text = match[1]
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      text = decodeHtmlEntities(text);

      // Filter out junk
      if (text.length > 40 &&
          !text.includes('CLICK HERE') &&
          !text.includes('Read more:') &&
          !text.includes('Mail Sport') &&
          !text.includes('Follow us') &&
          !text.startsWith('MORE:') &&
          !paragraphs.includes(text)) {
        paragraphs.push(text);
      }
    }

    if (paragraphs.length === 0) {
      return null;
    }

    // Combine first 2 paragraphs for a good summary
    let summary = paragraphs.slice(0, 2).join(' ');

    // Truncate to reasonable length - always end at sentence boundary, no ellipsis
    if (summary.length > 400) {
      const cutPoint = summary.lastIndexOf('.', 400);
      if (cutPoint > 50) {
        summary = summary.substring(0, cutPoint + 1);
      } else {
        const altCut = summary.lastIndexOf('.', 350);
        if (altCut > 50) {
          summary = summary.substring(0, altCut + 1);
        }
      }
    }

    return summary;
  } catch (error) {
    console.error(`[NewsScraper] Failed to fetch article: ${url}`, error.message);
    return null;
  }
}

/**
 * Generate a truly deductive title that captures the essence of the article
 * Analyzes the headline and content to extract the key story in 2-3 words
 * @param {string} headline - The original headline
 * @param {string} content - The article content
 * @returns {string} - A deductive title (max 20 chars)
 */
function generateWittyTitle(headline, content) {
  const text = headline + ' ' + content;
  const lower = text.toLowerCase();
  const headlineLower = headline.toLowerCase();

  // ============================================================================
  // DEDUCTIVE TITLE GENERATION
  // Instead of formulaic "NAME + ACTION", deduce what the story is actually about
  // ============================================================================

  // Extract key numbers/values from the text (transfer fees, contract lengths, etc.)
  const moneyMatch = text.match(/[£€]\s*(\d+(?:\.\d+)?)\s*(m|million|bn|billion)?/i);
  const money = moneyMatch ? moneyMatch[0].replace(/\s+/g, '') : null;

  // Extract time-related info
  const yearMatch = text.match(/(\d+)[-\s]?year/i);
  const years = yearMatch ? yearMatch[1] : null;

  // ============================================================================
  // SPECIFIC STORY PATTERNS - Check headline first for the core story
  // ============================================================================

  // RIVALRY/COMPETITION stories - when rivals are involved (only in headline for specificity)
  if (headlineLower.includes('man city') || headlineLower.includes('manchester city') || headlineLower.includes('city launch')) {
    if (lower.includes('race') || lower.includes('battle') || lower.includes('onslaught')) return 'CITY BATTLE';
    if (lower.includes('beat') || lower.includes('ahead')) return 'CITY THREAT';
    return 'CITY RIVAL';
  }

  // "THINKING ABOUT" / CONSIDERING stories
  if (headlineLower.includes('thinking') || headlineLower.includes('consider') || headlineLower.includes('weigh')) {
    if (lower.includes('move') || lower.includes('transfer')) return 'WEIGHING MOVE';
    if (lower.includes('offer')) return 'MULLING OFFER';
    return 'CONSIDERING';
  }

  // PLAYER INTERESTED stories (interested in joining despite other things)
  if (headlineLower.includes('interested in joining') || headlineLower.includes('keen to join') || headlineLower.includes('open to')) {
    return 'PLAYER KEEN';
  }

  // REJECTION/REFUSAL stories - but check if player is still interested
  if (headlineLower.includes('reject') || headlineLower.includes('refuse') || headlineLower.includes('turn down')) {
    // If they rejected OTHER offers but interested in United
    if (lower.includes('interested in joining') || lower.includes('keen')) return 'PLAYER KEEN';
    if (lower.includes('bid') || lower.includes('offer')) return 'BID REJECTED';
    if (lower.includes('contract')) return 'DEAL REJECTED';
    return 'OFFER REFUSED';
  }

  // DEPARTURE/EXIT stories - be specific about the type
  if (headlineLower.includes('leave') || headlineLower.includes('exit') || headlineLower.includes('depart')) {
    if (headlineLower.includes('confirm')) return 'EXIT CONFIRMED';
    if (lower.includes('loan')) return 'LOAN EXIT';
    if (lower.includes('free')) return 'FREE TO GO';
    if (lower.includes('permanent')) return 'SOLD';
    if (lower.includes('january') || lower.includes('window')) return 'WINTER EXIT';
    if (lower.includes('hours') || lower.includes('imminent')) return 'EXIT IMMINENT';
    return 'DEPARTURE SET';
  }

  // MICHAEL CARRICK specific (Middlesbrough manager, United legend) - check early
  if (headlineLower.includes('carrick')) {
    if (lower.includes('without') || lower.includes('miss') || lower.includes('absent')) return 'CARRICK BLOW';
    if (lower.includes('win') || lower.includes('victory')) return 'CARRICK WIN';
    return 'CARRICK NEWS';
  }

  // CONFIRMATION stories - "Just in", "Official", "Breaking"
  if (headlineLower.includes('just in') || headlineLower.includes('official:') || headlineLower.includes('confirm')) {
    if (lower.includes('leave') || lower.includes('exit') || lower.includes('depart')) return 'EXIT CONFIRMED';
    if (lower.includes('sign') || lower.includes('join')) return 'SIGNING DONE';
    if (lower.includes('deal') || lower.includes('agree')) return 'DEAL CONFIRMED';
    if (lower.includes('want') && lower.includes('leave')) return 'WANTS OUT';
    return 'BREAKING NEWS';
  }

  // TRANSFER FEE stories - use the actual number
  if (money && (lower.includes('bid') || lower.includes('offer') || lower.includes('fee') || lower.includes('price'))) {
    if (lower.includes('reject')) return `${money} REJECTED`;
    if (lower.includes('accept')) return `${money} ACCEPTED`;
    if (lower.includes('demand') || lower.includes('want') || lower.includes('price tag')) return `${money} ASKING`;
    if (lower.includes('bid') || lower.includes('offer')) return `${money} BID`;
    return `${money} DEAL`;
  }

  // CONTRACT stories - use the years if available
  if (lower.includes('contract') || lower.includes('deal')) {
    if (years && lower.includes('sign')) return `${years}YR DEAL`;
    if (lower.includes('expire') || lower.includes('run out')) return 'CONTRACT UP';
    if (lower.includes('extension') || lower.includes('new deal')) return 'NEW DEAL';
    if (lower.includes('reject')) return 'DEAL REJECTED';
    if (lower.includes('offer')) return 'DEAL OFFERED';
  }

  // INTEREST/PURSUIT stories - who wants who
  if (headlineLower.includes('interest') || headlineLower.includes('want') || headlineLower.includes('target')) {
    // Check for specific clubs interested
    if (lower.includes('barcelona') || lower.includes('barca')) return 'BARCA INTEREST';
    if (lower.includes('real madrid')) return 'REAL INTEREST';
    if (lower.includes('bayern')) return 'BAYERN INTEREST';
    if (lower.includes('psg') || lower.includes('paris')) return 'PSG INTEREST';
    if (lower.includes('juventus') || lower.includes('juve')) return 'JUVE INTEREST';
    if (lower.includes('inter') || lower.includes('milan')) return 'SERIE A CALL';
    return 'CLUBS CIRCLING';
  }

  // INJURY stories - be specific
  if (lower.includes('injur') || lower.includes('ruled out') || lower.includes('sidelined')) {
    if (lower.includes('week')) return 'WEEKS OUT';
    if (lower.includes('month')) return 'MONTHS OUT';
    if (lower.includes('season')) return 'SEASON OVER';
    if (lower.includes('return') || lower.includes('back')) return 'RETURN DATE';
    if (lower.includes('scan') || lower.includes('test')) return 'INJURY SCAN';
    return 'INJURY BLOW';
  }

  // QUOTES/STATEMENTS - extract the sentiment
  if (headlineLower.includes('says') || headlineLower.includes('reveals') || headlineLower.includes('admits') ||
      headlineLower.includes('speaks') || headlineLower.includes('claims')) {
    if (lower.includes('happy') || lower.includes('delight') || lower.includes('love')) return 'LOVING IT';
    if (lower.includes('frustrated') || lower.includes('disappoint')) return 'FRUSTRATED';
    if (lower.includes('want') && lower.includes('stay')) return 'WANTS TO STAY';
    if (lower.includes('want') && (lower.includes('leave') || lower.includes('move'))) return 'WANTS OUT';
    if (lower.includes('future')) return 'ON HIS FUTURE';
    if (lower.includes('critic') || lower.includes('slam') || lower.includes('blast')) return 'HITS BACK';
    return 'SPEAKS OUT';
  }

  // DEADLINE/TIMING stories
  if (lower.includes('deadline') || lower.includes('hours') || lower.includes('imminent')) {
    if (lower.includes('bid') || lower.includes('offer')) return 'DEADLINE BID';
    if (lower.includes('sign') || lower.includes('deal')) return 'DEAL CLOSE';
    return 'TIME RUNNING';
  }

  // RETURN/COMEBACK stories
  if (headlineLower.includes('return') || headlineLower.includes('back') || headlineLower.includes('comeback')) {
    if (lower.includes('train')) return 'BACK TRAINING';
    if (lower.includes('squad')) return 'BACK IN SQUAD';
    if (lower.includes('buy') && lower.includes('back')) return 'BUYBACK CLAUSE';
    return 'SET TO RETURN';
  }

  // COMPETITION for player
  if (lower.includes('race') || lower.includes('battle') || lower.includes('compete')) {
    if (lower.includes('arsenal')) return 'ARSENAL RACE';
    if (lower.includes('chelsea')) return 'CHELSEA RACE';
    if (lower.includes('city')) return 'CITY RACE';
    if (lower.includes('liverpool')) return 'POOL RACE';
    return 'TRANSFER RACE';
  }

  // AGREEMENT/DONE DEAL
  if (headlineLower.includes('agree') || headlineLower.includes('done') || headlineLower.includes('complete')) {
    if (lower.includes('personal') || lower.includes('terms')) return 'TERMS AGREED';
    if (lower.includes('fee')) return 'FEE AGREED';
    return 'DEAL DONE';
  }

  // STANCE/POSITION stories
  if (headlineLower.includes('stance') || headlineLower.includes('position') || headlineLower.includes('decision')) {
    if (lower.includes('sell')) return 'WILL SELL';
    if (lower.includes('keep') || lower.includes('stay')) return 'NOT FOR SALE';
    if (lower.includes('price')) return 'PRICE SET';
    return 'STANCE CLEAR';
  }

  // NEGOTIATIONS
  if (lower.includes('negotiat') || lower.includes('talks') || lower.includes('discuss')) {
    if (lower.includes('break') || lower.includes('stall')) return 'TALKS STALL';
    if (lower.includes('progress') || lower.includes('advance')) return 'TALKS PROGRESS';
    if (lower.includes('open') || lower.includes('begin')) return 'TALKS OPEN';
    return 'IN TALKS';
  }

  // LOAN specific
  if (lower.includes('loan')) {
    if (lower.includes('permanent') || lower.includes('buy')) return 'LOAN + OPTION';
    if (lower.includes('6 month') || lower.includes('six month')) return '6 MONTH LOAN';
    if (lower.includes('season')) return 'SEASON LOAN';
    if (lower.includes('agree') || lower.includes('done')) return 'LOAN AGREED';
    return 'LOAN MOVE';
  }

  // DEMANDS/REQUIREMENTS
  if (headlineLower.includes('demand') || headlineLower.includes('require') || headlineLower.includes('insist')) {
    if (money) return `${money} DEMAND`;
    if (lower.includes('play') || lower.includes('start')) return 'WANTS STARTS';
    if (lower.includes('wage') || lower.includes('salary')) return 'WAGE DEMAND';
    return 'TERMS SET';
  }

  // REPORTS/RUMORS
  if (headlineLower.includes('report') || headlineLower.includes('claim') || headlineLower.includes('emerge')) {
    // Extract what the report is actually about
    if (lower.includes('close') || lower.includes('near')) return 'DEAL CLOSE';
    if (lower.includes('interest')) return 'NEW INTEREST';
    if (lower.includes('bid')) return 'BID COMING';
  }

  // PUNDIT/LEGEND commentary - what they're saying about
  const pundits = ['rooney', 'keane', 'neville', 'scholes', 'ferdinand', 'rio', 'carragher', 'henry'];
  for (const pundit of pundits) {
    if (lower.includes(pundit)) {
      if (lower.includes('back') || lower.includes('defend')) return 'PUNDIT BACKS';
      if (lower.includes('slam') || lower.includes('blast') || lower.includes('critic')) return 'PUNDIT SLAMS';
      if (lower.includes('warn')) return 'PUNDIT WARNS';
      return 'PUNDIT VIEW';
    }
  }

  // CLUB BUSINESS/FINANCES
  if (lower.includes('finance') || lower.includes('revenue') || lower.includes('profit') || lower.includes('loss')) {
    if (lower.includes('fall') || lower.includes('drop') || lower.includes('down')) return 'FINANCES DOWN';
    if (lower.includes('rise') || lower.includes('grow') || lower.includes('up')) return 'FINANCES UP';
    return 'MONEY TALK';
  }

  // MANAGER stories
  if (lower.includes('amorim')) {
    if (lower.includes('want') && (lower.includes('sign') || lower.includes('target'))) return 'AMORIM TARGET';
    if (lower.includes('decision')) return 'BOSS DECIDES';
    if (lower.includes('plan')) return 'AMORIM PLAN';
    return 'BOSS SPEAKS';
  }

  // WINDOW/TIMING
  if (lower.includes('january') || lower.includes('summer') || lower.includes('window')) {
    if (lower.includes('priority')) return 'TOP PRIORITY';
    if (lower.includes('plan')) return 'WINDOW PLAN';
    return 'WINDOW NEWS';
  }

  // VAR/REFEREE decisions
  if (lower.includes('var') || lower.includes('referee') || lower.includes('offside')) {
    if (lower.includes('should') || lower.includes('wrong')) return 'VAR WRONG';
    if (lower.includes('correct')) return 'VAR RIGHT';
    return 'VAR DRAMA';
  }

  // ============================================================================
  // FALLBACK: Use old subject extraction for general stories
  // ============================================================================
  const subject = extractSubject(headline, headlineLower);
  const angle = determineAngle(lower);
  const sentiment = detectSentiment(lower);

  return generateTitle(subject, angle, sentiment, lower);
}

/**
 * Extract the primary subject of the story
 */
function extractSubject(text, lower) {
  // Check for specific players (current squad)
  const players = {
    'rashford': 'RASHFORD', 'marcus rashford': 'RASHFORD',
    'maguire': 'MAGUIRE', 'harry maguire': 'MAGUIRE',
    'bruno': 'BRUNO', 'fernandes': 'BRUNO',
    'mainoo': 'MAINOO', 'kobbie': 'MAINOO',
    'garnacho': 'GARNACHO', 'alejandro garnacho': 'GARNACHO',
    'hojlund': 'HOJLUND', 'højlund': 'HOJLUND', 'rasmus': 'HOJLUND',
    'amad': 'AMAD', 'diallo': 'AMAD',
    'mount': 'MOUNT', 'mason mount': 'MOUNT',
    'onana': 'ONANA', 'andre onana': 'ONANA',
    'martinez': 'MARTINEZ', 'lisandro': 'MARTINEZ', 'licha': 'MARTINEZ',
    'dalot': 'DALOT', 'diogo dalot': 'DALOT',
    'shaw': 'SHAW', 'luke shaw': 'SHAW',
    'casemiro': 'CASEMIRO',
    'antony': 'ANTONY',
    'sancho': 'SANCHO', 'jadon': 'SANCHO',
    'eriksen': 'ERIKSEN',
    'zirkzee': 'ZIRKZEE',
    'amass': 'AMASS', 'harry amass': 'AMASS',
    'diego leon': 'LEON', 'leon': 'LEON',
  };

  // Check for transfer targets
  const targets = {
    'ndidi': 'NDIDI', 'wilfred ndidi': 'NDIDI',
    'valverde': 'VALVERDE', 'federico valverde': 'VALVERDE',
    'greenwood': 'GREENWOOD', 'mason greenwood': 'GREENWOOD',
    'dorgu': 'DORGU', 'patrick dorgu': 'DORGU',
    'gyokeres': 'GYOKERES', 'viktor gyokeres': 'GYOKERES',
    'osimhen': 'OSIMHEN',
    'isak': 'ISAK',
    'oyarzabal': 'OYARZABAL',
    'casado': 'CASADO',
    'neves': 'NEVES', 'ruben neves': 'NEVES',
    'loftus-cheek': 'LOFTUS-CHEEK', 'loftus cheek': 'LOFTUS-CHEEK',
    'anderson': 'ANDERSON', 'elliot anderson': 'ANDERSON',
    'palmer': 'PALMER', 'cole palmer': 'PALMER',
    'mateta': 'MATETA', 'jean-philippe mateta': 'MATETA',
    'ugarte': 'UGARTE', 'manuel ugarte': 'UGARTE',
    'de ligt': 'DE LIGT', 'matthijs de ligt': 'DE LIGT',
    'mazraoui': 'MAZRAOUI', 'noussair mazraoui': 'MAZRAOUI',
  };

  // Check for legends/pundits
  const legends = {
    'rooney': 'ROONEY', 'wayne rooney': 'ROONEY',
    'scholes': 'SCHOLES', 'paul scholes': 'SCHOLES',
    'ferdinand': 'RIO', 'rio ferdinand': 'RIO',
    'keane': 'KEANE', 'roy keane': 'KEANE',
    'neville': 'NEVILLE', 'gary neville': 'NEVILLE',
    'carragher': 'CARRAGHER',
    'henry': 'HENRY', 'thierry': 'HENRY',
  };

  // Check for managers
  const managers = {
    'carrick': 'CARRICK', 'michael carrick': 'CARRICK',
    'amorim': 'AMORIM', 'ruben amorim': 'AMORIM',
    'ten hag': 'TEN HAG', 'erik ten hag': 'TEN HAG',
    'de zerbi': 'DE ZERBI',
    'tuchel': 'TUCHEL',
    'pochettino': 'POCHETTINO',
  };

  // Check for clubs (as subject of transfer stories)
  const clubs = {
    'barcelona': 'BARCA', 'barca': 'BARCA',
    'real madrid': 'REAL MADRID',
    'besiktas': 'BESIKTAS', 'beşiktaş': 'BESIKTAS',
    'juventus': 'JUVENTUS', 'juve': 'JUVENTUS',
    'milan': 'MILAN', 'ac milan': 'MILAN',
    'psg': 'PSG', 'paris': 'PSG',
    'bayern': 'BAYERN',
    'marseille': 'MARSEILLE',
    'norwich': 'NORWICH',
    'west ham': 'WEST HAM',
  };

  // Check for women's team
  const womens = {
    'terland': 'TERLAND', 'elisabeth terland': 'TERLAND',
    'women': 'WOMEN',
    'wsl': 'WOMEN',
  };

  // Find the FIRST mentioned subject by checking position in text
  // This ensures we get the primary subject, not just any mentioned name
  let firstMatch = { type: null, name: null, position: Infinity };

  const checkSubjects = (dict, type) => {
    for (const [key, value] of Object.entries(dict)) {
      const pos = lower.indexOf(key);
      if (pos !== -1 && pos < firstMatch.position) {
        firstMatch = { type, name: value, position: pos };
      }
    }
  };

  // Check all categories - priority only matters if positions are equal
  checkSubjects(players, 'player');
  checkSubjects(targets, 'target');
  checkSubjects(legends, 'pundit');
  checkSubjects(managers, 'manager');

  if (firstMatch.type) {
    return { type: firstMatch.type, name: firstMatch.name };
  }

  // Check remaining categories with lower priority (clubs/womens less important than people)
  for (const [key, value] of Object.entries(womens)) {
    if (lower.includes(key)) return { type: 'womens', name: value };
  }
  for (const [key, value] of Object.entries(clubs)) {
    if (lower.includes(key)) return { type: 'club', name: value };
  }

  // Check for topics - only if no specific person/club was found
  // These are truly topic-focused stories without a clear subject
  if (lower.includes('financial') || lower.includes('deloitte') || lower.includes('revenue')) {
    return { type: 'topic', name: 'FINANCES' };
  }
  // Only use INEOS/GLAZERS if the story is ABOUT ownership, not just mentioning it
  if ((lower.includes('ineos') || lower.includes('ratcliffe')) &&
      (lower.includes('ownership') || lower.includes('takeover') || lower.includes('stake') || lower.includes('board'))) {
    return { type: 'topic', name: 'OWNERSHIP' };
  }
  if (lower.includes('glazer') && (lower.includes('ownership') || lower.includes('sell') || lower.includes('stake'))) {
    return { type: 'topic', name: 'GLAZERS' };
  }
  if (lower.includes('old trafford') && (lower.includes('stadium') || lower.includes('redevelop') || lower.includes('renovation'))) {
    return { type: 'topic', name: 'OLD TRAFFORD' };
  }
  if (lower.includes('academy') || lower.includes('youth')) {
    return { type: 'topic', name: 'ACADEMY' };
  }

  return { type: 'general', name: 'UNITED' };
}

/**
 * Determine the story angle/action
 */
function determineAngle(lower) {
  // Departure/Exit angles - check early as they're important
  if (lower.includes('leave') && (lower.includes('set to') || lower.includes('will') || lower.includes('confirm'))) {
    return 'departure';
  }
  if (lower.includes('depart') || lower.includes('exit') || lower.includes('part ways')) {
    return 'departure';
  }

  // Transfer angles
  if (lower.includes('demand') && (lower.includes('€') || lower.includes('£') || lower.includes('m '))) {
    return 'price_demand';
  }
  if (lower.includes('offer') || lower.includes('bid')) {
    return 'offer_made';
  }
  if (lower.includes('buyback') || lower.includes('clause')) {
    return 'buyback';
  }
  if (lower.includes('pushing') || lower.includes('wants') || lower.includes('keen')) {
    return 'player_wants';
  }
  if (lower.includes('open to leav') || lower.includes('open to mov') || lower.includes('willing to')) {
    return 'open_to_move';
  }
  if (lower.includes('closing in') || lower.includes('close to')) {
    return 'close_to_deal';
  }
  if (lower.includes('loan') && (lower.includes('switch') || lower.includes('move') || lower.includes('sign'))) {
    return 'loan_move';
  }
  if (lower.includes('negotiat')) {
    return 'negotiations';
  }
  if (lower.includes('race') || lower.includes('join')) {
    return 'transfer_race';
  }

  // Performance angles
  if (lower.includes('impress') || lower.includes('shine') || lower.includes('brilliant') || lower.includes('heroic')) {
    return 'impressive_form';
  }
  if (lower.includes('score') || lower.includes('goal')) {
    return 'scored';
  }
  if (lower.includes('assist')) {
    return 'assisted';
  }
  if (lower.includes('win') || lower.includes('victory') || lower.includes('beat')) {
    return 'won';
  }
  if (lower.includes('defeat') || lower.includes('loss') || lower.includes('lost')) {
    return 'lost';
  }

  // Statement/Opinion angles
  if (lower.includes('reveal') || lower.includes('admits') || lower.includes('says') || lower.includes('claims')) {
    return 'statement';
  }
  if (lower.includes('blast') || lower.includes('slam') || lower.includes('criticis') || lower.includes('hits out')) {
    return 'criticism';
  }
  if (lower.includes('defend') || lower.includes('backs')) {
    return 'defense';
  }
  if (lower.includes('loving') || lower.includes('happy') || lower.includes('delighted')) {
    return 'positive_quote';
  }

  // Business/Club angles
  if (lower.includes('weaken') || lower.includes('fall') || lower.includes('drop') || lower.includes('behind')) {
    return 'decline';
  }
  if (lower.includes('confirm') || lower.includes('official')) {
    return 'confirmed';
  }
  if (lower.includes('report') && !lower.includes('reportedly')) {
    return 'report';
  }

  // Controversy angles
  if (lower.includes('var') || lower.includes('referee') || lower.includes('offside')) {
    return 'var_controversy';
  }
  if (lower.includes('controversy') || lower.includes('row') || lower.includes('dispute')) {
    return 'controversy';
  }
  if (lower.includes('panel') || lower.includes('kmi') || lower.includes('should have')) {
    return 'wrong_decision';
  }

  // Development angles
  if (lower.includes('development') || lower.includes('progress') || lower.includes('plan')) {
    return 'development';
  }
  if (lower.includes('history') || lower.includes('making history') || lower.includes('first')) {
    return 'historic';
  }

  return 'general';
}

/**
 * Detect sentiment of the story
 */
function detectSentiment(lower) {
  const positive = ['win', 'victory', 'brilliant', 'impressive', 'heroic', 'loving', 'happy', 'delighted',
                    'shine', 'star', 'boost', 'confirm', 'done deal', 'agree', 'success', 'standout'];
  const negative = ['lose', 'lost', 'defeat', 'weaken', 'fall', 'drop', 'blow', 'injury', 'miss',
                    'reject', 'fail', 'struggle', 'crisis'];
  const controversial = ['var', 'controversy', 'row', 'blast', 'slam', 'criticis', 'dispute',
                         'should have', 'wrong', 'unfair', 'panel', 'kmi'];

  // Check controversial first - these override other sentiments
  for (const word of controversial) {
    if (lower.includes(word)) return 'controversial';
  }

  let score = 0;
  for (const word of positive) {
    if (lower.includes(word)) score += 1;
  }
  for (const word of negative) {
    if (lower.includes(word)) score -= 1;
  }

  // "closing in" on a player is neutral (it's news, not necessarily bad)
  // "behind" in context of rivals is negative
  if (lower.includes('behind') && lower.includes('rival')) score -= 1;

  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

/**
 * Generate the final title based on analysis
 */
function generateTitle(subject, angle, sentiment, lower) {
  const name = subject.name;
  const type = subject.type;

  // ============================================================================
  // Player stories
  // ============================================================================
  if (type === 'player') {
    // Check for loan context first - "closing in" on a loan is different
    if (lower.includes('closing in') && lower.includes('loan')) {
      return `${name} LOAN`;
    }
    if (lower.includes('close to') && lower.includes('loan')) {
      return `${name} LOAN`;
    }

    switch (angle) {
      case 'departure': return `${name} EXIT`;
      case 'impressive_form': return `${name} SHINES`;
      case 'scored': return `${name} SCORES`;
      case 'assisted': return `${name} ASSIST`;
      case 'loan_move': return `${name} LOAN`;
      case 'close_to_deal': return `${name} CLOSE`;
      case 'negotiations': return `${name} TALKS`;
      case 'player_wants': return `${name} WANTS OUT`;
      case 'open_to_move': return `${name} EXIT?`;
      case 'transfer_race': return `${name} RACE`;
      case 'statement': return `${name} SPEAKS`;
      case 'development': return `${name} PROGRESS`;
      case 'won': return `${name} WINS IT`;
      default:
        if (sentiment === 'positive') return `${name} BOOST`;
        if (sentiment === 'negative') return `${name} BLOW`;
        return `${name} UPDATE`;
    }
  }

  // ============================================================================
  // Transfer target stories
  // ============================================================================
  if (type === 'target') {
    switch (angle) {
      case 'price_demand': return `${name} PRICE TAG`;
      case 'offer_made': return `${name} BID`;
      case 'buyback': return `${name} RETURN?`;
      case 'player_wants': return `${name} KEEN`;
      case 'open_to_move': return `${name} OPEN`;
      case 'close_to_deal': return `${name} CLOSE`;
      case 'negotiations': return `${name} TALKS`;
      case 'transfer_race': return `${name} RACE`;
      default: return `${name} LINKED`;
    }
  }

  // ============================================================================
  // Pundit/Legend stories
  // ============================================================================
  if (type === 'pundit') {
    switch (angle) {
      case 'criticism': return `${name} BLASTS`;
      case 'defense': return `${name} DEFENDS`;
      case 'statement': return `${name} VERDICT`;
      default: return `${name} SPEAKS`;
    }
  }

  // ============================================================================
  // Manager stories
  // ============================================================================
  if (type === 'manager') {
    switch (angle) {
      case 'won': return `${name} WINS`;
      case 'lost': return `${name} LOSES`;
      case 'statement': return `${name} SPEAKS`;
      case 'confirmed': return `${name} IN`;
      default:
        if (sentiment === 'positive') return `${name} ERA`;
        return `${name} NEWS`;
    }
  }

  // ============================================================================
  // Women's team stories
  // ============================================================================
  if (type === 'womens') {
    switch (angle) {
      case 'historic': return `${name} HISTORY`;
      case 'won': return `${name} WIN`;
      case 'positive_quote': return `${name} JOY`;
      case 'impressive_form': return `${name} STAR`;
      default: return `WOMEN'S REDS`;
    }
  }

  // ============================================================================
  // Club stories (as transfer subject)
  // ============================================================================
  if (type === 'club') {
    switch (angle) {
      case 'offer_made': return `${name} OFFER`;
      case 'price_demand': return `${name} PRICE`;
      case 'close_to_deal': return `${name} CLOSE`;
      case 'loan_move': return `${name} LOAN`;
      default: return `${name} LINK`;
    }
  }

  // ============================================================================
  // Topic stories - make more specific based on angle
  // ============================================================================
  if (type === 'topic') {
    if (name === 'FINANCES') {
      if (sentiment === 'negative') return 'MONEY WOES';
      if (lower.includes('rival')) return 'FALLING BEHIND';
      return 'MONEY TALK';
    }
    if (name === 'OWNERSHIP') {
      if (lower.includes('takeover')) return 'TAKEOVER NEWS';
      if (lower.includes('board')) return 'BOARDROOM';
      if (lower.includes('decision') || lower.includes('approve')) return 'INEOS DECISION';
      return 'OWNERSHIP NEWS';
    }
    if (name === 'GLAZERS') {
      if (lower.includes('sell') || lower.includes('sale')) return 'GLAZERS OUT?';
      return 'GLAZER NEWS';
    }
    if (name === 'OLD TRAFFORD') {
      if (lower.includes('redevelop') || lower.includes('new stadium')) return 'OT REBUILD';
      return 'OT NEWS';
    }
    if (name === 'ACADEMY') {
      if (lower.includes('promot') || lower.includes('debut')) return 'YOUTH RISING';
      return 'ACADEMY NEWS';
    }
  }

  // ============================================================================
  // Sentiment-based fallbacks for general stories
  // ============================================================================
  if (sentiment === 'controversial') {
    if (lower.includes('should have') || lower.includes('awarded')) return 'ROBBED';
    if (lower.includes('panel') || lower.includes('kmi')) return 'VAR VERDICT';
    return 'VAR DRAMA';
  }

  // ============================================================================
  // Angle-based fallbacks
  // ============================================================================
  switch (angle) {
    case 'var_controversy': return 'VAR DRAMA';
    case 'wrong_decision': return 'ROBBED';
    case 'controversy': return 'CONTROVERSY';
    case 'won': return 'REDS WIN';
    case 'lost': return 'REDS LOSE';
    case 'confirmed': return 'CONFIRMED';
    case 'report': return 'REPORT';
    case 'transfer_race': return 'TRANSFER RACE';
    case 'negotiations': return 'TALKS ONGOING';
    case 'close_to_deal': return 'DEAL CLOSE';
    case 'offer_made': return 'BID MADE';
    case 'price_demand': return 'PRICE SET';
  }

  // ============================================================================
  // Context-based fallbacks for general stories
  // ============================================================================
  if (lower.includes('transfer') || lower.includes('sign') || lower.includes('target')) {
    return 'TRANSFER NEWS';
  }
  if (lower.includes('match') || lower.includes('fixture') || lower.includes('kick-off')) {
    return 'MATCH NEWS';
  }
  if (lower.includes('injury') || lower.includes('injured') || lower.includes('ruled out')) {
    return 'INJURY NEWS';
  }
  if (lower.includes('arsenal')) {
    return 'ARSENAL CLASH';
  }
  if (lower.includes('city') && !lower.includes('norwich')) {
    return 'DERBY NEWS';
  }
  if (lower.includes('liverpool')) {
    return 'RIVALRY NEWS';
  }

  // ============================================================================
  // Final fallback
  // ============================================================================
  return 'UNITED NEWS';
}

/**
 * Extract a contextual title from headline text with Man United puns and flair
 * @param {string} text - The headline text
 * @returns {string} - A short, punny, descriptive title
 */
function extractContextualTitle(text) {
  const lowerText = text.toLowerCase();

  // Player-specific punny titles
  const playerTitles = {
    'Rashford': { default: 'RASHFORD WATCH', goal: 'RASHY MAGIC', transfer: 'RASHFORD SAGA', injury: 'RASHY BLOW' },
    'Bruno': { default: 'BRUNO BRILLIANCE', goal: 'BRUNO MAGIC', transfer: 'BRUNO NEWS', speaks: 'BRUNO SPEAKS' },
    'Fernandes': { default: 'BRUNO BRILLIANCE', goal: 'BRUNO MAGIC', transfer: 'BRUNO NEWS', speaks: 'BRUNO SPEAKS' },
    'Martinez': { default: 'LICHA WATCH', goal: 'LICHA MAGIC', speaks: 'LICHA SPEAKS', injury: 'LICHA BLOW' },
    'Lisandro': { default: 'LICHA WATCH', goal: 'LICHA MAGIC', speaks: 'LICHA SPEAKS', injury: 'LICHA BLOW' },
    'Mainoo': { default: 'MAINOO MAGIC', goal: 'KOBBIE SCORES', transfer: 'MAINOO FUTURE', injury: 'MAINOO BLOW' },
    'Garnacho': { default: 'GARNACHO SZN', goal: 'GARNACHO GOLAZO', transfer: 'GARNACHO SAGA', injury: 'GARNACHO BLOW' },
    'Mount': { default: 'MOUNT WATCH', goal: 'MOUNT MAGIC', injury: 'MOUNT UPDATE' },
    'Hojlund': { default: 'HOJLUND WATCH', goal: 'HOJLUND SCORES', injury: 'HOJLUND BLOW' },
    'Zirkzee': { default: 'ZIRKZEE SZN', goal: 'ZIRKZEE MAGIC', transfer: 'ZIRKZEE NEWS' },
    'Dalot': { default: 'DALOT WATCH', goal: 'DALOT SCORES', speaks: 'DALOT SPEAKS' },
    'Shaw': { default: 'SHAW WATCH', injury: 'SHAW UPDATE', goal: 'SHAW MAGIC' },
    'Maguire': { default: 'SLABHEAD SZN', goal: 'MAGUIRE SCORES', injury: 'MAGUIRE BLOW', speaks: 'HARRY SPEAKS' },
    'Casemiro': { default: 'CASE CLOSED', goal: 'CASEMIRO MAGIC', transfer: 'CASE SAGA' },
    'Eriksen': { default: 'ERIKSEN WATCH', goal: 'ERIKSEN MAGIC', transfer: 'ERIKSEN NEWS' },
    'Onana': { default: 'ONANA WATCH', save: 'ONANA SAVES', speaks: 'ONANA SPEAKS' },
    'Antony': { default: 'ANTONY WATCH', goal: 'ANTONY MAGIC', transfer: 'ANTONY SAGA' },
    'Sancho': { default: 'SANCHO WATCH', goal: 'SANCHO MAGIC', transfer: 'SANCHO SAGA' },
    'Amad': { default: 'AMAD SZN', goal: 'AMAD MAGIC', transfer: 'AMAD NEWS' },
    'Dorgu': { default: 'DORGU SZN', goal: 'DORGU SCORES', transfer: 'DORGU NEWS' },
    'Mbeumo': { default: 'MBEUMO MAGIC', goal: 'MBEUMO SCORES', transfer: 'MBEUMO NEWS' },
    'Palmer': { default: 'PALMER WATCH', transfer: 'PALMER LINK', goal: 'PALMER MAGIC' },
    'Rooney': { default: 'ROONEY REACTS', speaks: 'ROONEY SPEAKS', goal: 'ROONEY LEGEND' },
    'Scholes': { default: 'SCHOLESY SPEAKS', speaks: 'SCHOLES BLAST' },
    'Ferdinand': { default: 'RIO REACTS', speaks: 'RIO SPEAKS' },
    'Keane': { default: 'KEANO SAYS', speaks: 'KEANE BLAST' },
    'Butt': { default: 'BUTT SPEAKS', speaks: 'NICKY BLAST' },
    'Carragher': { default: 'CARRA SPEAKS', speaks: 'CARRA VERDICT' },
    'Henry': { default: 'HENRY VERDICT', speaks: 'HENRY SPEAKS' },
    'Neville': { default: 'NEVILLE SPEAKS', speaks: 'GARY BLAST' },
  };

  // Manager-specific titles
  const managerTitles = {
    'Carrick': { default: 'CARRICK ERA', win: 'CARRICK MAGIC', exit: 'CARRICK NEWS', link: 'CARRICK WATCH' },
    'Amorim': { default: 'AMORIM ERA', exit: 'AMORIM GONE', sack: 'AMORIM SACKED' },
    'Ten Hag': { default: 'TEN HAG NEWS', exit: 'ETH GONE', sack: 'TEN HAG OUT' },
    'De Zerbi': { default: 'DE ZERBI LINK', link: 'DE ZERBI WATCH' },
    'Kovac': { default: 'KOVAC LINK', link: 'KOVAC WATCH' },
    'Tuchel': { default: 'TUCHEL LINK', link: 'TUCHEL WATCH' },
    'Pochettino': { default: 'POCH LINK', link: 'POCH WATCH' },
  };

  // Rival-specific punny titles
  const rivalTitles = {
    'city': 'NOISY NEIGHBOURS',
    'man city': 'NOISY NEIGHBOURS',
    'manchester city': 'NOISY NEIGHBOURS',
    'derby': 'DERBY DAY',
    'liverpool': 'SCOUSERS WATCH',
    'arsenal': 'ARSENAL WATCH',
    'chelsea': 'CHELSEA WATCH',
    'tottenham': 'SPURS WATCH',
    'spurs': 'SPURS WATCH',
    'leeds': 'LEEDS SCUM',
    'haaland': 'HAALAND WHO?',
    'foden': 'FODEN WATCH',
    'salah': 'SALAH WATCH',
    'pep': 'PEP WATCH',
    'guardiola': 'PEP WATCH',
    'klopp': 'KLOPP WATCH',
    'arteta': 'ARTETA WATCH',
  };

  // Topic-based punny titles
  const topicTitles = {
    'old trafford': 'THEATRE OF DREAMS',
    'stretford end': 'STRETFORD END',
    'academy': 'ACADEMY WATCH',
    'youth': 'YOUTH RISING',
    'wonderkid': 'WONDERKID ALERT',
    'clean sheet': 'CLEAN SHEET',
    'penalty': 'SPOT KICK',
    'red card': 'RED CARD',
    'yellow card': 'BOOKING',
    'var': 'VAR DRAMA',
    'referee': 'REF WATCH',
    'ineos': 'INEOS WATCH',
    'ratcliffe': 'SIR JIM WATCH',
    'glazer': 'GLAZERS OUT',
    'fixture': 'FIXTURE NEWS',
    'schedule': 'FIXTURE NEWS',
    'premier league': 'PREMIER LEAGUE',
    'champions league': 'UCL NEWS',
    'europa league': 'UEL NEWS',
    'fa cup': 'FA CUP',
    'carabao': 'LEAGUE CUP',
    'manager': 'MANAGER NEWS',
    'sack': 'MANAGER NEWS',
    'next manager': 'NEXT BOSS',
  };

  // Action-based titles
  const actionTitles = {
    'win': 'REDS WIN',
    'victory': 'GLORY GLORY',
    'beat': 'REDS TRIUMPH',
    'defeat': 'UNITED FALL',
    'loss': 'HEARTBREAK',
    'draw': 'DRAW MERCHANTS',
    'goal': 'GET IN',
    'score': 'GET IN',
    'transfer': 'TRANSFER NEWS',
    'sign': 'DONE DEAL?',
    'bid': 'TRANSFER BID',
    'loan': 'LOAN WATCH',
    'contract': 'CONTRACT NEWS',
    'injury': 'INJURY BLOW',
    'injured': 'INJURY UPDATE',
    'ruled out': 'RULED OUT',
    'return': 'WELCOME BACK',
    'sack': 'SACKED',
    'appoint': 'NEW BOSS',
    'exclusive': 'EXCLUSIVE',
    'breaking': 'BREAKING',
    'confirmed': 'CONFIRMED',
    'official': 'OFFICIAL',
  };

  // Check for player names first
  for (const [player, titles] of Object.entries(playerTitles)) {
    if (text.includes(player)) {
      if (lowerText.includes('transfer') || lowerText.includes('sign') || lowerText.includes('move') || lowerText.includes('bid')) {
        return titles.transfer || titles.default;
      }
      if (lowerText.includes('injur') || lowerText.includes('ruled out') || lowerText.includes('doubt') || lowerText.includes('blow')) {
        return titles.injury || titles.default;
      }
      if (lowerText.includes('goal') || lowerText.includes('score') || lowerText.includes('winner')) {
        return titles.goal || titles.default;
      }
      if (lowerText.includes('says') || lowerText.includes('hits back') || lowerText.includes('slams') || lowerText.includes('responds') || lowerText.includes('blast')) {
        return titles.speaks || titles.default;
      }
      return titles.default;
    }
  }

  // Check for manager names
  for (const [manager, titles] of Object.entries(managerTitles)) {
    if (lowerText.includes(manager.toLowerCase())) {
      if (lowerText.includes('sack') || lowerText.includes('fired') || lowerText.includes('axed')) {
        return titles.sack || titles.exit || titles.default;
      }
      if (lowerText.includes('leave') || lowerText.includes('exit') || lowerText.includes('gone') || lowerText.includes('depart')) {
        return titles.exit || titles.default;
      }
      if (lowerText.includes('target') || lowerText.includes('want') || lowerText.includes('shortlist') || lowerText.includes('link')) {
        return titles.link || titles.default;
      }
      if (lowerText.includes('win') || lowerText.includes('victory') || lowerText.includes('beat')) {
        return titles.win || titles.default;
      }
      return titles.default;
    }
  }

  // Check for rival mentions
  for (const [rival, title] of Object.entries(rivalTitles)) {
    if (lowerText.includes(rival)) {
      return title;
    }
  }

  // Check for topic mentions
  for (const [topic, title] of Object.entries(topicTitles)) {
    if (lowerText.includes(topic)) {
      return title;
    }
  }

  // Check for action words
  for (const [action, title] of Object.entries(actionTitles)) {
    if (lowerText.includes(action)) {
      return title;
    }
  }

  // Check for manager search / next manager context
  if (lowerText.includes('next manager') || lowerText.includes('new manager') || lowerText.includes('manager search') || lowerText.includes('replace')) {
    return 'NEXT BOSS';
  }

  // Check for hierarchy / board context
  if (lowerText.includes('hierarchy') || lowerText.includes('board') || lowerText.includes('ownership')) {
    return 'BOARDROOM';
  }

  // Extract first notable word as fallback
  const words = text.split(/[\s:,]+/).slice(0, 3);
  for (const word of words) {
    if (word.length > 3 && /^[A-Z]/.test(word) && !['The', 'Man', 'Why', 'How', 'What', 'Who', 'When', 'United', 'Premier'].includes(word)) {
      return word.toUpperCase() + ' NEWS';
    }
  }

  return 'UNITED NEWS';
}

/**
 * Transform a headline into clean, readable content with simple emoji
 * @param {string} text - Original headline
 * @param {string} title - The punny title we extracted
 * @returns {string} - Clean content with emoji
 */
function transformToPassionateContent(text, title) {
  const lowerText = text.toLowerCase();

  // Clean up the text
  let content = text
    // Remove reporter bylines and sources
    .replace(/,?\s*(writes|says)\s+[A-Z][A-Z\s]+$/i, '')
    .replace(/\s*[-–—]\s*[A-Z][A-Za-z\s]+$/g, '')
    .replace(/\s*\|\s*[A-Za-z\s]+$/g, '')
    .replace(/,?\s*reports?\s+[A-Za-z\s]+$/gi, '')
    // Team name shortcuts
    .replace(/Man Utd/gi, 'United')
    .replace(/Manchester United/gi, 'United')
    .replace(/MUFC/gi, 'United')
    .replace(/Manchester United FC/gi, 'United')
    .replace(/Man United's/gi, "United's")
    .replace(/Man United/gi, 'United')
    // Clean up wordy phrases
    .replace(/it has been revealed/gi, '')
    .replace(/it has emerged that/gi, '')
    .replace(/according to reports/gi, '')
    .replace(/Premier League/gi, 'PL')
    .replace(/Champions League/gi, 'UCL')
    .replace(/Europa League/gi, 'UEL')
    .trim();

  // Pick emoji based on content type (just one simple emoji, no phrases)
  let emoji = '🔴';

  if (lowerText.includes('win') || lowerText.includes('beat') || lowerText.includes('victory')) {
    emoji = '🔥';
  } else if (lowerText.includes('lose') || lowerText.includes('lost') || lowerText.includes('defeat')) {
    emoji = '💔';
  } else if (lowerText.includes('goal') || lowerText.includes('score')) {
    emoji = '⚽';
  } else if (lowerText.includes('transfer') || lowerText.includes('sign') || lowerText.includes('bid') || lowerText.includes('target') || lowerText.includes('wanted')) {
    emoji = '👀';
  } else if (lowerText.includes('injur') || lowerText.includes('ruled out')) {
    emoji = '🙏';
  } else if (lowerText.includes('carrick')) {
    emoji = '⚡';
  } else if (lowerText.includes('keane') || lowerText.includes('neville') || lowerText.includes('scholes') || lowerText.includes('ferdinand') || lowerText.includes('rooney')) {
    emoji = '🗣️';
  } else if (lowerText.includes('academy') || lowerText.includes('youth')) {
    emoji = '🌟';
  } else if (lowerText.includes('fixture') || lowerText.includes('schedule')) {
    emoji = '📅';
  } else if (lowerText.includes('referee') || lowerText.includes('var') || lowerText.includes('red card')) {
    emoji = '😤';
  } else if (lowerText.includes('breaking') || lowerText.includes('exclusive')) {
    emoji = '🚨';
  }

  return content + ' ' + emoji;
}

/**
 * Convert raw headlines to rich ticker format
 * @param {Array} headlines - Array of raw headlines
 * @returns {Array} - Array of ticker items with title and content
 */
function convertToTickerFormat(headlines) {
  return headlines.map(h => {
    const text = h.raw;

    // Extract contextual title from the headline
    const title = extractContextualTitle(text);

    // Transform to passionate fan commentary
    const content = transformToPassionateContent(text, title);

    return { title, content };
  });
}

/**
 * Clean up grammar and syntax issues in content
 * @param {string} content - Raw content text
 * @returns {string} - Cleaned content with proper grammar
 */
function cleanupGrammar(content) {
  let cleaned = content
    // Normalize curly quotes and apostrophes to straight quotes
    .replace(/[\u2018\u2019\u0027\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u0022]/g, '"')
    // Remove Twitter/social media URLs, handles, and embedded tweets
    .replace(/pic\.twitter\.com\/\w+/gi, '')
    .replace(/https?:\/\/t\.co\/\w+/gi, '')
    .replace(/https?:\/\/twitter\.com\/\S+/gi, '')
    .replace(/https?:\/\/x\.com\/\S+/gi, '')
    .replace(/@\w+/g, '')
    // Remove embedded tweet attribution (format: "— Account January 22, 2026")
    .replace(/—\s*[\w\s\.]+\s*\w+\s+\d+,?\s*\d{4}/gi, '')
    .replace(/—\s*Transfermarkt[\s\S]*?(?=[A-Z][a-z]+\s+(has|is|was|are|were|will|would|could|should)|$)/gi, '')
    // Remove "That's according to" and similar attributions - clean up broken sentences
    .replace(/That's according to [^,\.]+,?\s*/gi, '')
    .replace(/That's which adds\s*/gi, 'Reports suggest ')
    .replace(/That's which\s*/gi, '')
    .replace(/That's who revealed[^\.]*\.\s*/gi, '')
    .replace(/That's who\s*/gi, '')
    .replace(/That's\s+The\s+/gi, 'The ')
    .replace(/That's\s+[a-z]/gi, '')
    .replace(/According to [^,\.]+,?\s*/gi, '')
    // Remove "as per recent reports" style phrases
    .replace(/,?\s*as per recent reports\.?/gi, '.')
    .replace(/,?\s*as per reports\.?/gi, '.')
    // Remove reporter/journalist references
    .replace(/former\s+\w+\s+\w+\s+journalist\s+\w+\s+\w+,?\s*/gi, '')
    .replace(/who revealed yesterday:?\s*/gi, '')
    .replace(/who revealed:?\s*/gi, '')
    // Remove X/Twitter references
    .replace(/on X\/Twitter[^,\.]*[,\.]?\s*/gi, '')
    .replace(/revealed on X[^,\.]*[,\.]?\s*/gi, '')
    .replace(/on X[^,\.]*[,\.]?\s*/gi, '')
    // Remove photo credits
    .replace(/\(Photo by[^)]+\)/gi, '')
    .replace(/\(Image[^)]+\)/gi, '')
    .replace(/\(Getty[^)]*\)/gi, '')
    // Clean up orphaned "Which adds" at start of sentences
    .replace(/\.\s*Which adds\s+/gi, '. Reports add ')
    .replace(/^Which adds\s+/gi, 'Reports add ')
    // Remove "which reads:" and similar
    .replace(/,?\s*which reads:?\s*["']?/gi, ': ')
    // Clean up quotes formatting
    .replace(/[""]([^""]+)[""]/g, '"$1"')
    // Remove "Indeed," at start of sentences
    .replace(/Indeed,\s*/gi, '')
    // Fix "the likes of" to proper list
    .replace(/the likes of\s+/gi, 'including ')
    // Remove reporter names and sources inline
    .replace(/,?\s*reports?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\.?/g, '.')
    .replace(/,?\s*according to\s+[A-Z][a-z]+\s+[A-Z][a-z]+\.?/gi, '.')
    // Remove "relaying claims from" and similar
    .replace(/relaying claims from [^,\.]+,?\s*/gi, '')
    // Remove standalone website names
    .replace(/\s+Transfermarkt\.co\.?\s*/gi, ' ')
    // Add space after period if missing
    .replace(/\.([A-Z])/g, '. $1')
    // Fix double spaces
    .replace(/\s{2,}/g, ' ')
    // Fix multiple periods
    .replace(/\.{2,}/g, '.')
    // Fix period followed by lowercase (make uppercase)
    .replace(/\.\s*([a-z])/g, (match, letter) => '. ' + letter.toUpperCase())
    // Clean up spacing around punctuation
    .replace(/\s+\./g, '.')
    .replace(/\s+,/g, ',')
    .replace(/,\s*\./g, '.')
    // Remove sentences that are just fragments or references
    .replace(/\s*"My contacts[^"]*"\s*/g, ' ')
    // Remove empty parentheses or brackets
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    // Clean up "Cole Palmer: The state of play" style subheadings
    .replace(/\s*[A-Z][a-z]+\s+[A-Z][a-z]+:\s*The state of play\s*/gi, ' ')
    // Fix "playName" and "homeName" type issues - remove orphaned words before names
    .replace(/\s+play\.\s+/gi, '. ')
    .replace(/\s+home\s+play\s*/gi, ' home. ')
    // Fix missing space after period before capital letter
    .replace(/\.([A-Z])/g, '. $1')
    // Remove questions that are clearly article formatting
    .replace(/"Could United[^"]*\?/gi, '')
    // Remove talkSPORT and similar source mentions
    .replace(/,?\s*as\s+talkSPORT[^\.]+\./gi, '.')
    // Clean up orphaned quotes at start of sentences
    .replace(/:\s*"([A-Z])/g, ': "$1')
    .replace(/\."([A-Z])/g, '. "$1')
    // Final pass: ensure space after period before capital (must be last)
    .replace(/\.([A-Z])/g, '. $1')
    // Trim
    .trim();

  // Ensure first letter is capitalized
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // Ensure ends with proper punctuation
  if (cleaned.length > 0 && !/[.!?]$/.test(cleaned)) {
    cleaned += '.';
  }

  return cleaned;
}

/**
 * Fetch and parse Manchester United news
 * Primary: Stretty News RSS (descriptive fan content)
 * Fallback: Daily Mail, Google News
 * @returns {Promise<Array>} - Array of ticker items with actual article content
 */
async function fetchManUtdNews() {
  const allHeadlines = [];
  const fetchTime = new Date();
  console.log('[NewsScraper] Fetch time:', fetchTime.toISOString());

  // PRIMARY: Try Stretty News RSS first (best descriptive content)
  try {
    console.log('[NewsScraper] Fetching news from Stretty News RSS...');
    const rssContent = await fetchUrl('https://strettynews.com/feed/');
    const rssHeadlines = parseStrettyNewsRSS(rssContent);
    allHeadlines.push(...rssHeadlines);
    console.log(`[NewsScraper] Got ${rssHeadlines.length} headlines from Stretty News`);

    if (rssHeadlines.length > 0) {
      console.log('[NewsScraper] First headline:', rssHeadlines[0].raw.substring(0, 80) + '...');
    }
  } catch (error) {
    console.error('[NewsScraper] Stretty News RSS error:', error.message);
  }

  // FALLBACK 1: Daily Mail if we need more headlines
  if (allHeadlines.length < 5) {
    try {
      console.log('[NewsScraper] Fetching news from Daily Mail (fallback)...');
      const dailyMailHtml = await fetchUrl('https://www.dailymail.co.uk/sport/manchester-united/index.html');
      const dailyMailHeadlines = parseDailyMailHeadlines(dailyMailHtml);
      for (const h of dailyMailHeadlines) {
        if (!allHeadlines.some(existing => existing.raw.toLowerCase().includes(h.raw.toLowerCase().slice(0, 30)))) {
          allHeadlines.push(h);
        }
      }
      console.log(`[NewsScraper] Got ${dailyMailHeadlines.length} headlines from Daily Mail`);
    } catch (error) {
      console.error('[NewsScraper] Daily Mail error:', error.message);
    }
  }

  // FALLBACK 2: Google News RSS if still not enough
  if (allHeadlines.length < 5) {
    try {
      console.log('[NewsScraper] Fetching news from Google News (fallback)...');
      const googleRss = await fetchUrl('https://news.google.com/rss/search?q=Manchester+United&hl=en-GB&gl=GB&ceid=GB:en');
      const googleHeadlines = parseGoogleNewsRSS(googleRss);
      for (const h of googleHeadlines) {
        if (!allHeadlines.some(existing => existing.raw.toLowerCase().includes(h.raw.toLowerCase().slice(0, 30)))) {
          allHeadlines.push(h);
        }
      }
      console.log(`[NewsScraper] Got ${googleHeadlines.length} from Google News`);
    } catch (error) {
      console.error('[NewsScraper] Google News error:', error.message);
    }
  }

  if (allHeadlines.length === 0) {
    console.log('[NewsScraper] No headlines found, using fallback');
    return getFallbackNews();
  }

  // Process headlines - Stretty News already has descriptions!
  const headlinesToProcess = allHeadlines.slice(0, 10);
  console.log(`[NewsScraper] Processing ${headlinesToProcess.length} articles...`);

  // Helper function to process content with fallback generation
  async function processHeadline(h) {
    const fallbackTitle = extractContextualTitle(h.raw);
    let rawContent = '';

    // Get raw content based on source
    if (h.source === 'strettynews' && h.description && h.description.length > 30) {
      rawContent = h.description
        .replace(/The post .* appeared first on.*$/i, '')
        .trim();
    } else if (h.source === 'dailymail' && h.url) {
      const fetched = await fetchArticleContent(h.url);
      if (fetched && fetched.length > 50) {
        rawContent = fetched;
      }
    }

    // If no content, fall back to headline
    if (!rawContent || rawContent.length < 30) {
      return { title: fallbackTitle, content: transformToPassionateContent(h.raw, fallbackTitle) };
    }

    // TRY CLAUDE API FIRST (if available)
    if (claudeApi && claudeApi.isAvailable()) {
      try {
        const result = await claudeApi.generateTickerContent(h.raw, rawContent);
        console.log(`[NewsScraper] Claude generated: "${result.title}"`);
        return result;
      } catch (error) {
        console.error('[NewsScraper] Claude API error, falling back:', error.message);
        // Fall through to rule-based generation
      }
    }

    // FALLBACK: Rule-based generation
    let cleanContent = rawContent
      .replace(/Man Utd/gi, 'United')
      .replace(/Manchester United/gi, 'United')
      .replace(/Premier League/gi, 'PL')
      .replace(/Champions League/gi, 'UCL')
      .trim();

    // Clean up grammar and syntax
    cleanContent = cleanupGrammar(cleanContent);

    // Truncate to reasonable length for ticker - always end at sentence boundary
    if (cleanContent.length > 400) {
      const cutPoint = cleanContent.lastIndexOf('.', 400);
      if (cutPoint > 50) {
        cleanContent = cleanContent.substring(0, cutPoint + 1);
      } else {
        const altCut = cleanContent.lastIndexOf('.', 350);
        if (altCut > 50) {
          cleanContent = cleanContent.substring(0, altCut + 1);
        }
      }
    }

    const wittyTitle = generateWittyTitle(h.raw, cleanContent);
    return { title: wittyTitle, content: cleanContent };
  }

  // Process all headlines (sequentially if using Claude to avoid rate limits)
  let tickerItems;
  if (claudeApi && claudeApi.isAvailable()) {
    // Process sequentially to respect API rate limits
    tickerItems = [];
    for (const h of headlinesToProcess) {
      const item = await processHeadline(h);
      tickerItems.push(item);
      // Small delay between Claude API calls to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } else {
    // Process in parallel when using rule-based generation
    tickerItems = await Promise.all(headlinesToProcess.map(processHeadline));
  }

  console.log(`[NewsScraper] Total: ${tickerItems.length} items with content`);
  return tickerItems;
}

/**
 * Parse Google News RSS feed (fallback)
 * @param {string} xml - RSS XML content
 * @returns {Array} - Array of headline objects
 */
function parseGoogleNewsRSS(xml) {
  const headlines = [];
  const titlePattern = /<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/gi;
  let match;

  while ((match = titlePattern.exec(xml)) !== null) {
    const text = (match[1] || match[2] || '').trim();
    if (text.length > 15 && text.length < 250 &&
        !text.includes('Google News') &&
        !text.includes('Top stories') &&
        !headlines.some(h => h.raw === text)) {
      const cleanText = text.replace(/\s*[-–|]\s*[A-Za-z\s\.]+$/, '').trim();
      if (cleanText.length > 10) {
        headlines.push({ raw: cleanText, source: 'google' });
      }
    }
  }
  return headlines.slice(0, 12);
}

/**
 * Get fallback news if scraping fails
 * @returns {Array} - Array of ticker items
 */
function getFallbackNews() {
  return [
    { title: 'MANCHESTER IS RED', content: 'United DESTROY City 2-0 at Old Trafford – Carrick\'s dream start, the noisy neighbours SILENCED!' },
    { title: 'CARRICK MAGIC', content: 'First game as head coach, first derby WIN – couldn\'t have scripted it better!' },
    { title: 'MBEUMO MAGIC', content: 'Bryan Mbeumo breaks the deadlock on 65\' – vintage United counter-attack, Bruno\'s silky assist!' },
    { title: 'DORGU DOES IT AGAIN', content: 'Patrick Dorgu makes it 2-0 on 76\' – Cunha cross, back post finish, Old Trafford ERUPTS!' },
    { title: 'DOMINANCE', content: '3 goals ruled out for offside (Amad, Bruno, Mount), hit woodwork TWICE – could\'ve been 6-0!' },
    { title: 'CLEAN SHEET', content: 'Lammens brilliant, Martinez commanding, defence SOLID – only 31.9% possession but who cares!' },
    { title: 'UP TO 4TH', content: 'United now on 35 points, INTO the Champions League places – what a turnaround!' },
  ];
}

module.exports = {
  fetchManUtdNews,
  getFallbackNews
};
