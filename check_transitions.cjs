const fs = require('fs');
const leads = JSON.parse(fs.readFileSync('data/leads.json', 'utf-8'));

function backfillLeadHistory(lead) {
  if (!lead.stageHistory) lead.stageHistory = [];
  if (!lead.coordinatorHistory) lead.coordinatorHistory = [];

  if (lead.stageHistory.length === 0 && lead.timeline && lead.timeline.length > 0) {
    const sortedTimeline = [...lead.timeline].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
    let currentStage = 'new';
    let currentCoordinator = lead.assignedTo || 'unassigned';

    lead.stageHistory.push({
      candidateId: lead.id,
      previousStage: 'none',
      newStage: 'new',
      changedBy: 'System (Backfill)',
      coordinatorId: currentCoordinator,
      changedAt: lead.createdAt || lead.entryDate || new Date().toISOString(),
      project: lead.project,
      country: lead.country
    });

    sortedTimeline.forEach((t) => {
      const text = (t.text || '').toLowerCase();
      const timestamp = t.timestamp || new Date().toISOString();
      const actor = t.actor || 'System';

      if (t.type === 'status' || text.includes('pipeline stage changed') || text.includes('pipeline stage auto-moved')) {
        let fromStage = '';
        let toStage = '';

        if (text.includes('changed from') && text.includes('to')) {
          const parts = text.split('changed from');
          if (parts[1]) {
            const subParts = parts[1].split('to');
            fromStage = subParts[0].replace(/['"“”]/g, '').trim();
            toStage = subParts[1].replace(/['"“”]/g, '').trim();
          }
        }
        const mapLabelToKey = (label) => {
          const l = label.toLowerCase().trim();
          if (l.includes('new inbound') || l === 'new') return 'new';
          if (l.includes('in discussion') || l.includes('negotiating') || l === 'discussion') return 'in_discussion';
          if (l.includes('strong opportunity') || l.includes('rotations') || l === 'strong') return 'strong_opportunity';
          if (l.includes('office visited') || l.includes('interview') || l.includes('proposal')) return 'office_visited';
          if (l.includes('won') || l.includes('closed won')) return 'won';
          if (l.includes('cold') || l.includes('cold leads')) return 'cold_leads';
          if (l.includes('lost') || l.includes('closed lost')) return 'lost';
          return l;
        };

        const newStageKey = toStage ? mapLabelToKey(toStage) : '';
        const prevStageKey = fromStage ? mapLabelToKey(fromStage) : currentStage;

        if (newStageKey) {
          lead.stageHistory.push({
            candidateId: lead.id,
            previousStage: prevStageKey,
            newStage: newStageKey,
            changedBy: actor,
            coordinatorId: currentCoordinator,
            changedAt: timestamp,
            project: lead.project,
            country: lead.country
          });
          currentStage = newStageKey;
        }
      }

      if (t.type === 'assignment' || text.includes('assigned coordinator changed')) {
        let fromCoord = '';
        let toCoord = '';
        if (text.includes('changed from') && text.includes('to')) {
          const parts = text.split('changed from');
          if (parts[1]) {
            const subParts = parts[1].split('to');
            fromCoord = subParts[0].replace(/['"“”]/g, '').trim();
            toCoord = subParts[1].split('via')[0].replace(/['"“”]/g, '').trim();
          }
        }
        if (toCoord) {
          lead.coordinatorHistory.push({
            candidateId: lead.id,
            previousCoordinator: fromCoord || 'unassigned',
            newCoordinator: toCoord,
            changedBy: actor,
            changedAt: timestamp
          });
          currentCoordinator = toCoord;
        }
      }
    });
  }

  if (lead.stageHistory.length === 0) {
    lead.stageHistory.push({
      candidateId: lead.id,
      previousStage: 'none',
      newStage: lead.stage || 'new',
      changedBy: 'System (Initial)',
      coordinatorId: lead.assignedTo || 'unassigned',
      changedAt: lead.createdAt || lead.entryDate || new Date().toISOString(),
      project: lead.project,
      country: lead.country
    });
  }

  if (lead.coordinatorHistory.length === 0) {
    lead.coordinatorHistory.push({
      candidateId: lead.id,
      previousCoordinator: 'unassigned',
      newCoordinator: lead.assignedTo || 'unassigned',
      changedBy: 'System (Initial)',
      changedAt: lead.assignDate || lead.createdAt || lead.entryDate || new Date().toISOString()
    });
  }
}

leads.forEach(lead => backfillLeadHistory(lead));

const getMonthStr = (dateVal) => {
  if (!dateVal) return '';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) {
      if (typeof dateVal === 'string' && /^\d{4}-\d{2}/.test(dateVal)) {
        return dateVal.slice(0, 7);
      }
      return '';
    }
    return d.toISOString().slice(0, 7);
  } catch {
    return '';
  }
};

const matchesMonth = (timestamp, targetMonth) => {
  if (!timestamp) return false;
  return getMonthStr(timestamp) === targetMonth;
};

const stdStage = (st) => {
  if (!st) return 'new';
  const s = st.toLowerCase().trim();
  if (s === 'negotiating') return 'in_discussion';
  if (s === 'rotations') return 'cold_leads';
  if (s === 'proposal') return 'office_visited';
  return s;
};

const targetMonth = '2026-10';
const previousMonth = '2026-09';
const coordSelector = 'joyce';

let octTransitions = 0;
let sepTransitions = 0;

leads.forEach(lead => {
  if (lead.isDeleted) return;
  // Check intake
  const assigned = String(lead.assignedTo || '').trim().toLowerCase();
  const hasRealCoordinator = assigned !== 'unassigned' && assigned !== '' && assigned !== 'admin' && assigned !== 'test';
  const hasNotes = !!(lead.notes && lead.notes.trim());
  const hasDoc = !!(lead.passportCopyUrl || lead.resumeUrl || lead.docResume || lead.docPassportCopy || lead.docOfficeVisited || lead.docInterviewAttended || lead.docOthers);
  const isIntaken = lead.intake === true || hasRealCoordinator || hasNotes || hasDoc;
  if (!isIntaken) return;

  const isMatchCoord = (username) => {
    if (!username) return false;
    return username.toLowerCase() === coordSelector.toLowerCase();
  };

  // October transitions to strong_opportunity
  const hasOctTransition = (lead.stageHistory || []).some(e => matchesMonth(e.changedAt, targetMonth) && stdStage(e.newStage) === 'strong_opportunity' && isMatchCoord(e.coordinatorId || lead.assignedTo));
  // Initial stage transition if created in October and is strong_opportunity
  const initialOctStrong = matchesMonth(lead.createdAt || lead.entryDate, targetMonth) && stdStage(lead.stageHistory[0]?.newStage) === 'strong_opportunity' && isMatchCoord(lead.assignedTo);

  if (hasOctTransition || initialOctStrong) {
    octTransitions++;
  }

  // September transitions to strong_opportunity
  const hasSepTransition = (lead.stageHistory || []).some(e => matchesMonth(e.changedAt, previousMonth) && stdStage(e.newStage) === 'strong_opportunity' && isMatchCoord(e.coordinatorId || lead.assignedTo));
  // Initial stage transition if created in September and is strong_opportunity
  const initialSepStrong = matchesMonth(lead.createdAt || lead.entryDate, previousMonth) && stdStage(lead.stageHistory[0]?.newStage) === 'strong_opportunity' && isMatchCoord(lead.assignedTo);

  if (hasSepTransition || initialSepStrong) {
    sepTransitions++;
  }
});

console.log(`October transitions to strong_opportunity: ${octTransitions}`);
console.log(`September transitions to strong_opportunity: ${sepTransitions}`);
