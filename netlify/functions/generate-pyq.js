const axios = require('axios');
const pdfParse = require('pdf-parse');

function cleanText(text) {
  return text
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuestions(text) {
  const rawLines = text.split(/[\n\.]/);
  const questions = [];

  for (let line of rawLines) {
    const clean = line.trim();
    if (clean.length > 20) {
      if (
        clean.includes('?') ||
        /^\d+[\). ]/.test(clean) ||
        /^(what|why|how|define|explain|describe|write|differentiate|compare)/i.test(clean)
      ) {
        questions.push(clean);
      }
    }
  }

  return questions;
}

function normalizeQuestion(q) {
  return q
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s?]/g, '')
    .replace(/\s+/g, ' ');
}

function extractSummary(text) {
  const sentences = text
    .split(/[\.!?]/)
    .map(s => s.trim())
    .filter(s => s.length > 40);

  return sentences.slice(0, 8);
}

function detectTopics(text, subject) {
  const lowerText = text.toLowerCase();
  const lowerSubject = (subject || '').toLowerCase();

  if (lowerSubject.includes('cyber')) {
    return [
      'Cyber Security Basics',
      'Cryptography',
      'Authentication',
      'Network Security',
      'Cyber Attacks',
      'Malware and Threats'
    ];
  }

  if (lowerSubject.includes('dbms')) {
    return ['Normalization', 'SQL', 'Transactions', 'ER Model', 'Keys', 'Indexing'];
  }

  if (lowerSubject.includes('os')) {
    return ['Process', 'Thread', 'Deadlock', 'Scheduling', 'Memory Management'];
  }

  if (lowerSubject.includes('network')) {
    return ['OSI Model', 'TCP/IP', 'Routing', 'Switching', 'HTTP', 'Protocols'];
  }

  const possibleTopics = [];
  const keywords = [
    'security', 'network', 'database', 'cryptography', 'authentication',
    'process', 'thread', 'sql', 'normalization', 'malware', 'attack'
  ];

  for (const word of keywords) {
    if (lowerText.includes(word)) {
      possibleTopics.push(word[0].toUpperCase() + word.slice(1));
    }
  }

  return possibleTopics.length > 0
    ? [...new Set(possibleTopics)]
    : ['Important Concepts', 'Repeated Questions', 'Long Questions'];
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight success' }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const pdfUrls = body.pdfUrls || [];
    const subject = body.subject || '';

    let combinedText = '';
    let allQuestions = [];

    for (const url of pdfUrls) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
        });

        const pdfData = await pdfParse(response.data);
        const text = cleanText(pdfData.text || '');

        combinedText += ' ' + text;

        const questions = extractQuestions(text);
        allQuestions.push(...questions);
      } catch (err) {
        console.error('PDF processing error:', err.message);
      }
    }

    const normalizedMap = {};
    const countMap = {};

    for (const q of allQuestions) {
      const normalized = normalizeQuestion(q);
      if (!countMap[normalized]) {
        countMap[normalized] = 0;
        normalizedMap[normalized] = q;
      }
      countMap[normalized]++;
    }

    let importantQuestions = Object.entries(countMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([normalized, frequency]) => ({
        question: normalizedMap[normalized],
        frequency,
        category: frequency >= 2 ? 'Repeated' : 'Important',
      }));

    if (importantQuestions.length === 0) {
      const fallbackSummary = extractSummary(combinedText);
      importantQuestions = fallbackSummary.slice(0, 8).map((line, index) => ({
        question: line,
        frequency: 1,
        category: index < 3 ? 'Summary Point' : 'Important',
      }));
    }

    const summary = extractSummary(combinedText);
    const topics = detectTopics(combinedText, subject);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'success',
        subject,
        summary,
        important_questions: importantQuestions,
        topics,
      }),
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error.message,
      }),
    };
  }
};
