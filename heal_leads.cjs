const fs = require('fs');

function getStageKey(label) {
  const stageMap = {
    'new': 'new',
    'new inbound': 'new',
    'in discussion': 'in_discussion',
    'in_discussion': 'in_discussion',
    'in rotations': 'rotations',
    'rotations': 'rotations',
    'office visited/interview attended': 'office_visited',
    'office visited': 'office_visited',
    'office_visited': 'office_visited',
    'strong_opportunity': 'strong_opportunity',
    'strong opportunity': 'strong_opportunity',
    'cold_leads': 'cold_leads',
    'cold leads': 'cold_leads',
    'closed won': 'won',
    'won': 'won',
    'closed lost': 'lost',
    'lost': 'lost'
  };
  const key = String(label).toLowerCase().trim();
  return stageMap[key] || null;
}

function healLeads(dryRun = true) {
  const dataPath = 'data/leads.json';
  if (!fs.existsSync(dataPath)) {
    console.error('leads.json not found!');
    return;
  }

  const leads = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  let healedCount = 0;
  let stageRestoredCount = 0;
  let remarksRestoredCount = 0;

  leads.forEach(l => {
    if (!l.timeline || !Array.isArray(l.timeline)) return;

    // Sort timeline chronologically by timestamp
    const sortedTimeline = [...l.timeline].sort((a, b) => {
      return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
    });

    let latestStage = null;
    let latestRemarks1 = null;
    let latestRemarks2 = null;
    let latestRemarks3 = null;

    sortedTimeline.forEach(e => {
      const text = e.text || '';
      
      // 1. Parse stage changes
      const stageChangeMatch = text.match(/Pipeline stage changed from ".*" to "(.*)"/i);
      if (stageChangeMatch && stageChangeMatch[1]) {
        const stageKey = getStageKey(stageChangeMatch[1]);
        if (stageKey) latestStage = stageKey;
      }

      const stageAutoMatch = text.match(/Pipeline stage auto-moved to "(.*)"/i);
      if (stageAutoMatch && stageAutoMatch[1]) {
        const stageKey = getStageKey(stageAutoMatch[1]);
        if (stageKey) latestStage = stageKey;
      }

      // 2. Parse remarks updates
      const rem1Match = text.match(/Updated 1st Remarks: "(.*)"/i);
      if (rem1Match && rem1Match[1]) {
        latestRemarks1 = rem1Match[1] === 'cleared' ? '' : rem1Match[1];
      }

      const rem2Match = text.match(/Updated 2nd Remarks: "(.*)"/i);
      if (rem2Match && rem2Match[1]) {
        latestRemarks2 = rem2Match[1] === 'cleared' ? '' : rem2Match[1];
      }

      const rem3Match = text.match(/Updated 3rd Remarks: "(.*)"/i);
      if (rem3Match && rem3Match[1]) {
        latestRemarks3 = rem3Match[1] === 'cleared' ? '' : rem3Match[1];
      }
    });

    let hasChange = false;
    const changes = [];

    // Stage Safeguard: Only change if it's currently 'new' (the symptom of the bug),
    // or if the timeline stage is set and the current stage is different but empty/unset.
    if (latestStage && l.stage !== latestStage) {
      if (l.stage === 'new' || !l.stage) {
        changes.push(`stage: "${l.stage || 'new'}" -> "${latestStage}"`);
        if (!dryRun) l.stage = latestStage;
        stageRestoredCount++;
        hasChange = true;
      }
    }

    // Remarks Safeguards: Only restore if currently empty or if the timeline value is longer than current.
    if (latestRemarks1 && l.remarks1 !== latestRemarks1) {
      const current = (l.remarks1 || '').trim();
      const target = latestRemarks1.trim();
      if (current === '' || target.length > current.length) {
        changes.push(`remarks1: "${l.remarks1 || ''}" -> "${latestRemarks1}"`);
        if (!dryRun) l.remarks1 = latestRemarks1;
        remarksRestoredCount++;
        hasChange = true;
      }
    }

    if (latestRemarks2 && l.remarks2 !== latestRemarks2) {
      const current = (l.remarks2 || '').trim();
      const target = latestRemarks2.trim();
      if (current === '' || target.length > current.length) {
        changes.push(`remarks2: "${l.remarks2 || ''}" -> "${latestRemarks2}"`);
        if (!dryRun) l.remarks2 = latestRemarks2;
        remarksRestoredCount++;
        hasChange = true;
      }
    }

    if (latestRemarks3 && l.remarks3 !== latestRemarks3) {
      const current = (l.remarks3 || '').trim();
      const target = latestRemarks3.trim();
      if (current === '' || target.length > current.length) {
        changes.push(`remarks3: "${l.remarks3 || ''}" -> "${latestRemarks3}"`);
        if (!dryRun) l.remarks3 = latestRemarks3;
        remarksRestoredCount++;
        hasChange = true;
      }
    }

    if (hasChange) {
      healedCount++;
      console.log(`Lead ${l.serialNo || l.id} (${l.phone}): ${l.name}`);
      changes.forEach(c => console.log(`  [RESTORED] ${c}`));
    }
  });

  console.log(`\n--- Summary (${dryRun ? 'DRY RUN' : 'LIVE RESTORATION'}) ---`);
  console.log(`Total leads healed: ${healedCount}`);
  console.log(`Stage fields restored: ${stageRestoredCount}`);
  console.log(`Remarks fields restored: ${remarksRestoredCount}`);

  if (!dryRun && healedCount > 0) {
    fs.writeFileSync(dataPath, JSON.stringify(leads, null, 2), 'utf8');
    // Delete the sync token to force a write to Firestore
    const syncTokenPath = 'data/leads_last_synced.json';
    if (fs.existsSync(syncTokenPath)) {
      fs.unlinkSync(syncTokenPath);
      console.log('Deleted leads_last_synced.json to force full upload to Firestore.');
    }
    console.log('leads.json updated successfully with restored properties.');
  }
}

// Run in dry run mode by default
const isLive = process.argv.includes('--live');
healLeads(!isLive);
