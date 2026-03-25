const axios = require('axios');
const pdfParse = require('pdf-parse');

function extractQuestions(text) {
  const lines = text.split('\n');
  const questions = [];

  for (let line of lines) {
    const clean = line.trim();
    if (clean.length > 15) {
      if (clean.includes('?') || /^\d+[\). ]/.test(clean)) {
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

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    const body = JSON.parse(event.body);
    const pdfUrls = body.pdfUrls || [];
    const subject = body.subject || '';

    let allQuestions = [];

    for (const url of pdfUrls) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
        });

        const pdfData = await pdfParse(response.data);
        const text = pdfData.text || '';
        const questions = extractQuestions(text);
        allQuestions.push(...questions);
      } catch (err) {
        console.error('PDF processing error:', err.message);
      }
    }

    const countMap = {};
    const originalMap = {};

    for (const question of allQuestions) {
      const normalized = normalizeQuestion(question);
      if (!countMap[normalized]) {
        countMap[normalized] = 0;
        originalMap[normalized] = question;
      }
      countMap[normalized]++;
    }

    const importantQuestions = Object.entries(countMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([normalized, frequency]) => ({
          question: originalMap[normalized],
          frequency,
          category: 'Important',
        }));

    let topics = [];
    const lowerSubject = subject.toLowerCase();

    if (lowerSubject.includes('dbms')) {
      topics = ['Normalization', 'SQL', 'Transactions', 'ER Model'];
    } else if (lowerSubject.includes('os')) {
      topics = ['Process', 'Thread', 'Deadlock', 'Memory Management'];
    } else if (lowerSubject.includes('network')) {
      topics = ['OSI Model', 'TCP/IP', 'Routing', 'HTTP'];
    } else {
      topics = ['Repeated Questions', 'Important Topics', 'Long Questions'];
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'success',
        subject,
        important_questions: importantQuestions,
        topics,
      }),
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error.message,
      }),
    };
  }
};