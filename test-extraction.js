/**
 * Test script to run OCR extraction on aaa.png and display results
 * Run with: node test-extraction.js
 */

const fs = require('fs');
const path = require('path');

// Load the image as a File-like object
async function testExtraction() {
  // This needs to run in a browser environment because of the HTML Canvas API
  console.log('This script needs to run in a browser environment.');
  console.log('Creating an HTML test page instead...');
}

// Create an HTML test page
const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>OCR Extraction Test</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #f5f5f5; }
    #result { background: white; padding: 20px; border-radius: 8px; margin-top: 20px; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #4CAF50; color: white; }
    button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
    .error { color: red; }
    .loading { color: blue; }
  </style>
</head>
<body>
  <h1>OCR Extraction Test for aaa.png</h1>
  <button onclick="runTest()">Run Extraction Test</button>
  <div id="result"></div>

  <script type="module">
    // Import the extraction function
    import { extractFromFile } from './src/lib/extract.ts';

    window.runTest = async function() {
      const resultDiv = document.getElementById('result');
      resultDiv.innerHTML = '<p class="loading">Loading aaa.png and running extraction...</p>';
      
      try {
        // Fetch the image file
        const response = await fetch('./aaa.png');
        const blob = await response.blob();
        const file = new File([blob], 'aaa.png', { type: 'image/png' });
        
        // Run extraction
        const result = await extractFromFile(file);
        
        // Display results
        let html = '<h2>Extraction Results</h2>';
        if (result.note) {
          html += \`<p style="background: #fff3cd; padding: 10px; border-radius: 4px;"><strong>Note:</strong> \${result.note}</p>\`;
        }
        
        html += '<h3>Subjects:</h3>';
        html += '<p>' + result.subjects.join(', ') + '</p>';
        
        html += '<h3>Extracted Rows (' + result.rows.length + ' students):</h3>';
        html += '<table>';
        html += '<thead><tr><th>Row</th><th>Student ID</th><th>Student Name</th>';
        result.subjects.forEach(s => {
          html += \`<th>\${s}</th>\`;
        });
        html += '<th>Uncertain</th></tr></thead><tbody>';
        
        result.rows.forEach((row, i) => {
          html += \`<tr><td>\${i + 1}</td><td>\${row.id}</td><td>\${row.name}</td>\`;
          result.subjects.forEach(s => {
            const val = row.scores[s] || '';
            const uncertain = row.uncertain && row.uncertain.includes(s);
            html += \`<td style="background: \${uncertain ? '#ffebee' : 'white'}">\${val}</td>\`;
          });
          html += \`<td>\${row.uncertain ? row.uncertain.join(', ') : ''}</td>\`;
          html += '</tr>';
        });
        
        html += '</tbody></table>';
        
        // Also output as JSON for easy comparison
        html += '<h3>JSON Output:</h3>';
        html += '<pre style="background: #f5f5f5; padding: 10px; overflow-x: auto;">';
        html += JSON.stringify(result, null, 2);
        html += '</pre>';
        
        resultDiv.innerHTML = html;
        
      } catch (error) {
        resultDiv.innerHTML = \`<p class="error">Error: \${error.message}</p><pre>\${error.stack}</pre>\`;
      }
    };
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'test-extraction.html'), html);
console.log('Created test-extraction.html');
console.log('Open it in a browser to run the extraction test on aaa.png');
