const fs = require('fs');
const { initializeApp } = require('@firebase/app');
const { getFirestore, collection, getDocs, initializeFirestore } = require('@firebase/firestore');

async function run() {
  const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf-8'));
  const app = initializeApp(config);
  const db = initializeFirestore(app, { experimentalForceLongPolling: true }, config.firestoreDatabaseId || '(default)');

  console.log('Fetching all leads from Firestore (this is fast)...');
  const snap = await getDocs(collection(db, 'leads'));
  console.log(`Successfully fetched ${snap.size} leads from Firestore.`);

  const cloudMap = new Map();
  snap.forEach(d => {
    cloudMap.set(d.id, d.data());
  });

  const localLeads = JSON.parse(fs.readFileSync('data/leads.json', 'utf8'));
  
  // Find leads created, entered or assigned on or after 2026-09-01
  const sep1Local = localLeads.filter(l => 
    String(l.entryDate).includes('2026-09-01') || 
    String(l.createdAt).includes('2026-09-01') ||
    String(l.assignDate).includes('2026-09-01')
  );
  
  console.log(`Analyzing ${sep1Local.length} local leads on or around Sep 1st...`);
  
  let mismatchCount = 0;
  for (const local of sep1Local) {
    const cloud = cloudMap.get(local.id);
    if (cloud) {
      const stageDiff = local.stage !== cloud.stage;
      const rem1Diff = (local.remarks1 || '') !== (cloud.remarks1 || '');
      const rem2Diff = (local.remarks2 || '') !== (cloud.remarks2 || '');
      const rem3Diff = (local.remarks3 || '') !== (cloud.remarks3 || '');
      
      if (stageDiff || rem1Diff || rem2Diff || rem3Diff) {
        mismatchCount++;
        console.log(`\nMISMATCH: Lead ${local.serialNo} (${local.phone}): ${local.name}`);
        if (stageDiff) console.log(`  Stage: Local="${local.stage}" vs Cloud="${cloud.stage}"`);
        if (rem1Diff) console.log(`  Remarks1: Local="${local.remarks1}" vs Cloud="${cloud.remarks1}"`);
        if (rem2Diff) console.log(`  Remarks2: Local="${local.remarks2}" vs Cloud="${cloud.remarks2}"`);
        if (rem3Diff) console.log(`  Remarks3: Local="${local.remarks3}" vs Cloud="${cloud.remarks3}"`);
      }
    } else {
      console.log(`Lead ${local.serialNo} (${local.id}) exists locally but is missing from Cloud!`);
    }
  }
  
  console.log(`\n--- Comparison Summary ---`);
  console.log(`Total mismatches found: ${mismatchCount}`);
}

run().catch(console.error);
