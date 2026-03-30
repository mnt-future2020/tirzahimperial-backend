const Groq = require('groq-sdk');

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Generate Tamil variations using phonetic mapping
 * @param {string} text - English text
 * @returns {string[]} - Array of Tamil variations (empty for now, will use Groq AI)
 */
function generatePhoneticVariations(text) {
  // Return empty array - will rely on Groq AI for transliteration
  return [];
}

/**
 * Transliterate English text to Tamil using Groq AI
 * @param {string} englishText - English text to transliterate
 * @returns {Promise<string[]>} - Array of Tamil text variations
 */
async function transliterateToTamil(englishText) {
  try {
    if (!englishText || englishText.trim().length === 0) {
      return [englishText];
    }

    // Use Groq AI for transliteration
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are a Tamil transliteration expert. Convert English phonetic text to Tamil script. Provide 3-5 possible Tamil spelling variations separated by commas. Only return Tamil text variations, nothing else.',
        },
        {
          role: 'user',
          content: `Transliterate to Tamil: "${englishText}"`,
        },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 150,
    });

    const response = chatCompletion.choices[0]?.message?.content?.trim() || englishText;
    const aiVariations = response.split(',').map(v => v.trim()).filter(v => v.length > 0);
    
    console.log(`[Tamil Transliteration] "${englishText}" -> [${aiVariations.join(', ')}]`);
    
    return aiVariations.length > 0 ? aiVariations : [englishText];
  } catch (error) {
    console.error('[Tamil Transliteration] Error:', error.message);
    return [englishText];
  }
}

/**
 * Check if Tamil text contains any of the search variations (fuzzy match)
 * @param {string} tamilText - Tamil text to search in
 * @param {string[]} searchVariations - Array of Tamil search variations
 * @returns {boolean} - True if any variation matches
 */
function fuzzyTamilMatch(tamilText, searchVariations) {
  if (!tamilText) return false;
  
  const lowerText = tamilText.toLowerCase();
  
  return searchVariations.some(variation => {
    const lowerVariation = variation.toLowerCase();
    
    // Direct substring match
    if (lowerText.includes(lowerVariation)) return true;
    
    // Character-by-character fuzzy match
    const textChars = Array.from(lowerText);
    const varChars = Array.from(lowerVariation);
    
    // If variation is very short, require exact match
    if (varChars.length <= 2) {
      return lowerText.includes(lowerVariation);
    }
    
    // For longer variations, check if most characters match in sequence
    let matchCount = 0;
    let textIndex = 0;
    
    for (const varChar of varChars) {
      while (textIndex < textChars.length) {
        if (textChars[textIndex] === varChar) {
          matchCount++;
          textIndex++;
          break;
        }
        textIndex++;
      }
    }
    
    // If 60% or more characters match in sequence, consider it a match
    const matchRatio = matchCount / varChars.length;
    if (matchRatio >= 0.6) return true;
    
    // Also try reverse: check how many chars from text are in variation
    let reverseMatchCount = 0;
    let varIndex = 0;
    
    for (const textChar of textChars) {
      while (varIndex < varChars.length) {
        if (varChars[varIndex] === textChar) {
          reverseMatchCount++;
          varIndex++;
          break;
        }
        varIndex++;
      }
    }
    
    const reverseMatchRatio = reverseMatchCount / textChars.length;
    return reverseMatchRatio >= 0.6;
  });
}

module.exports = {
  transliterateToTamil,
  fuzzyTamilMatch,
};
