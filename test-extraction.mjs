import { extractFromFile } from './src/lib/extract.ts';
import fs from 'fs';

const filePath = './aaa.png';
const fileBuffer = fs.readFileSync(filePath);
const file = new File([fileBuffer], 'aaa.png', { type: 'image/png' });

try {
  const result = await extractFromFile(file);
  
  console.log('\n=== EXTRACTION RESULTS ===\n');
  console.log('Subjects:', result.subjects);
  console.log('\nNote:', result.note || 'None');
  console.log('\nTotal rows:', result.rows.length);
  console.log('\n=== STUDENT DATA ===\n');
  
  result.rows.forEach((row, idx) => {
    console.log(`Row ${idx + 1}:`);
    console.log(`  ID: ${row.id}`);
    console.log(`  Name: ${row.name}`);
    console.log(`  Scores:`, JSON.stringify(row.scores));
    if (row.uncertain?.length) {
      console.log(`  Uncertain: ${row.uncertain.join(', ')}`);
    }
    console.log('');
  });

  // Format as table for comparison
  console.log('\n=== TABLE FORMAT ===\n');
  console.log('Subjects:', result.subjects.join(' | '));
  console.log('');
  result.rows.forEach((row, idx) => {
    const scores = result.subjects.map(s => row.scores[s] || '').join(', ');
    console.log(`Row ${idx + 1}: ${row.id}, ${row.name}, ${scores}`);
  });

} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
}
