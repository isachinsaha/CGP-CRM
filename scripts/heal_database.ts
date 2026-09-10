import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join('data', 'leads.json');

function healDatabase() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('Database file does not exist:', DATA_FILE);
    return;
  }

  const leads = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  console.log(`Starting database self-healing on ${leads.length} leads...`);

  let healedCount = 0;
  leads.forEach((l: any) => {
    const timeline = l.timeline || [];
    let updatedRemarks1 = l.remarks1 || '';
    let updatedRemarks2 = l.remarks2 || '';
    let updatedRemarks3 = l.remarks3 || '';

    // Sort timeline by timestamp ascending so that later remarks updates correctly override earlier ones
    const sortedTimeline = [...timeline].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

    let changed = false;
    sortedTimeline.forEach((t: any) => {
      if (t.type === 'remark' || (t.text && t.text.includes('Remarks'))) {
        const text = t.text || '';
        const match1 = text.match(/Updated 1st Remarks:\s*"([^"]+)"/);
        const match2 = text.match(/Updated 2nd Remarks:\s*"([^"]+)"/);
        const match3 = text.match(/Updated 3rd Remarks:\s*"([^"]+)"/);

        if (match1 && !l.remarks1) {
          updatedRemarks1 = match1[1];
          changed = true;
        }
        if (match2 && !l.remarks2) {
          updatedRemarks2 = match2[1];
          changed = true;
        }
        if (match3 && !l.remarks3) {
          updatedRemarks3 = match3[1];
          changed = true;
        }
      }
    });

    if (changed) {
      healedCount++;
      console.log(`Healing Lead: ${l.id} (${l.name})`);
      if (updatedRemarks1 !== (l.remarks1 || '')) {
        console.log(`  -> remarks1: "${l.remarks1 || ''}" -> "${updatedRemarks1}"`);
        l.remarks1 = updatedRemarks1;
      }
      if (updatedRemarks2 !== (l.remarks2 || '')) {
        console.log(`  -> remarks2: "${l.remarks2 || ''}" -> "${updatedRemarks2}"`);
        l.remarks2 = updatedRemarks2;
      }
      if (updatedRemarks3 !== (l.remarks3 || '')) {
        console.log(`  -> remarks3: "${l.remarks3 || ''}" -> "${updatedRemarks3}"`);
        l.remarks3 = updatedRemarks3;
      }
      l.updatedAt = new Date().toISOString();
    }
  });

  if (healedCount > 0) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');
    console.log(`Successfully healed ${healedCount} leads and updated leads.json!`);
  } else {
    console.log('No leads needed healing; all remarks are perfectly in sync.');
  }
}

healDatabase();
