import { GoogleGenAI } from '@google/genai';
import type { Lead, Coordinator } from '../types.ts';
import { getLeads, getCoordinators, getJobs, updateMultipleLeads } from './db.ts';
import { getEffectiveIntake, isCoordinatorMatch } from '../utils.ts';

function getAiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return null;
  }
  try {
    return new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  } catch (err) {
    console.error('[AI Assistant] Failed to initialize GoogleGenAI:', err);
    return null;
  }
}

export interface AssistantAlert {
  id: string;
  type: 'urgent' | 'warning' | 'opportunity' | 'info';
  title: string;
  description: string;
  count?: number;
  leadIds?: string[];
  suggestedAction: string;
  actionType?: 'view_leads' | 'reassign' | 'send_template' | 'fix_stale_unread' | 'archive_stagnant';
  bucketKey?: 'unread' | 'staleUnread' | 'unassigned' | 'stagnant' | 'interviewReady';
}

export type SentinelAlert = AssistantAlert;

export interface CoordinatorWorkload {
  id: string;
  username: string;
  name: string;
  activeLeads: number;
  newInbound: number;
  inDiscussion: number;
  stagnantLeads: number;
  wonLeads: number;
  unreadLeads: number;
  status: 'optimal' | 'busy' | 'overloaded' | 'available';
  recommendation: string;
}

export interface AssistantLeadItem {
  id: string;
  name: string;
  phone: string;
  country: string;
  project: string;
  position: string;
  stage: string;
  assignedTo: string;
  lastActivityAt: string;
  inactiveDays: number;
  unreadCount: number;
  latestMessageText?: string;
  hasDocs: boolean;
}

export interface HealthBreakdown {
  responseScore: number;
  responseMax: number;
  assignmentScore: number;
  assignmentMax: number;
  velocityScore: number;
  velocityMax: number;
  staleUnreadFlagCount: number;
  stagnant3to7Days: number;
  stagnant7to30Days: number;
  stagnantOver30Days: number;
}

export interface SentinelOverview {
  healthScore: number; // 0 - 100
  healthBreakdown: HealthBreakdown;
  scopedRole: 'admin' | 'coordinator';
  scopedAgentId: string;
  secondaryMetricMode: 'unassigned' | 'my_new_inbounds';
  totalActiveCandidates: number;
  alerts: AssistantAlert[];
  coordinatorWorkloads: CoordinatorWorkload[];
  availableCoordinators: { username: string; name: string }[];
  pipelineSummary: {
    newInbound: number;
    inDiscussion: number;
    strongOpportunity: number;
    officeVisited: number;
    won: number;
    coldLeads: number;
    lost: number;
  };
  stagnantCount: number;
  unassignedCount: number;
  unreadRepliesCount: number;
  unreadMessagesCount: number;
  staleUnreadCount: number;
  interviewReadyCount: number;
  drilldowns: {
    unread: AssistantLeadItem[];
    staleUnread: AssistantLeadItem[];
    unassigned: AssistantLeadItem[];
    stagnant: AssistantLeadItem[];
    interviewReady: AssistantLeadItem[];
  };
  aiInsights: string[];
  lastScannedAt: string;
}

function normalizeStageKey(rawStage?: string): string {
  const s = String(rawStage || 'new').toLowerCase().trim();
  if (s === 'negotiating') return 'in_discussion';
  if (s === 'proposal') return 'office_visited';
  if (s === 'rotations') return 'cold_leads';
  return s || 'new';
}

function isLeadAssigned(lead: Lead): boolean {
  const val = String(lead.assignedTo || '').trim().toLowerCase();
  return val !== '' && val !== 'unassigned' && val !== 'all';
}

function getRealMessages(lead: Lead) {
  return (lead.messages || []).filter(
    (m) => m && (!m.text || !m.text.includes('Lead enrolled manually in CGP system database'))
  );
}

