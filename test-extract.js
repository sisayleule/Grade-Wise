// Quick test to check extraction
const fs = require('fs');
const path = require('path');

async function test() {
  // Read the extract.ts file to understand the issue
  const extractCode = fs.readFileSync('./src/lib/extract.ts', 'utf8');
  
  // Check for the key functions
  const hasFuzzySubject = extractCode.includes('function fuzzySubject');
  const hasCorrectSubjectName = extractCode.includes('function correctSubjectName');
  const hasHeaderTokenScore = extractCode.includes('function headerTokenScore');
  const hasClassifyColumns = extractCode.includes('function classifyColumns');
  
  console.log('Code Analysis:');
  console.log('- fuzzySubject:', hasFuzzySubject);
  console.log('- correctSubjectName:', hasCorrectSubjectName);
  console.log('- headerTokenScore:', hasHeaderTokenScore);
  console.log('- classifyColumns:', hasClassifyColumns);
  
  // Check the HEADER_ID pattern
  const headerIdMatch = extractCode.match(/const HEADER_ID\s*=\s*([^;]+);/);
  if (headerIdMatch) {
    console.log('\nHEADER_ID pattern:', headerIdMatch[1]);
  }
  
  // Check if "No." is being handled
  const hasNoPattern = extractCode.includes('no\\.');
  console.log('- Handles "No." pattern:', hasNoPattern);
}

test().catch(console.error);
