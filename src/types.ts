export type LeadStage = 'new' | 'negotiating' | 'rotations' | 'proposal' | 'won' | 'lost';

export type FitScore = 'high' | 'medium' | 'low' | 'unqualified';

export interface Message {
  id: string;
  sender: 'user' | 'lead' | 'system';
  text: string;
  timestamp: string;
}

export interface Lead {
  id: string;
  serialNo?: string; // e.g. "5652" from sheet
  entryDate: string;
  assignDate: string;
  name: string;
  gender: string; // e.g. 'M', 'F', 'MALE', 'FEMALE'
  phone: string;
  alternateNo?: string;
  age: string | number;
  origin: string; // e.g. "Darjeeling", "Siliguri", "Sikkim"
  country: string; // e.g. "QATAR", "JAPAN", "DUBAI", "GERMANY"
  position: string; // e.g. "WITHSTAND", "Nurse", "COMMI I", "Bartender"
  experience: string; // e.g. "FRESHER", "2 years chef", etc.
  adminRemarks: string; // admin level remark or "ORGANIC"
  assignedTo: string; // Name of Sub Agent / Coordinator: Joyce, Sarina, Shreya, Edenla, etc.
  importance: number; // 0 to 5 star ratings
  remarks1: string; // 1st Remarks
  remarks2: string; // 2nd Remarks
  remarks3: string; // 3rd Remarks
  stage: LeadStage;
  budget: number; // Estimated commission / service value in USD
  budgetRaw: string;
  summary: string; // AI qualification summary for jobs
  requirements: string[]; // extracted requirements/skills
  fitScore: FitScore;
  nextAction: string;
  notes: string; // general custom notes
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  email?: string;
  campaign?: string;
  source?: string;
  project?: string;
  callConnected?: string;
  tags?: string[];
  docPassportCopy?: boolean;
  docResume?: boolean;
  docOfficeVisited?: boolean;
  docOthers?: boolean;
  reminderEnabled?: boolean;
  tasks?: {
    id: string;
    title: string;
    dueDate: string;
    completed: boolean;
    createdAt: string;
  }[];
  timeline?: {
    id: string;
    type: 'status' | 'remark' | 'assignment' | 'task' | 'creation' | 'system';
    text: string;
    actor: string;
    timestamp: string;
  }[];
}

export interface StatSummary {
  totalLeads: number;
  newLeads: number;
  convertedLeads: number;
  lostLeads: number;
  totalBudgetValue: number;
  averageFitScore: {
    high: number;
    medium: number;
    low: number;
    unqualified: number;
  };
  byStage: Record<LeadStage, number>;
  byCampaign: Array<{ campaign: string; count: number; value: number }>;
}

export interface Coordinator {
  id: string;
  username: string;
  displayName: string;
  password?: string; // Optional on client side for security
  role: 'admin' | 'agent';
  createdAt: string;
}

export interface Job {
  id: string;
  title: string;
  country: string;
  requirement: string;
  processingFeeMale: string;
  processingFeeFemale: string;
  accommodation: string;
  ageLimit: string;
  conditions: string[];
  modeOfInterview: string;
  applicability: string;
  otherTerms: string;
  isActive?: boolean;
  createdAt: string;
}

export interface ImportantUpdate {
  id: string;
  text: string;
  createdAt: string;
}



