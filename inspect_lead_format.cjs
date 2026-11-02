const fs = require('fs');
const leads = JSON.parse(fs.readFileSync('data/leads.json', 'utf-8'));

console.log('--- LEADS FORMAT INSPECTION ---');
const sample = leads.filter(l => l.stageHistory && l.stageHistory.length > 1).slice(0, 3);
if (sample.length === 0) {
  console.log('No leads with stageHistory length > 1 found, showing first 3 leads instead:');
  console.log(JSON.stringify(leads.slice(0, 3), null, 2));
} else {
  console.log(JSON.stringify(sample, null, 2));
}
