import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json' assert { type: 'json' };

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkFileBackups() {
  console.log('=== CHECKING FILE_BACKUPS IN FIRESTORE ===');
  const snap = await getDocs(collection(db, 'file_backups'));
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`Doc ID: ${doc.id}`);
    console.log(`  path: ${data.path}`);
    console.log(`  timestamp: ${data.timestamp}`);
    console.log(`  content size: ${data.content ? data.content.length : 'empty'}`);
  });
  process.exit(0);
}

checkFileBackups().catch(console.error);
