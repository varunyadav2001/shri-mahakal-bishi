/**
 * ==============================================================================
 * NARAYAN BHISHI - TRANSLITERATE DOC ID UTILITY (src/utils/transliterateDocId.ts)
 * ==============================================================================
 * Converts Marathi / Devanagari strings, customer names, bishi scheme titles,
 * and installment labels into clean, URL-safe Latin/ASCII strings for Firestore.
 *
 * This prevents Firestore Console from URL-encoding Devanagari into unreadable
 * "%E0%A4%..." percent-encoded format (which looks like encrypted hashes).
 * ==============================================================================
 */

const MARATHI_DICTIONARY: Record<string, string> = {
  // Bishi & Scheme Names
  'दिवाळी': 'Diwali',
  'भिशी': 'Bishi',
  'भिषी': 'Bishi',
  'गणेश': 'Ganesh',
  'गणपती': 'Ganpati',
  'दसरा': 'Dasara',
  'दसरा भिशी': 'Dasara_Bishi',
  'दसऱ्याची भिशी': 'Dasara_Bishi',
  'जानेवारी': 'January',
  'फेब्रुवारी': 'February',
  'मार्च': 'March',
  'एप्रिल': 'April',
  'मे': 'May',
  'जून': 'June',
  'जुलै': 'July',
  'ऑगस्ट': 'August',
  'सप्टेंबर': 'September',
  'ऑक्टोबर': 'October',
  'नोव्हेंबर': 'November',
  'डिसेंबर': 'December',
  'नवरात्री': 'Navratri',
  'होळी': 'Holi',
  'गुढी': 'Gudi',
  'पाडवा': 'Padwa',
  'राखी': 'Rakhi',
  'मकर': 'Makar',
  'संक्रांती': 'Sankranti',
  'छत्रपती': 'Chhatrapati',
  'शिवाजी': 'Shivaji',
  'महाराज': 'Maharaj',
  'भीम': 'Bhim',
  'जयंती': 'Jayanti',
  'नवीन': 'Navin',
  'योजना': 'Yojana',
  'साप्ताहिक': 'Weekly',
  'मासिक': 'Monthly',
  'कर्ज': 'Loan',
  'हप्ता': 'Hapta',
  'पावती': 'Receipt',
  'थकबाकी': 'Thakbaki',
  'बचत': 'Bachat',
  'श्री': 'Shree',
  'ओम': 'Om',
  'जय': 'Jai',
  'आठवडा': 'Week',
  'महिना': 'Month',
  'वर्ष': 'Year',

  // Common Names
  'नारायण': 'Narayan',
  'सचिन': 'Sachin',
  'राहुल': 'Rahul',
  'अमित': 'Amit',
  'संतोष': 'Santosh',
  'अनिल': 'Anil',
  'सुनील': 'Sunil',
  'महेश': 'Mahesh',
  'राजेश': 'Rajesh',
  'अजय': 'Ajay',
  'विजय': 'Vijay',
  'प्रकाश': 'Prakash',
  'दीपक': 'Deepak',
  'दिपक': 'Deepak',
  'सुरेश': 'Suresh',
  'रमेश': 'Ramesh',
  'दिनेश': 'Dinesh',
  'प्रमोद': 'Pramod',
  'प्रशांत': 'Prashant',
  'प्रवीण': 'Praveen',
  'संदीप': 'Sandeep',
  'मंगेश': 'Mangesh',
  'राम': 'Ram',
  'श्याम': 'Shyam',
  'विष्णू': 'Vishnu',
  'हनुमंत': 'Hanumant',
  'बालाजी': 'Balaji',
  'विश्वजीत': 'Vishwajit',
  'आदित्य': 'Aditya',
  'ओमकार': 'Omkar',
  'रोहित': 'Rohit',
  'आकाश': 'Akash',
  'सूरज': 'Suraj',
  'अमोल': 'Amol',
  'आनंद': 'Anand',
  'नितीन': 'Nitin',
  'विक्रम': 'Vikram',
  'स्वप्निल': 'Swapnil',
  'अतुल': 'Atul',
  'किरण': 'Kiran',
  'चेतन': 'Chetan',
  'योगेश': 'Yogesh',
  'गणेश भिशी': 'Ganesh_Bishi',
  'दिवाळी भिशी': 'Diwali_Bishi',

  // Common Surnames
  'पाटील': 'Patil',
  'शिंदे': 'Shinde',
  'पवार': 'Pawar',
  'जाधव': 'Jadhav',
  'चव्हाण': 'Chavan',
  'भोसले': 'Bhosale',
  'मोरे': 'More',
  'गायकवाड': 'Gaikwad',
  'कदम': 'Kadam',
  'माने': 'Mane',
  'सावंत': 'Sawant',
  'देशमुख': 'Deshmukh',
  'जोशी': 'Joshi',
  'कुलकर्णी': 'Kulkarni',
  'शहा': 'Shah',
  'गुप्ता': 'Gupta',
  'यादव': 'Yadav',
  'वाघ': 'Wagh',
  'तांबोळी': 'Tamboli',
  'शेळके': 'Shelke',
  'जगताप': 'Jagtap',
  'सोनवणे': 'Sonawane',
  'कांबळे': 'Kamble',
  'नाईक': 'Naik',
  'सुलताने': 'Sultane',
};

const DEVANAGARI_DIGITS: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

const DEVANAGARI_VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u',
  'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o',
  'औ': 'au', 'अं': 'am', 'अः': 'ah', 'ॲ': 'a', 'ऑ': 'o',
};

const DEVANAGARI_MATRAS: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
  'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  'ं': 'n', 'ः': 'h', 'ॅ': 'a', 'ॉ': 'o',
};

const DEVANAGARI_CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
  'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l', 'क्ष': 'ksh',
  'ज्ञ': 'dny',
};

/**
 * Converts a text string (potentially in Marathi/Devanagari) into a clean,
 * human-readable Latin/ASCII identifier suitable for Firestore document IDs.
 */
export function toReadableDocIdString(text: any): string {
  if (!text) return '';
  let str = String(text).trim();

  // 1. Replace known Marathi dictionary words
  for (const [mr, en] of Object.entries(MARATHI_DICTIONARY)) {
    str = str.split(mr).join(en);
  }

  // 2. Replace Devanagari numerals
  str = str.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] || d);

  // 3. Phonetic character-by-character conversion for remaining Devanagari letters
  let result = '';
  const chars = Array.from(str);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];

    if (DEVANAGARI_CONSONANTS[ch]) {
      const cons = DEVANAGARI_CONSONANTS[ch];
      if (next === '्') {
        result += cons;
        i++; // skip halant
      } else if (next && DEVANAGARI_MATRAS[next]) {
        result += cons + DEVANAGARI_MATRAS[next];
        i++; // skip matra
      } else if (next && (DEVANAGARI_CONSONANTS[next] || DEVANAGARI_VOWELS[next])) {
        result += cons + 'a';
      } else {
        result += cons;
      }
    } else if (DEVANAGARI_VOWELS[ch]) {
      result += DEVANAGARI_VOWELS[ch];
    } else if (DEVANAGARI_MATRAS[ch]) {
      result += DEVANAGARI_MATRAS[ch];
    } else {
      result += ch;
    }
  }

  // 4. Clean up punctuation, special characters, and repeated underscores
  return result
    .replace(/[^\w-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
