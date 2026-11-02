import { GoogleGenAI } from '@google/genai';
import type { Lead, Coordinator, Job } from '../types.ts';
import { getLeads, getCoordinators, getJobs, updateSingleLead } from './db.ts';

// Helper to get GoogleGenAI client safely
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
    console.error('[AI Sentinel] Failed to initialize GoogleGenAI:', err);
    return null;
  }
}

export interface SentinelAlert {
  id: string;
  type: 'urgent' | 'warning' | 'opportunity' | 'info';
  title: string;
  description: string;
  count?: number;
  leadIds?: string[];
  suggestedAction: string;
  actionType?: 'view_leads' | 'reassign' | 'send_template';
}

export interface CoordinatorWorkload {
  id: string;
  name: string;
  activeLeads: number;
  newInbound: number;
  inDiscussion: number;
  stagnantLeads: number;
  wonLeads: number;
  status: 'optimal' | 'busy' | 'overloaded' | 'available';
  recommendation: string;
}

export interface SentinelOverview {
  healthScore: number; // 0 - 100
  totalActiveCandidates: number;
  alerts: SentinelAlert[];
  coordinatorWorkloads: CoordinatorWorkload[];
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
  aiInsights: string[];
  lastScannedAt: string;
}

export async function computeSentinelOverview(): Promise<SentinelOverview> {
  const leads = await getLeads(false);
  const coordinators = await getCoordinators();
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;
  const THREE_DAYS = 3 * ONE_DAY;

  // Active non-deleted leads
  const activeLeads = leads.filter(l => !l.isDeleted);

  // Pipeline summary
  const pipelineSummary = {
    newInbound: 0,
    inDiscussion: 0,
    strongOpportunity: 0,
    officeVisited: 0,
    won: 0,
    coldLeads: 0,
    lost: 0
  };

  const unassignedInbounds: Lead[] = [];
  const stagnantInDiscussion: Lead[] = [];
  const interviewOpportunities: Lead[] = [];
  const unreadReplies: Lead[] = [];

  let newInboundsWaitingLong = 0;

  activeLeads.forEach(lead => {
    let stage = (lead.stage || 'new').toLowerCase();
    if (stage === 'negotiating') stage = 'in_discussion';
    else if (stage === 'proposal') stage = 'office_visited';
    else if (stage === 'rotations') stage = 'cold_leads';

    if (stage === 'new') pipelineSummary.newInbound++;
    else if (stage === 'in_discussion') pipelineSummary.inDiscussion++;
    else if (stage === 'strong_opportunity') pipelineSummary.strongOpportunity++;
    else if (stage === 'office_visited') pipelineSummary.officeVisited++;
    else if (stage === 'won') pipelineSummary.won++;
    else if (stage === 'cold_leads') pipelineSummary.coldLeads++;
    else if (stage === 'lost') pipelineSummary.lost++;

    // Check unread replies from candidate
    const hasUnread = (lead.messages || []).some(m => m && m.sender === 'lead' && m.status !== 'read');
    if (hasUnread) {
      unreadReplies.push(lead);
    }

    // Check unassigned or unattended new inbounds
    const isAssigned = lead.assignedTo && lead.assignedTo.trim() !== '' && lead.assignedTo.toLowerCase() !== 'unassigned' && lead.assignedTo.toLowerCase() !== 'all';
    const createdAtMs = new Date(lead.createdAt || 0).getTime();

    if (stage === 'new' && !isAssigned) {
      unassignedInbounds.push(lead);
      if (now - createdAtMs > ONE_HOUR) {
        newInboundsWaitingLong++;
      }
    }

    // Check stagnant in-discussion leads (> 3 days with no remarks or updates)
    const updatedAtMs = new Date(lead.updatedAt || lead.createdAt || 0).getTime();
    if (stage === 'in_discussion' && now - updatedAtMs > THREE_DAYS) {
      stagnantInDiscussion.push(lead);
    }

    // Check strong opportunities with documents ready
    if ((stage === 'strong_opportunity' || stage === 'in_discussion') && (lead.docPassportCopy || lead.docResume) && !lead.docOfficeVisited) {
      interviewOpportunities.push(lead);
    }
  });

  // Coordinator workload mapping
  const coordMap: Record<string, { total: number; newInbound: number; inDiscussion: number; stagnant: number; won: number }> = {};
  coordinators.forEach(c => {
    coordMap[c.username.toLowerCase()] = { total: 0, newInbound: 0, inDiscussion: 0, stagnant: 0, won: 0 };
  });

  activeLeads.forEach(lead => {
    if (lead.assignedTo) {
      const coordKey = lead.assignedTo.trim().toLowerCase();
      if (!coordMap[coordKey]) {
        coordMap[coordKey] = { total: 0, newInbound: 0, inDiscussion: 0, stagnant: 0, won: 0 };
      }
      coordMap[coordKey].total++;
      let stage = (lead.stage || 'new').toLowerCase();
      if (stage === 'new') coordMap[coordKey].newInbound++;
      if (stage === 'in_discussion' || stage === 'negotiating') coordMap[coordKey].inDiscussion++;
      if (stage === 'won') coordMap[coordKey].won++;
      
      const updatedAtMs = new Date(lead.updatedAt || lead.createdAt || 0).getTime();
      if (now - updatedAtMs > THREE_DAYS && stage !== 'won' && stage !== 'lost') {
        coordMap[coordKey].stagnant++;
      }
    }
  });

  const coordinatorWorkloads: CoordinatorWorkload[] = coordinators.map(c => {
    const data = coordMap[c.username.toLowerCase()] || { total: 0, newInbound: 0, inDiscussion: 0, stagnant: 0, won: 0 };
    let status: 'optimal' | 'busy' | 'overloaded' | 'available' = 'optimal';
    let recommendation = 'Workload is balanced. Performing steadily.';

    if (data.total > 250 || data.stagnant > 30) {
      status = 'overloaded';
      recommendation = `High pending pipeline (${data.stagnant} stagnant). Recommend reassigning new inbounds to teammates.`;
    } else if (data.total > 150) {
      status = 'busy';
      recommendation = 'Focus on progressing In Discussion candidates to interview stage.';
    } else if (data.total < 40) {
      status = 'available';
      recommendation = 'Ready for immediate new batch allocations or Kuwait/Japan campaigns.';
    }

    return {
      id: c.id,
      name: c.displayName || c.username,
      activeLeads: data.total,
      newInbound: data.newInbound,
      inDiscussion: data.inDiscussion,
      stagnantLeads: data.stagnant,
      wonLeads: data.won,
      status,
      recommendation
    };
  });

  // Generate actionable Alerts
  const alerts: SentinelAlert[] = [];

  if (unreadReplies.length > 0) {
    alerts.push({
      id: 'alert_unread_replies',
      type: 'urgent',
      title: `${unreadReplies.length} Candidates Awaiting WhatsApp Reply`,
      description: `Jobseekers sent messages that have not been read or responded to yet. Quick response time significantly boosts conversion.`,
      count: unreadReplies.length,
      leadIds: unreadReplies.slice(0, 10).map(l => l.id),
      suggestedAction: 'Open WhatsApp Chats and prioritize unread inbound replies.',
      actionType: 'view_leads'
    });
  }

  if (unassignedInbounds.length > 0) {
    alerts.push({
      id: 'alert_unassigned',
      type: 'urgent',
      title: `${unassignedInbounds.length} Inbound Leads Need Coordinator Assignment`,
      description: `${unassignedInbounds.length} candidates reached out via WhatsApp or ads and are currently unassigned.`,
      count: unassignedInbounds.length,
      leadIds: unassignedInbounds.slice(0, 10).map(l => l.id),
      suggestedAction: 'Assign available coordinators (Sarina, Joyce, Shreya) to intake these leads.',
      actionType: 'reassign'
    });
  }

  if (stagnantInDiscussion.length > 0) {
    alerts.push({
      id: 'alert_stagnant_discussion',
      type: 'warning',
      title: `${stagnantInDiscussion.length} Leads Stagnant in Discussion (> 3 Days)`,
      description: `Candidates in 'In Discussion' with no call remarks or status updates in over 72 hours.`,
      count: stagnantInDiscussion.length,
      leadIds: stagnantInDiscussion.slice(0, 10).map(l => l.id),
      suggestedAction: 'Send Re-activation WhatsApp Template or log telecalling follow-up call.',
      actionType: 'send_template'
    });
  }

  if (interviewOpportunities.length > 0) {
    alerts.push({
      id: 'alert_interview_ready',
      type: 'opportunity',
      title: `${interviewOpportunities.length} Verified Candidates Ready for Interview / Submission`,
      description: `Candidates have uploaded documents (passport copy / resume) and are prime candidates for client submission.`,
      count: interviewOpportunities.length,
      leadIds: interviewOpportunities.slice(0, 10).map(l => l.id),
      suggestedAction: 'Schedule interview or progress candidate to Office Visited / Interview stage.',
      actionType: 'view_leads'
    });
  }

  // Calculate Health Score
  let health = 100;
  if (unassignedInbounds.length > 0) health -= Math.min(25, unassignedInbounds.length * 3);
  if (unreadReplies.length > 0) health -= Math.min(20, unreadReplies.length * 2);
  if (stagnantInDiscussion.length > 100) health -= 15;
  else if (stagnantInDiscussion.length > 30) health -= 10;
  health = Math.max(45, Math.min(100, health));

  // High-level AI Insights
  const aiInsights = [
    `Pipeline volume stands at ${activeLeads.length} total active candidates with ${pipelineSummary.won} successful Closed Won placements.`,
    unassignedInbounds.length > 0
      ? `Action needed: ${unassignedInbounds.length} inbound leads are pending assignment. Rapid assignment under 15 mins increases lead engagement by 3x.`
      : `Great work! All inbound inquiries are currently assigned to active coordinators.`,
    stagnantInDiscussion.length > 0
      ? `Follow-up opportunity: ${stagnantInDiscussion.length} leads in discussion can be re-engaged using automated Meta WhatsApp outreach templates.`
      : `Discussion pipeline is active and healthy with ongoing coordinator touchpoints.`
  ];

  return {
    healthScore: health,
    totalActiveCandidates: activeLeads.length,
    alerts,
    coordinatorWorkloads,
    pipelineSummary,
    stagnantCount: stagnantInDiscussion.length,
    unassignedCount: unassignedInbounds.length,
    unreadRepliesCount: unreadReplies.length,
    aiInsights,
    lastScannedAt: new Date().toISOString()
  };
}

