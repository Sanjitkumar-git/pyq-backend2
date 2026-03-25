const axios = require('axios');
const pdfParse = require('pdf-parse');

function cleanText(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u0000/g, '')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function splitLines(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function detectUnit(line) {
  const unitPatterns = [
    /(unit\s*[-:]?\s*\d+)/i,
    /(unit\s*[ivx]+)/i,
    /(module\s*[-:]?\s*\d+)/i,
    /(chapter\s*[-:]?\s*\d+)/i,
    /(unit\s*[-]?\s*[ivx]+)/i
  ];

  for (const pattern of unitPatterns) {
    const match = line.match(pattern);
    if (match) {
      return line.trim();
    }
  }
  return null;
}

function detectMarks(line) {
  const patterns = [
    /\((\d+)\s*marks?\)/i,
    /\[(\d+)\]/i,
    /(\d+)\s*marks?/i,
    /(\d+)\s*m\b/i
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function classifyByMarks(marks) {
  const m = parseInt(marks || '0', 10);
  if (m <= 2) return 'Short';
  if (m <= 5) return 'Medium';
  return 'Long';
}

function isQuestionLine(line) {
  if (!line || line.length < 8) return false;

  return (
    /^\d+[\). ]/.test(line) ||
    /^q[\.\s]?\d+/i.test(line) ||
    /(what|why|how|define|explain|describe|differentiate|compare|write|list|discuss)/i.test(line) ||
    line.includes('?')
  );
}

function normalizeQuestion(q) {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuestionsWithUnitsAndMarks(text) {
  const lines = splitLines(text);
  let currentUnit = 'General';
  const extracted = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const detectedUnit = detectUnit(line);
    if (detectedUnit) {
      currentUnit = detectedUnit;
      continue;
    }

    if (isQuestionLine(line)) {
      let marks = detectMarks(line);

      let questionText = line;

      if (!marks && i + 1 < lines.length) {
        const nextLineMarks = detectMarks(lines[i + 1]);
        if (nextLineMarks && lines[i + 1].length < 30) {
          marks = nextLineMarks;
        }
      }

      extracted.push({
        unit: currentUnit,
        question: questionText,
        marks: marks || 'Unknown',
        type: classifyByMarks(marks),
      });
    }
  }

  return extracted;
}

function mergeRepeatedQuestions(questions) {
  const map = {};

  for (const q of questions) {
    const normalized = normalizeQuestion(q.question);

    if (!map[normalized]) {
      map[normalized] = {
        unit: q.unit,
        question: q.question,
        marks: q.marks,
        type: q.type,
        frequency: 1,
      };
    } else {
      map[normalized].frequency += 1;

      if (map[normalized].marks === 'Unknown' && q.marks !== 'Unknown') {
        map[normalized].marks = q.marks;
        map[normalized].type = q.type;
      }
    }
  }

  return Object.values(map);
}

function buildUnitWiseData(questions) {
  const grouped = {};

  for (const q of questions) {
    if (!grouped[q.unit]) {
      grouped[q.unit] = [];
    }
    grouped[q.unit].push(q);
  }

  return Object.entries(grouped).map(([unit, questions]) => ({
    unit_name: unit,
    questions: questions.sort((a, b) => b.frequency - a.frequency),
  }));
}

function buildSummary(unitWiseData) {
  const summary = [];

  for (const unit of unitWiseData) {
    const total = unit.questions.length;
    const shortCount = unit.questions.filter(q => q.type === 'Short').length;
    const mediumCount = unit.questions.filter(q => q.type === 'Medium').length;
    const longCount = unit.questions.filter(q => q.type === 'Long').length;

    summary.push(
      `${unit.unit_name}: ${total} important questions found (${shortCount} short, ${mediumCount} medium, ${longCount} long).`
    );
  }

  return summary;
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

    let allExtractedQuestions = [];

    for (const url of pdfUrls) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
        });

        const pdfData = await pdfParse(response.data);
        const text = cleanText(pdfData.text || '');

        const extractedQuestions = extractQuestionsWithUnitsAndMarks(text);
        allExtractedQuestions.push(...extractedQuestions);
      } catch (err) {
        console.error('PDF processing error:', err.message);
      }
    }

    const mergedQuestions = mergeRepeatedQuestions(allExtractedQuestions);
    const unitWiseData = buildUnitWiseData(mergedQuestions);
    const summary = buildSummary(unitWiseData);

    const importantQuestions = mergedQuestions
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 15);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'success',
        subject,
        summary,
        important_questions: importantQuestions,
        unit_wise_questions: unitWiseData,
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