function getTrueLastActivityMs(lead: Lead): number {
  const candidates = [
    lead.stageChangedAt,
    lead.updatedAt,
    lead.assignDate,
    lead.createdAt,
    lead.entryDate
  ];
  let maxMs = 0;
  for (const ts of candidates) {
    if (!ts) continue;
    const ms = new Date(ts).getTime();
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  for (const m of getRealMessages(lead)) {
    if (!m.timestamp) continue;
    const ms = new Date(m.timestamp).getTime();
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  for (const tl of lead.timeline || []) {
    if (!tl?.timestamp) continue;
    const ms = new Date(tl.timestamp).getTime();
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  for (const t of lead.tasks || []) {
    if (!t?.createdAt) continue;
    const ms = new Date(t.createdAt).getTime();
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  return maxMs;
}

function toAssistantLeadItem(
  lead: Lead,
  now: number,
  unreadCount: number,
  latestMessageText?: string
): AssistantLeadItem {
  const lastActMs = getTrueLastActivityMs(lead) || now;
  const inactiveDays = Math.max(0, Math.floor((now - lastActMs) / (24 * 60 * 60 * 1000)));
  return {
    id: lead.id,
    name: lead.name || 'Unnamed Candidate',
    phone: lead.phone || '',
    country: lead.country || 'Not Set',
    project: lead.project || 'General',
    position: lead.position || 'Not Specified',
    stage: normalizeStageKey(lead.stage),
    assignedTo: lead.assignedTo || 'Unassigned',
    lastActivityAt: new Date(lastActMs).toISOString(),
    inactiveDays,
    unreadCount,
    latestMessageText,
    hasDocs: Boolean(lead.docPassportCopy || lead.passportCopyUrl || lead.docResume || lead.resumeUrl)
  };
}

export async function computeSentinelOverview(options?: {
  userRole?: string;
  agentId?: string;
  forceRefresh?: boolean;
}): Promise<SentinelOverview> {
  const userRole = String(options?.userRole || 'user').trim().toLowerCase();
  const agentId = String(options?.agentId || '').trim();
  const isAdmin = userRole === 'admin';

  const [allLeads, coordinators] = await Promise.all([
    getLeads(Boolean(options?.forceRefresh)),
    getCoordinators()
  ]);

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const THREE_DAYS = 3 * ONE_DAY;
  const SEVEN_DAYS = 7 * ONE_DAY;
  const THIRTY_DAYS = 30 * ONE_DAY;

  const nonDeletedLeads = allLeads.filter((l) => l && !l.isDeleted);

  // Strict RBAC: coordinators ONLY see leads assigned to them
  const scopedLeads = isAdmin
    ? nonDeletedLeads
    : nonDeletedLeads.filter((l) => isCoordinatorMatch(l.assignedTo, agentId, coordinators));

  const pipelineSummary = {
    newInbound: 0,
    inDiscussion: 0,
    strongOpportunity: 0,
    officeVisited: 0,
    won: 0,
    coldLeads: 0,
    lost: 0
  };

  const unassignedOrNewInbounds: AssistantLeadItem[] = [];
  const stagnantInDiscussion: AssistantLeadItem[] = [];
  const interviewOpportunities: AssistantLeadItem[] = [];
  const unreadReplies: AssistantLeadItem[] = [];
  const staleUnreadAlreadyReplied: AssistantLeadItem[] = [];

  let unreadMessagesTotal = 0;
  let stagnant3to7Days = 0;
  let stagnant7to30Days = 0;
  let stagnantOver30Days = 0;

  // Coordinator workload tracking (only populated for self if coordinator, or all active staff for admin)
  const coordMap: Record<
    string,
    { total: number; newInbound: number; inDiscussion: number; stagnant: number; won: number; unread: number }
  > = {};

  for (const c of coordinators) {
    if (!isAdmin && !isCoordinatorMatch(c.username, agentId, coordinators)) continue;
    coordMap[c.username.toLowerCase()] = {
      total: 0,
      newInbound: 0,
      inDiscussion: 0,
      stagnant: 0,
      won: 0,
      unread: 0
    };
  }

  for (const lead of scopedLeads) {
    const stage = normalizeStageKey(lead.stage);
    const intaken = getEffectiveIntake(lead);
    const assigned = isLeadAssigned(lead);

    if (intaken) {
      if (stage === 'new') pipelineSummary.newInbound++;
      else if (stage === 'in_discussion') pipelineSummary.inDiscussion++;
      else if (stage === 'strong_opportunity') pipelineSummary.strongOpportunity++;
      else if (stage === 'office_visited') pipelineSummary.officeVisited++;
      else if (stage === 'won') pipelineSummary.won++;
      else if (stage === 'cold_leads') pipelineSummary.coldLeads++;
      else if (stage === 'lost') pipelineSummary.lost++;
    }

    // Real-time Unread Messages check
    const realMsgs = getRealMessages(lead);
    const unreadInboundMsgs = realMsgs.filter((m) => m.sender === 'lead' && m.status !== 'read');
    const latestRealMsg = realMsgs.length > 0 ? realMsgs[realMsgs.length - 1] : null;
    const isPendingReply = unreadInboundMsgs.length > 0 && latestRealMsg?.sender === 'lead';
    const isStaleUnreadReplied = unreadInboundMsgs.length > 0 && latestRealMsg?.sender !== 'lead';

    if (isPendingReply) {
      unreadMessagesTotal += unreadInboundMsgs.length;
      unreadReplies.push(
        toAssistantLeadItem(lead, now, unreadInboundMsgs.length, latestRealMsg?.text)
      );
    } else if (isStaleUnreadReplied) {
      const lastIn = [...unreadInboundMsgs].reverse()[0];
      staleUnreadAlreadyReplied.push(
        toAssistantLeadItem(lead, now, unreadInboundMsgs.length, lastIn?.text)
      );
    }

    // Secondary Card:
    // - Admin: Unassigned inquiries awaiting coordinator assignment
    // - Coordinator: Own assigned leads still sitting in New Inbound awaiting first touch
    if (isAdmin) {
      if (!assigned && (stage === 'new' || realMsgs.length > 0)) {
        unassignedOrNewInbounds.push(
          toAssistantLeadItem(lead, now, unreadInboundMsgs.length, latestRealMsg?.text)
        );
      }
    } else {
      if (intaken && stage === 'new') {
        unassignedOrNewInbounds.push(
          toAssistantLeadItem(lead, now, unreadInboundMsgs.length, latestRealMsg?.text)
        );
      }
    }

    // Stagnant in Discussion (> 3 days since true last activity across updatedAt/messages/timeline)
    const lastActMs = getTrueLastActivityMs(lead);
    const inactiveMs = now - lastActMs;
    if (intaken && stage === 'in_discussion' && inactiveMs > THREE_DAYS) {
      stagnantInDiscussion.push(
        toAssistantLeadItem(lead, now, unreadInboundMsgs.length, latestRealMsg?.text)
      );
      if (inactiveMs > THIRTY_DAYS) stagnantOver30Days++;
      else if (inactiveMs > SEVEN_DAYS) stagnant7to30Days++;
      else stagnant3to7Days++;
    }

    // Verified document-ready candidates
    if (
      intaken &&
      (stage === 'strong_opportunity' || stage === 'in_discussion') &&
      (lead.docPassportCopy || lead.passportCopyUrl || lead.docResume || lead.resumeUrl) &&
      !lead.docOfficeVisited
    ) {
      interviewOpportunities.push(
        toAssistantLeadItem(lead, now, unreadInboundMsgs.length, latestRealMsg?.text)
      );
    }

    // Per-coordinator aggregation (consistent: stagnant ONLY counts in_discussion > 3 days)
    if (assigned && intaken) {
      const matchedCoord = coordinators.find((c) => isCoordinatorMatch(lead.assignedTo, c.username, coordinators));
      const coordKey = matchedCoord ? matchedCoord.username.toLowerCase() : String(lead.assignedTo).trim().toLowerCase();
      if (isAdmin || isCoordinatorMatch(coordKey, agentId, coordinators)) {
        if (!coordMap[coordKey]) {
          coordMap[coordKey] = { total: 0, newInbound: 0, inDiscussion: 0, stagnant: 0, won: 0, unread: 0 };
        }
        coordMap[coordKey].total++;
        if (stage === 'new') coordMap[coordKey].newInbound++;
        if (stage === 'in_discussion') {
          coordMap[coordKey].inDiscussion++;
          if (inactiveMs > THREE_DAYS) {
            coordMap[coordKey].stagnant++;
          }
        }
        if (stage === 'won') coordMap[coordKey].won++;
        if (isPendingReply) coordMap[coordKey].unread++;
      }
    }
  }

  // Sort drilldown lists most urgent first
  unreadReplies.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  staleUnreadAlreadyReplied.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  unassignedOrNewInbounds.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  stagnantInDiscussion.sort((a, b) => b.inactiveDays - a.inactiveDays);
  interviewOpportunities.sort((a, b) => a.inactiveDays - b.inactiveDays);

  const visibleCoordDefinitions = coordinators.filter((c) => {
    if (!isAdmin) return isCoordinatorMatch(c.username, agentId, coordinators);
    const data = coordMap[c.username.toLowerCase()];
    return c.role === 'agent' || (data && data.total > 0);
  });

  const coordinatorWorkloads: CoordinatorWorkload[] = visibleCoordDefinitions
    .map((c) => {
      const data = coordMap[c.username.toLowerCase()] || {
        total: 0,
        newInbound: 0,
        inDiscussion: 0,
        stagnant: 0,
        won: 0,
        unread: 0
      };
      let status: 'optimal' | 'busy' | 'overloaded' | 'available' = 'optimal';
      let recommendation = 'Pipeline is balanced and moving steadily.';

      if (data.stagnant > 100 || data.inDiscussion > 200) {
        status = 'overloaded';
        recommendation = `${data.stagnant} In Discussion leads inactive >3d. Archive old (>30d) leads to Cold or send re-activation.`;
      } else if (data.stagnant > 25 || data.inDiscussion > 100) {
        status = 'busy';
        recommendation = `Focus on touching ${data.stagnant} stagnant In Discussion leads and progressing verified files.`;
      } else if (data.total < 50) {
        status = 'available';
        recommendation = isAdmin
          ? 'Has capacity for new inbound lead assignments.'
          : 'Pipeline is clean and ready for new candidate intakes.';
      }

      return {
        id: c.id,
        username: c.username,
        name: c.displayName || c.username,
        activeLeads: data.total,
        newInbound: data.newInbound,
        inDiscussion: data.inDiscussion,
        stagnantLeads: data.stagnant,
        wonLeads: data.won,
        unreadLeads: data.unread,
        status,
        recommendation
      };
    })
    .sort((a, b) => b.activeLeads - a.activeLeads);

  // Dynamic, Proportional CRM Health Index (0 - 100%) so every fix visibly raises the score
  const activeOpenCount =
    pipelineSummary.newInbound +
    pipelineSummary.inDiscussion +
    pipelineSummary.strongOpportunity +
    pipelineSummary.officeVisited;

  const responseDenominator = Math.max(12, activeOpenCount * 0.06);
  const unreadPenaltyRatio = Math.min(
    1,
    (unreadReplies.length + staleUnreadAlreadyReplied.length * 0.35) / responseDenominator
  );
  const responseScore = Math.max(0, Math.round(35 * (1 - unreadPenaltyRatio)));

  const assignmentDenominator = isAdmin
    ? Math.max(15, scopedLeads.length * 0.08)
    : Math.max(10, activeOpenCount * 0.12);
  const assignmentPenaltyRatio = Math.min(1, unassignedOrNewInbounds.length / assignmentDenominator);
  const assignmentScore = Math.max(0, Math.round(25 * (1 - assignmentPenaltyRatio)));

  const weightedStagnant = stagnant3to7Days * 0.4 + stagnant7to30Days * 0.75 + stagnantOver30Days * 1.1;
  const discussionBase = Math.max(10, pipelineSummary.inDiscussion);
  const velocityPenaltyRatio = Math.min(1, weightedStagnant / discussionBase);
  const velocityScore = Math.max(0, Math.round(40 * (1 - velocityPenaltyRatio)));

  const healthScore = Math.max(0, Math.min(100, responseScore + assignmentScore + velocityScore));

  // Actionable Alerts
  const alerts: AssistantAlert[] = [];

  if (unreadReplies.length > 0) {
    alerts.push({
      id: 'alert_unread_replies',
      type: 'urgent',
      title: `${unreadReplies.length} Candidate${unreadReplies.length === 1 ? '' : 's'} Awaiting Reply (${unreadMessagesTotal} unread msg${unreadMessagesTotal === 1 ? '' : 's'})`,
      description: `Candidates sent WhatsApp messages and have not received a reply yet.`,
      count: unreadReplies.length,
      leadIds: unreadReplies.slice(0, 20).map((l) => l.id),
      suggestedAction: 'Inspect unread chats and reply or mark reviewed.',
      actionType: 'view_leads',
      bucketKey: 'unread'
    });
  }

  if (staleUnreadAlreadyReplied.length > 0) {
    alerts.push({
      id: 'alert_stale_unread_flags',
      type: 'info',
      title: `${staleUnreadAlreadyReplied.length} Already-Replied Chat${staleUnreadAlreadyReplied.length === 1 ? '' : 's'} Still Marked Unread`,
      description: `Team already replied to these candidates, but older inbound messages were never cleared from unread status.`,
      count: staleUnreadAlreadyReplied.length,
      leadIds: staleUnreadAlreadyReplied.map((l) => l.id),
      suggestedAction: 'Clear stale unread flags in 1 click to tidy your queue.',
      actionType: 'fix_stale_unread',
      bucketKey: 'staleUnread'
    });
  }

  if (unassignedOrNewInbounds.length > 0) {
    if (isAdmin) {
      alerts.push({
        id: 'alert_unassigned',
        type: 'urgent',
        title: `${unassignedOrNewInbounds.length} Unassigned Inbound Lead${unassignedOrNewInbounds.length === 1 ? '' : 's'}`,
        description: `Candidates inquired via WhatsApp or ads and have no coordinator assigned yet.`,
        count: unassignedOrNewInbounds.length,
        leadIds: unassignedOrNewInbounds.slice(0, 25).map((l) => l.id),
        suggestedAction: 'Auto-assign a batch to available coordinators or open intake.',
        actionType: 'reassign',
        bucketKey: 'unassigned'
      });
    } else {
      alerts.push({
        id: 'alert_my_new_inbounds',
        type: 'warning',
        title: `${unassignedOrNewInbounds.length} Assigned Lead${unassignedOrNewInbounds.length === 1 ? '' : 's'} Still in New Inbound`,
        description: `These candidates are assigned to you and haven't been moved to In Discussion yet.`,
        count: unassignedOrNewInbounds.length,
        leadIds: unassignedOrNewInbounds.slice(0, 25).map((l) => l.id),
        suggestedAction: 'Review and start follow-ups on your new inbound queue.',
        actionType: 'view_leads',
        bucketKey: 'unassigned'
      });
    }
  }

  if (stagnantInDiscussion.length > 0) {
    alerts.push({
      id: 'alert_stagnant_discussion',
      type: 'warning',
      title: `${stagnantInDiscussion.length} Stagnant in Discussion (${stagnantOver30Days} aged >30d)`,
      description: `In Discussion candidates with no calls, remarks, messages, or stage movement in over 3 days.`,
      count: stagnantInDiscussion.length,
      leadIds: stagnantInDiscussion.slice(0, 25).map((l) => l.id),
      suggestedAction:
        stagnantOver30Days > 0
          ? `Move ${stagnantOver30Days} inactive (>30d) leads to Cold Leads to clean pipeline & boost health.`
          : 'Follow up via call or WhatsApp re-activation.',
      actionType: 'archive_stagnant',
      bucketKey: 'stagnant'
    });
  }

  if (interviewOpportunities.length > 0) {
    alerts.push({
      id: 'alert_interview_ready',
      type: 'opportunity',
      title: `${interviewOpportunities.length} Verified Document-Ready Candidate${interviewOpportunities.length === 1 ? '' : 's'}`,
      description: `Candidates with Passport or Resume uploaded who are still in Discussion or Strong Opportunity.`,
      count: interviewOpportunities.length,
      leadIds: interviewOpportunities.slice(0, 20).map((l) => l.id),
      suggestedAction: 'Review and advance ready profiles toward Interview / Submission.',
      actionType: 'view_leads',
      bucketKey: 'interviewReady'
    });
  }

  const aiInsights = [
    isAdmin
      ? `CRM tracks ${scopedLeads.length} active records (${activeOpenCount} open pipeline, ${pipelineSummary.won} Closed Won).`
      : `Your assigned workspace has ${scopedLeads.length} total leads (${activeOpenCount} active pipeline, ${pipelineSummary.won} Closed Won).`,
    unreadReplies.length > 0
      ? `${unreadReplies.length} candidate${unreadReplies.length === 1 ? '' : 's'} (${unreadMessagesTotal} msgs) await an immediate WhatsApp response${staleUnreadAlreadyReplied.length > 0 ? ` (+ ${staleUnreadAlreadyReplied.length} stale flags ready to clear)` : ''}.`
      : `Great responsiveness! Zero candidates are waiting on an unread WhatsApp reply.`,
    stagnantInDiscussion.length > 0
      ? `${stagnantInDiscussion.length} In Discussion leads are inactive >3d (${stagnant3to7Days} 3–7d, ${stagnant7to30Days} 7–30d, ${stagnantOver30Days} >30d). Archiving >30d leads to Cold Leads immediately raises pipeline health.`
      : `Your In Discussion stage is fresh with zero stagnant leads over 3 days.`
  ];

  const availableCoordinators = isAdmin
    ? coordinators
        .filter((c) => c.role === 'agent')
        .map((c) => ({ username: c.username, name: c.displayName || c.username }))
    : [];

  return {
    healthScore,
    healthBreakdown: {
      responseScore,
      responseMax: 35,
      assignmentScore,
      assignmentMax: 25,
      velocityScore,
      velocityMax: 40,
      staleUnreadFlagCount: staleUnreadAlreadyReplied.length,
      stagnant3to7Days,
      stagnant7to30Days,
      stagnantOver30Days
    },
    scopedRole: isAdmin ? 'admin' : 'coordinator',
    scopedAgentId: agentId || 'unassigned',
    secondaryMetricMode: isAdmin ? 'unassigned' : 'my_new_inbounds',
    totalActiveCandidates: scopedLeads.length,
    alerts,
    coordinatorWorkloads,
    availableCoordinators,
    pipelineSummary,
    stagnantCount: stagnantInDiscussion.length,
    unassignedCount: unassignedOrNewInbounds.length,
    unreadRepliesCount: unreadReplies.length,
    unreadMessagesCount: unreadMessagesTotal,
    staleUnreadCount: staleUnreadAlreadyReplied.length,
    interviewReadyCount: interviewOpportunities.length,
    drilldowns: {
      unread: unreadReplies,
      staleUnread: staleUnreadAlreadyReplied,
      unassigned: unassignedOrNewInbounds,
      stagnant: stagnantInDiscussion,
      interviewReady: interviewOpportunities
    },
    aiInsights,
    lastScannedAt: new Date().toISOString()
  };
}

export async function applyAiAssistantFix(params: {
  action:
    | 'mark_stale_unread_read'
    | 'mark_leads_read'
    | 'archive_stagnant_to_cold'
    | 'touch_stagnant_followup'
    | 'auto_assign_unassigned'
    | 'advance_to_strong_opp';
  userRole: string;
  agentId: string;
  leadIds?: string[];
  minInactiveDays?: number;
  limit?: number;
  targetCoordinator?: string;
}): Promise<{ success: boolean; fixedCount: number; message: string; overview: SentinelOverview }> {
  const userRole = String(params.userRole || 'user').trim().toLowerCase();
  const agentId = String(params.agentId || '').trim();
  const isAdmin = userRole === 'admin';

  if (params.action === 'auto_assign_unassigned' && !isAdmin) {
    const err: any = new Error('Forbidden: Only administrators can auto-assign unassigned leads.');
    err.statusCode = 403;
    throw err;
  }

  const [allLeads, coordinators] = await Promise.all([getLeads(false), getCoordinators()]);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const todayDate = nowIso.split('T')[0];
  const actorLabel = isAdmin
    ? `Admin (${agentId || 'Master Admin'}) via AI Assistant`
    : `Coordinator ${agentId || 'Agent'} via AI Assistant`;

  const canTouchLead = (lead: Lead): boolean => {
    if (!lead || lead.isDeleted) return false;
    if (isAdmin) return true;
    return isCoordinatorMatch(lead.assignedTo, agentId, coordinators);
  };

  if (Array.isArray(params.leadIds) && params.leadIds.length > 0 && !isAdmin) {
    const requestedSet = new Set(params.leadIds.map(String));
    const unauthorized = allLeads.some((l) => requestedSet.has(l.id) && !canTouchLead(l));
    if (unauthorized) {
      const err: any = new Error('Forbidden: Coordinators can only update leads assigned to them.');
      err.statusCode = 403;
      throw err;
    }
  }

  let targetIds: string[] = [];
  const requestedSet =
    Array.isArray(params.leadIds) && params.leadIds.length > 0 ? new Set(params.leadIds.map(String)) : null;

  if (params.action === 'mark_stale_unread_read') {
    targetIds = allLeads
      .filter((l) => {
        if (!canTouchLead(l)) return false;
        if (requestedSet && !requestedSet.has(l.id)) return false;
        const msgs = getRealMessages(l);
        const hasUnread = msgs.some((m) => m.sender === 'lead' && m.status !== 'read');
        const latest = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        return hasUnread && latest?.sender !== 'lead';
      })
      .map((l) => l.id);

    const modified = await updateMultipleLeads(
      targetIds,
      (lead) => {
        let changed = false;
        lead.messages = (lead.messages || []).map((m) => {
          if (m && m.sender === 'lead' && m.status !== 'read') {
            changed = true;
            return { ...m, status: 'read' as const };
          }
          return m;
        });
        return changed ? lead : null;
      },
      { allowDeferredSync: true, auditMeta: { actor: actorLabel, sourceView: 'ai_assistant_fix' } }
    );

    const overview = await computeSentinelOverview({ userRole, agentId });
    return {
      success: true,
      fixedCount: modified.length,
      message:
        modified.length > 0
          ? `Cleared stale unread flags on ${modified.length} already-replied conversation(s).`
          : 'No stale unread flags needed clearing.',
      overview
    };
  }

  if (params.action === 'mark_leads_read') {
    if (!requestedSet) {
      targetIds = allLeads
        .filter((l) => {
          if (!canTouchLead(l)) return false;
          return getRealMessages(l).some((m) => m.sender === 'lead' && m.status !== 'read');
        })
        .map((l) => l.id);
    } else {
      targetIds = allLeads.filter((l) => canTouchLead(l) && requestedSet.has(l.id)).map((l) => l.id);
    }

    const modified = await updateMultipleLeads(
      targetIds,
      (lead) => {
        let changed = false;
        lead.messages = (lead.messages || []).map((m) => {
          if (m && m.sender === 'lead' && m.status !== 'read') {
            changed = true;
            return { ...m, status: 'read' as const };
          }
          return m;
        });
        if (changed) {
          if (!Array.isArray(lead.timeline)) lead.timeline = [];
          lead.timeline.push({
            id: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'remark',
            text: 'Marked unread WhatsApp messages as reviewed via AI Assistant',
            actor: actorLabel,
            timestamp: nowIso
          });
        }
        return changed ? lead : null;
      },
      { allowDeferredSync: true, auditMeta: { actor: actorLabel, sourceView: 'ai_assistant_fix' } }
    );

    const overview = await computeSentinelOverview({ userRole, agentId });
    return {
      success: true,
      fixedCount: modified.length,
      message: `Marked ${modified.length} candidate conversation(s) as read.`,
      overview
    };
  }

  if (params.action === 'archive_stagnant_to_cold') {
    const minDays = Math.max(3, Number(params.minInactiveDays) || 30);
    const minMs = minDays * 24 * 60 * 60 * 1000;

    targetIds = allLeads
      .filter((l) => {
        if (!canTouchLead(l)) return false;
        if (!getEffectiveIntake(l)) return false;
        if (normalizeStageKey(l.stage) !== 'in_discussion') return false;
        if (requestedSet) return requestedSet.has(l.id);
        return now - getTrueLastActivityMs(l) >= minMs;
      })
      .map((l) => l.id);

    const modified = await updateMultipleLeads(
      targetIds,
      (lead) => {
        const prevStage = normalizeStageKey(lead.stage);
        if (prevStage === 'cold_leads') return null;
        lead.stage = 'cold_leads';
        lead.stageChangedAt = nowIso;
        if (!Array.isArray(lead.stageHistory)) lead.stageHistory = [];
        lead.stageHistory.push({
          candidateId: lead.id,
          previousStage: prevStage,
          newStage: 'cold_leads',
          changedBy: actorLabel,
          coordinatorId: lead.assignedTo || 'unassigned',
          changedAt: nowIso,
          project: lead.project,
          country: lead.country
        });
        if (!Array.isArray(lead.timeline)) lead.timeline = [];
        lead.timeline.push({
          id: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'status',
          text: `Pipeline stage changed from "In Discussion" to "Cold Leads" (AI Assistant inactive >${minDays}d cleanup)`,
          actor: actorLabel,
          timestamp: nowIso
        });
        return lead;
      },
      { allowDeferredSync: true, auditMeta: { actor: actorLabel, sourceView: 'ai_assistant_fix' } }
    );

    const overview = await computeSentinelOverview({ userRole, agentId });
    return {
      success: true,
      fixedCount: modified.length,
      message: `Moved ${modified.length} stagnant In Discussion lead(s) to Cold Leads.`,
      overview
    };
  }

  if (params.action === 'touch_stagnant_followup') {
    if (!requestedSet) {
      return {
        success: false,
        fixedCount: 0,
        message: 'Please select at least one candidate to log a follow-up.',
        overview: await computeSentinelOverview({ userRole, agentId })
      };
    }

    targetIds = allLeads.filter((l) => canTouchLead(l) && requestedSet.has(l.id)).map((l) => l.id);

    const modified = await updateMultipleLeads(
      targetIds,
      (lead) => {
        if (!Array.isArray(lead.timeline)) lead.timeline = [];
        lead.timeline.push({
          id: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'remark',
          text: 'Follow-up scheduled / reviewed via AI Assistant',
          actor: actorLabel,
          timestamp: nowIso
        });
        return lead;
      },
      { allowDeferredSync: true, auditMeta: { actor: actorLabel, sourceView: 'ai_assistant_fix' } }
    );

    const overview = await computeSentinelOverview({ userRole, agentId });
    return {
      success: true,
      fixedCount: modified.length,
      message: `Logged follow-up refresh on ${modified.length} candidate(s).`,
      overview
    };
  }

  if (params.action === 'advance_to_strong_opp') {
    if (!requestedSet) {
      return {
        success: false,
        fixedCount: 0,
        message: 'Please select candidates to advance to Strong Opportunity.',
        overview: await computeSentinelOverview({ userRole, agentId })
      };
    }

    targetIds = allLeads
      .filter((l) => canTouchLead(l) && requestedSet.has(l.id) && normalizeStageKey(l.stage) === 'in_discussion')
      .map((l) => l.id);

    const modified = await updateMultipleLeads(
      targetIds,
      (lead) => {
        const prevStage = normalizeStageKey(lead.stage);
        if (prevStage === 'strong_opportunity') return null;
        lead.stage = 'strong_opportunity';
        lead.stageChangedAt = nowIso;
        if (!Array.isArray(lead.stageHistory)) lead.stageHistory = [];
        lead.stageHistory.push({
          candidateId: lead.id,
          previousStage: prevStage,
          newStage: 'strong_opportunity',
          changedBy: actorLabel,
          coordinatorId: lead.assignedTo || 'unassigned',
          changedAt: nowIso,
          project: lead.project,
          country: lead.country
        });
        if (!Array.isArray(lead.timeline)) lead.timeline = [];
        lead.timeline.push({
          id: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'status',
          text: `Pipeline stage changed from "In Discussion" to "Strong Opportunity" via AI Assistant`,
          actor: actorLabel,
          timestamp: nowIso
        });
        return lead;
      },
      { allowDeferredSync: true, auditMeta: { actor: actorLabel, sourceView: 'ai_assistant_fix' } }
    );

    const overview = await computeSentinelOverview({ userRole, agentId });
    return {
      success: true,
      fixedCount: modified.length,
      message: `Promoted ${modified.length} verified candidate(s) to Strong Opportunity.`,
      overview
    };
  }

  if (params.action === 'auto_assign_unassigned') {
    const agentCoords = coordinators.filter((c) => c.role === 'agent');
    const explicitTarget = params.targetCoordinator ? String(params.targetCoordinator).trim() : '';
    const pool = explicitTarget
      ? [explicitTarget]
      : agentCoords
          .map((c) => c.username)
          .filter((u) => u && u.toLowerCase() !== 'unassigned');

    if (pool.length === 0) {
      return {
        success: false,
        fixedCount: 0,
        message: 'No active coordinators available for assignment.',
        overview: await computeSentinelOverview({ userRole, agentId })
      };
    }

    const candidates = allLeads
      .filter((l) => {
        if (!l || l.isDeleted) return false;
        if (isLeadAssigned(l)) return false;
        if (requestedSet) return requestedSet.has(l.id);
        const st = normalizeStageKey(l.stage);
        return st === 'new' || getRealMessages(l).length > 0;
      })
      .sort((a, b) => getTrueLastActivityMs(b) - getTrueLastActivityMs(a));

    const limitCount = Math.max(1, Number(params.limit) || candidates.length);
    const chosenLeads = candidates.slice(0, limitCount);
    let intakeSequence = allLeads.filter((l) => l.intake && l.serialNo).length;

    let rrIdx = 0;
    const assignTargetMap = new Map<string, string>();
    for (const c of chosenLeads) {
      assignTargetMap.set(c.id, pool[rrIdx % pool.length]);
      rrIdx++;
    }

    const modified = await updateMultipleLeads(
      chosenLeads.map((l) => l.id),
      (lead) => {
        if (isLeadAssigned(lead)) return null;
        const targetCoord = assignTargetMap.get(lead.id);
        if (!targetCoord) return null;

        lead.assignedTo = targetCoord;
        lead.assignDate = todayDate;
        lead.intake = true;
        if (!lead.serialNo) {
          intakeSequence++;
          lead.serialNo = `INQ-${1000 + intakeSequence}`;
        }

        if (!Array.isArray(lead.coordinatorHistory)) lead.coordinatorHistory = [];
        lead.coordinatorHistory.push({
          candidateId: lead.id,
          previousCoordinator: 'unassigned',
          newCoordinator: targetCoord.toLowerCase(),
          changedBy: actorLabel,
          changedAt: nowIso
        });

        if (!Array.isArray(lead.timeline)) lead.timeline = [];
        lead.timeline.push({
          id: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'assignment',
          text: `Assigned coordinator changed from "Unassigned" to "${targetCoord}" (AI Assistant Auto-Assign)`,
          actor: actorLabel,
          timestamp: nowIso
        });

        return lead;
      },
      { allowDeferredSync: true, auditMeta: { actor: actorLabel, sourceView: 'ai_assistant_fix' } }
    );

    const overview = await computeSentinelOverview({ userRole, agentId });
    return {
      success: true,
      fixedCount: modified.length,
      message:
        explicitTarget
          ? `Assigned ${modified.length} inbound lead(s) to ${explicitTarget}.`
          : `Distributed ${modified.length} inbound lead(s) across ${pool.length} coordinator(s).`,
      overview
    };
  }

  const overview = await computeSentinelOverview({ userRole, agentId });
  return {
    success: false,
    fixedCount: 0,
    message: 'Unknown fix action.',
    overview
  };
}

export async function askAiCopilot(
  query: string,
  userRole: string,
  agentId: string,
  _conversationHistory: { role: 'user' | 'assistant'; text: string }[] = []
): Promise<{ reply: string; suggestions?: string[] }> {
  const normalizedRole = String(userRole || 'user').trim().toLowerCase();
  const isAdmin = normalizedRole === 'admin';
  const overview = await computeSentinelOverview({ userRole: normalizedRole, agentId });
  const jobs = await getJobs();

  const ai = getAiClient();
  if (!ai) {
    const secondLabel = isAdmin ? 'Unassigned Inbounds' : 'My New Inbounds';
    return {
      reply: `**AI Assistant Summary:**\n- **CRM Health Score:** ${overview.healthScore}%\n- **Total Scoped Candidates:** ${overview.totalActiveCandidates}\n- **In Discussion:** ${overview.pipelineSummary.inDiscussion} (${overview.stagnantCount} stagnant >3d)\n- **${secondLabel}:** ${overview.unassignedCount}\n- **Awaiting Replies:** ${overview.unreadRepliesCount} (${overview.unreadMessagesCount} unread msgs)\n\n*Recommendation:* ${overview.unreadRepliesCount > 0 ? 'Reply to pending WhatsApp conversations first.' : overview.stagnantCount > 0 ? 'Review stagnant In Discussion leads or archive inactive (>30d) leads to Cold.' : 'Follow up on Strong Opportunity & document-ready candidates.'}`,
      suggestions: [
        'How can I improve my CRM health score right now?',
        'Summarize my stagnant In Discussion leads',
        'Who should I reply to first on WhatsApp?'
      ]
    };
  }

  const topUnread = overview.drilldowns.unread
    .slice(0, 5)
    .map((l) => `* ${l.name} (${l.phone || 'N/A'}) - ${l.country}, ${l.unreadCount} unread msg(s)`)
    .join('\n');

  const topReady = overview.drilldowns.interviewReady
    .slice(0, 5)
    .map((l) => `* ${l.name} (${l.position}) - ${l.country}, Stage: ${l.stage}`)
    .join('\n');

  const scopeHeader = isAdmin
    ? `Role: Administrator (Agency-wide visibility)`
    : `Role: Coordinator "${agentId}" (STRICTLY SCOPED — ONLY discuss leads assigned to "${agentId}". Never reference or expose any other coordinator's metrics.)`;

  const workloadSection = isAdmin
    ? `Coordinator Workloads:\n${overview.coordinatorWorkloads
        .map(
          (c) =>
            `* ${c.name}: ${c.activeLeads} active, ${c.inDiscussion} in discussion, ${c.stagnantLeads} stagnant (>3d), ${c.wonLeads} won. Status: ${c.status}`
        )
        .join('\n')}`
    : `Your Personal Workload Summary:\n${overview.coordinatorWorkloads
        .map(
          (c) =>
            `* ${c.name}: ${c.activeLeads} assigned, ${c.inDiscussion} in discussion, ${c.stagnantLeads} stagnant (>3d), ${c.wonLeads} won.`
        )
        .join('\n')}`;

  const contextSummary = `
You are the CGP AI Assistant for Career Growth Placement Abroad Recruiting CRM.
${scopeHeader}

Current Real-Time Scoped CRM Snapshot (computed ${overview.lastScannedAt}):
- CRM Health Score: ${overview.healthScore}% (Response: ${overview.healthBreakdown.responseScore}/${overview.healthBreakdown.responseMax}, ${isAdmin ? 'Assignment' : 'New Intake'}: ${overview.healthBreakdown.assignmentScore}/${overview.healthBreakdown.assignmentMax}, Pipeline Freshness: ${overview.healthBreakdown.velocityScore}/${overview.healthBreakdown.velocityMax})
- Total Scoped Candidates: ${overview.totalActiveCandidates}
- Pipeline Stages:
  * New Inbound: ${overview.pipelineSummary.newInbound}
  * In Discussion: ${overview.pipelineSummary.inDiscussion}
  * Strong Opportunity: ${overview.pipelineSummary.strongOpportunity}
  * Office Visited / Interview: ${overview.pipelineSummary.officeVisited}
  * Won (Placed): ${overview.pipelineSummary.won}
  * Cold Leads: ${overview.pipelineSummary.coldLeads}
  * Lost: ${overview.pipelineSummary.lost}
- ${isAdmin ? 'Unassigned Inbound Leads' : 'My New Inbounds (Awaiting First Touch)'}: ${overview.unassignedCount}
- Candidates Awaiting WhatsApp Reply: ${overview.unreadRepliesCount} (${overview.unreadMessagesCount} unread messages)
- Stale Already-Replied Unread Flags: ${overview.staleUnreadCount}
- Stagnant in Discussion (> 3 days): ${overview.stagnantCount} (3-7d: ${overview.healthBreakdown.stagnant3to7Days}, 7-30d: ${overview.healthBreakdown.stagnant7to30Days}, >30d: ${overview.healthBreakdown.stagnantOver30Days})

Top Unread Candidates Awaiting Reply:
${topUnread || '* None'}

Top Document-Ready Candidates:
${topReady || '* None'}

Active Demand Jobs:
${jobs
  .slice(0, 5)
  .map(
    (j) =>
      `* ${j.title || j.serviceCharge || 'Job Demand'}${j.country ? ` (${j.country})` : ''} - Service Charge: ${j.serviceCharge || j.processingFeeMale || 'N/A'}, Salary: ${j.salaryRange || 'See creative'}`
  )
  .join('\n')}

${workloadSection}
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        {
          role: 'user',
          parts: [{ text: `${contextSummary}\n\nUser Question: ${query}` }]
        }
      ],
      config: {
        systemInstruction:
          'You are the CGP AI Assistant for Career Growth Placement. Be concise, accurate, strictly respect the user scope provided in the context, and give actionable recommendations using clean markdown bullet points.'
      }
    });

    const text = response.text || 'All systems are synced. How would you like to prioritize your leads?';
    return {
      reply: text,
      suggestions: isAdmin
        ? [
            'How can we boost CRM Health above 80% today?',
            'Which stagnant leads should move to Cold?',
            'Which coordinator has capacity right now?',
            'Draft WhatsApp re-engagement message'
          ]
        : [
            'How can I boost my Health Score today?',
            'Which of my candidates need an urgent reply?',
            'Which of my verified candidates are ready to advance?',
            'Draft WhatsApp re-engagement message'
          ]
    };
  } catch (err: any) {
    console.error('[AI Assistant] Error in Gemini query:', err?.message || err);
    throw new Error(err?.message || 'AI Assistant could not reach Gemini right now.');
  }
}

export async function getLeadSpecificAiSuggestions(
  leadId: string,
  userRole = 'user',
  agentId = ''
): Promise<{
  summary: string;
  suggestedStage: string;
  suggestedAction: string;
  recommendedTemplate: string;
  missingItems: string[];
}> {
  const [leads, coordinators] = await Promise.all([getLeads(false), getCoordinators()]);
  const lead = leads.find((l) => l.id === leadId);

  if (!lead) {
    return {
      summary: 'Candidate not found.',
      suggestedStage: 'new',
      suggestedAction: 'Verify lead details.',
      recommendedTemplate: 'assign',
      missingItems: []
    };
  }

  const isAdmin = String(userRole || '').toLowerCase() === 'admin';
  if (!isAdmin && !isCoordinatorMatch(lead.assignedTo, agentId, coordinators)) {
    const err: any = new Error('Forbidden: You can only view AI Assistant suggestions for your assigned leads.');
    err.statusCode = 403;
    throw err;
  }

  const missing: string[] = [];
  if (!lead.docPassportCopy && !lead.passportCopyUrl) missing.push('Passport Scan / Copy');
  if (!lead.docResume && !lead.resumeUrl) missing.push('Updated CV / Resume');
  if (!lead.experience || lead.experience.trim() === '' || lead.experience.toLowerCase().includes('fresh')) {
    missing.push('Work Experience Verification');
  }
  if (!lead.country || lead.country.trim() === '') missing.push('Preferred Destination Country');

  let suggestedStage = lead.stage || 'in_discussion';
  let suggestedAction = 'Follow up with candidate via WhatsApp.';
  let recommendedTemplate = 'assign';

  if (!lead.assignedTo || lead.assignedTo === 'unassigned') {
    suggestedAction = 'Assign to an active coordinator and send Welcome / Assignment template.';
    recommendedTemplate = 'assign';
    suggestedStage = 'in_discussion';
  } else if (missing.length > 0) {
    suggestedAction = `Request missing documents: ${missing.slice(0, 2).join(', ')}.`;
    recommendedTemplate = 're_activate_chat';
  } else if (lead.stage === 'in_discussion') {
    suggestedStage = 'strong_opportunity';
    suggestedAction = 'Candidate documents complete. Advance to Strong Opportunity for client shortlisting.';
    recommendedTemplate = 'office_address';
  }

  const summary = `${lead.name} (${lead.phone || 'No phone'}) - Position: ${lead.position || 'General'} | Country: ${lead.country || 'Gulf/Abroad'}. Status: ${lead.stage || 'In Discussion'}.`;

  return {
    summary,
    suggestedStage,
    suggestedAction,
    recommendedTemplate,
    missingItems: missing
  };
}