export async function askAiCopilot(
  query: string,
  userRole: string,
  agentId: string,
  conversationHistory: { role: 'user' | 'assistant'; text: string }[] = []
): Promise<{ reply: string; suggestions?: string[] }> {
  const overview = await computeSentinelOverview();
  const leads = await getLeads(false);
  const jobs = await getJobs();

  const ai = getAiClient();
  if (!ai) {
    // Intelligent local fallback if API key is not configured
    return {
      reply: `**AI Sentinel CRM Summary:**\n- **Health Score:** ${overview.healthScore}/100\n- **Total Active Candidates:** ${overview.totalActiveCandidates}\n- **In Discussion:** ${overview.pipelineSummary.inDiscussion}\n- **Unassigned Leads:** ${overview.unassignedCount}\n- **Awaiting Replies:** ${overview.unreadRepliesCount}\n\n*Action Recommendation:* Prioritize ${overview.unreadRepliesCount > 0 ? 'replying to incoming WhatsApp messages' : 'following up on stagnant leads in discussion'}.`,
      suggestions: [
        'Show stagnant leads needing follow-up',
        'Check coordinator workload distribution',
        'List top unassigned inbound leads'
      ]
    };
  }

  // Grounding context
  const contextSummary = `
You are the AI Sentinel & Operations Copilot for Career Growth Placement (CGP) Abroad Recruiting CRM.
Your role is to keep an eye on everything, identify pipeline bottlenecks, guide coordinators (Joyce, Maryada, Sarina, Shreya, Priya) and Admins (Sachin Saha / Master Admin), and provide clear, decisive operational recommendations.

Current CRM Real-Time Snapshot:
- CRM Health Score: ${overview.healthScore}/100
- Total Active Candidates: ${overview.totalActiveCandidates}
- Pipeline Stages:
  * 1. New Inbound: ${overview.pipelineSummary.newInbound}
  * 2. In Discussion: ${overview.pipelineSummary.inDiscussion}
  * 3. Strong Opportunity: ${overview.pipelineSummary.strongOpportunity}
  * 4. Office Visited / Interview: ${overview.pipelineSummary.officeVisited}
  * 5. Won (Placed): ${overview.pipelineSummary.won}
  * 6. Cold Leads: ${overview.pipelineSummary.coldLeads}
  * 7. Lost: ${overview.pipelineSummary.lost}
- Unassigned Inbound Leads: ${overview.unassignedCount}
- Candidates with Unread Replies: ${overview.unreadRepliesCount}
- Stagnant in Discussion (> 3 days): ${overview.stagnantCount}

Active Demand Jobs in System:
${jobs.slice(0, 5).map(j => `* ${j.title} (${j.country}) - ${(j as any).openings || j.positions?.length || 'Multiple'} openings, Salary: ${j.salaryRange || 'Competitive'}`).join('\n')}

Coordinator Workloads:
${overview.coordinatorWorkloads.map(c => `* ${c.name}: ${c.activeLeads} total, ${c.inDiscussion} in discussion, ${c.stagnantLeads} stagnant. Status: ${c.status}`).join('\n')}

User Context:
Role: ${userRole}
Agent ID: ${agentId}
`;

  try {
    const formattedContents = [
      {
        role: 'user',
        parts: [{ text: `${contextSummary}\n\nUser Question: ${query}` }]
      }
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: formattedContents,
      config: {
        systemInstruction: `You are the executive AI Sentinel Copilot for Career Growth Placement. Be concise, highly professional, encouraging, and provide concrete actionable suggestions (e.g., recommend specific coordinators, WhatsApp templates like 'Assign' or 'Re-Activate', or stage transitions). Format response with clean markdown bullet points.`,
        temperature: 0.2
      }
    });

    const text = response.text || 'I have analyzed the CRM data. All core systems are running smoothly.';
    return {
      reply: text,
      suggestions: [
        'Check stagnant leads in discussion',
        'Who are the top Kuwait hospitality candidates?',
        'Coordinator workload balance check',
        'Draft WhatsApp re-engagement message'
      ]
    };
  } catch (err: any) {
    console.error('[AI Sentinel Copilot] Error in Gemini query:', err?.message || err);
    return {
      reply: `**AI Sentinel Operational Insight:**\n- **CRM Health:** ${overview.healthScore}%\n- **Total Active Candidates:** ${overview.totalActiveCandidates}\n- **Unassigned Inbounds:** ${overview.unassignedCount}\n- **Stagnant Leads:** ${overview.stagnantCount}\n\n*Suggestion:* Review the unread incoming WhatsApp chats and follow up with candidates waiting in the discussion stage.`,
      suggestions: [
        'Review unassigned inbounds',
        'Check coordinator workloads',
        'Show interview opportunities'
      ]
    };
  }
}

export async function getLeadSpecificAiSuggestions(leadId: string): Promise<{
  summary: string;
  suggestedStage: string;
  suggestedAction: string;
  recommendedTemplate: string;
  missingItems: string[];
}> {
  const leads = await getLeads(false);
  const lead = leads.find(l => l.id === leadId);

  if (!lead) {
    return {
      summary: 'Candidate not found.',
      suggestedStage: 'new',
      suggestedAction: 'Verify lead details.',
      recommendedTemplate: 'assign',
      missingItems: []
    };
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
    suggestedAction = 'Assign to active coordinator (Joyce/Sarina/Maryada) and send Welcome / Assignment template.';
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
