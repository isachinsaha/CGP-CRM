const fs = require('fs');
const path = require('path');
const { initializeApp } = require('@firebase/app');
const { getFirestore, collection, getDocs, doc, getDoc, initializeFirestore } = require('@firebase/firestore');

async function checkDatabase(dbId) {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('firebase-applet-config.json not found!');
    return;
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const firebaseConfig = {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId
  };

  const app = initializeApp(firebaseConfig, `app-${dbId}`);
  const db = initializeFirestore(app, { experimentalForceLongPolling: true }, dbId);
  console.log(`\nChecking Database ID: "${dbId}" for project "${config.projectId}"...`);

  try {
    const leadsRef = collection(db, 'leads');
    const snap = await getDocs(leadsRef);
    console.log(`Total leads in "${dbId}": ${snap.size}`);

    let withRemarks1 = 0;
    let withRemarks2 = 0;
    let withRemarks3 = 0;
    let withTasks = 0;
    let sampleLeads = [];

    snap.forEach(d => {
      const data = d.data();
      if (data.remarks1 && data.remarks1.trim()) withRemarks1++;
      if (data.remarks2 && data.remarks2.trim()) withRemarks2++;
      if (data.remarks3 && data.remarks3.trim()) withRemarks3++;
      if (data.tasks && Array.isArray(data.tasks) && data.tasks.length > 0) withTasks++;
      
      if (sampleLeads.length < 5 && (data.remarks1 || data.remarks2 || (data.tasks && data.tasks.length > 0))) {
        sampleLeads.push({
          id: d.id,
          name: data.name,
          remarks1: data.remarks1,
          remarks2: data.remarks2,
          remarks3: data.remarks3,
          tasksCount: data.tasks ? data.tasks.length : 0,
          tasks: data.tasks
        });
      }
    });

    console.log(`Leads with remarks1: ${withRemarks1}`);
    console.log(`Leads with remarks2: ${withRemarks2}`);
    console.log(`Leads with remarks3: ${withRemarks3}`);
    console.log(`Leads with tasks: ${withTasks}`);
    if (sampleLeads.length > 0) {
      console.log('Sample leads:');
      console.log(JSON.stringify(sampleLeads, null, 2));
    }

  } catch (err) {
    console.error(`Error querying "${dbId}":`, err.message || err);
  }
}

async function run() {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const customDbId = config.firestoreDatabaseId || '(default)';
  
  await checkDatabase(customDbId);
  if (customDbId !== '(default)') {
    await checkDatabase('(default)');
  }
}

run();
