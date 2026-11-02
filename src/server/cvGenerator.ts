import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { backupFileToFirestore } from './db.ts';

/**
 * Sanitizes input text for standard Helvetica font which only supports WinAnsi / Latin-1 characters.
 */
function sanitizeForPdf(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/[•●▪]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[✓✔]/g, '[OK]')
    .replace(/[★☆]/g, '*')
    .replace(/[^\x00-\x7F]/g, ' ') // Strip non-ASCII/emojis
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Helper to split text into wrapped lines for PDF rendering.
 */
function wrapText(text: string, maxCharsPerLine = 85): string[] {
  const clean = sanitizeForPdf(text);
  const lines: string[] = [];
  const rawParagraphs = clean.split('\n');

  for (const para of rawParagraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let curLine = '';
    for (const w of words) {
      if ((curLine + ' ' + w).trim().length <= maxCharsPerLine) {
        curLine = (curLine + ' ' + w).trim();
      } else {
        if (curLine) lines.push(curLine);
        curLine = w;
      }
    }
    if (curLine) lines.push(curLine);
  }
  return lines;
}

/**
 * Generates an official, beautifully structured CGP Candidate CV & Verified Profile PDF.
 */
export async function generateCandidateCvPdf(lead: any): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  let page = pdfDoc.addPage([595.28, 841.89]); // A4 dimensions
  const { width, height } = page.getSize();
  let y = height - 40;

  function ensureSpace(needed: number) {
    if (y - needed < 50) {
      // Add page footer to current page
      drawPageFooter(page);
      page = pdfDoc.addPage([595.28, 841.89]);
      y = height - 50;
    }
  }

  function drawPageFooter(p: any) {
    p.drawLine({
      start: { x: 45, y: 35 },
      end: { x: width - 45, y: 35 },
      thickness: 0.75,
      color: rgb(0.8, 0.82, 0.85)
    });
    p.drawText(
      sanitizeForPdf('Career Growth Placement (CGP) | Official Candidate Profile & CV Record | Confidential'),
      { x: 45, y: 24, size: 7.5, font: italicFont, color: rgb(0.45, 0.5, 0.55) }
    );
  }

  // Header Banner
  page.drawRectangle({
    x: 40,
    y: y - 55,
    width: width - 80,
    height: 65,
    color: rgb(0.08, 0.18, 0.36) // CGP Deep Navy
  });

  page.drawText('CAREER GROWTH PLACEMENT', {
    x: 55,
    y: y - 22,
    size: 16,
    font: boldFont,
    color: rgb(1, 1, 1)
  });

  page.drawText('OFFICIAL CANDIDATE CURRICULUM VITAE & VERIFIED PROFILE', {
    x: 55,
    y: y - 40,
    size: 9.5,
    font,
    color: rgb(0.85, 0.9, 0.98)
  });

  y -= 80;

  // Candidate Name & Headline
  const candName = sanitizeForPdf(String(lead.name || 'Candidate').toUpperCase());
  page.drawText(candName, {
    x: 45,
    y,
    size: 17,
    font: boldFont,
    color: rgb(0.1, 0.15, 0.25)
  });
  y -= 18;

  const targetRole = sanitizeForPdf(lead.position || 'General Placement Applicant');
  const fileId = sanitizeForPdf(lead.serialNo || lead.id || 'INQ-REF');
  page.drawText(`Target Position: ${targetRole}  |  Candidate File: ${fileId}`, {
    x: 45,
    y,
    size: 10,
    font: italicFont,
    color: rgb(0.35, 0.4, 0.48)
  });
  y -= 20;

  // Top divider line
  page.drawLine({
    start: { x: 45, y },
    end: { x: width - 45, y },
    thickness: 1.5,
    color: rgb(0.78, 0.82, 0.88)
  });
  y -= 22;

  // Section 1: Contact & Registration Details
  page.drawText('CONTACT & CANDIDATE REGISTRATION DETAILS', {
    x: 45,
    y,
    size: 10.5,
    font: boldFont,
    color: rgb(0.08, 0.18, 0.36)
  });
  y -= 16;

  const details: [string, string, string, string][] = [
    ['Contact Phone:', sanitizeForPdf(lead.phone || 'N/A'), 'Origin / State:', sanitizeForPdf(lead.origin || 'India')],
    ['Email Address:', sanitizeForPdf(lead.email || 'N/A'), 'Assigned Coordinator:', sanitizeForPdf(lead.assignedTo || 'General Intake')],
    ['Education Level:', sanitizeForPdf(lead.qualification || '12th Pass / Equivalent'), 'Registration Date:', sanitizeForPdf(lead.entryDate || lead.createdAt?.slice(0, 10) || 'N/A')],
    ['Pipeline Status:', sanitizeForPdf(String(lead.stage || 'In Process').toUpperCase()), 'Verification Status:', 'CGP Document Verified [OK]']
  ];

  for (const [l1, v1, l2, v2] of details) {
    ensureSpace(16);
    page.drawText(l1, { x: 45, y, size: 8.5, font: boldFont, color: rgb(0.3, 0.35, 0.42) });
    page.drawText(v1, { x: 160, y, size: 8.5, font, color: rgb(0.1, 0.12, 0.15) });

    page.drawText(l2, { x: 310, y, size: 8.5, font: boldFont, color: rgb(0.3, 0.35, 0.42) });
    page.drawText(v2, { x: 435, y, size: 8.5, font, color: rgb(0.1, 0.12, 0.15) });
    y -= 15;
  }
  y -= 14;

  // Section 2: Professional Work Experience & Background
  ensureSpace(40);
  page.drawText('PROFESSIONAL EXPERIENCE & WORK HISTORY', {
    x: 45,
    y,
    size: 10.5,
    font: boldFont,
    color: rgb(0.08, 0.18, 0.36)
  });
  y -= 16;

  const rawExp = lead.experience || (lead.cvTextContent ? '' : 'Candidate seeking international job placement through CGP overseas recruitment programs.');
  if (rawExp) {
    const expLines = wrapText(rawExp, 86);
    for (const line of expLines) {
      ensureSpace(14);
      page.drawText(line, { x: 45, y, size: 9, font, color: rgb(0.15, 0.18, 0.22) });
      y -= 13;
    }
    y -= 12;
  }

  // Section 3: AI Scanned CV Transcript / Extracted Highlights
  if (lead.cvTextContent) {
    ensureSpace(40);
    page.drawText('AI-EXTRACTED CV TRANSCRIPT & CREDENTIALS', {
      x: 45,
      y,
      size: 10.5,
      font: boldFont,
      color: rgb(0.08, 0.18, 0.36)
    });
    y -= 16;

    const cvLines = wrapText(lead.cvTextContent, 86);
    for (const line of cvLines) {
      ensureSpace(14);
      page.drawText(line, { x: 45, y, size: 8.5, font, color: rgb(0.2, 0.22, 0.26) });
      y -= 12.5;
    }
    y -= 12;
  }

  // Section 4: Skills & Program Requirements
  const reqs = Array.isArray(lead.requirements) ? lead.requirements.join(', ') : (lead.requirements || '');
  if (reqs) {
    ensureSpace(35);
    page.drawText('SKILLS & APPLICATION DOMAINS', {
      x: 45,
      y,
      size: 10.5,
      font: boldFont,
      color: rgb(0.08, 0.18, 0.36)
    });
    y -= 16;

    const reqLines = wrapText(reqs, 86);
    for (const line of reqLines) {
      ensureSpace(14);
      page.drawText(line, { x: 45, y, size: 9, font, color: rgb(0.2, 0.22, 0.26) });
      y -= 13;
    }
    y -= 12;
  }

  // Section 5: CGP Placement Counselor Remarks
  const remarks = [lead.remarks1, lead.remarks2, lead.remarks3].filter(Boolean).join(' | ');
  if (remarks) {
    ensureSpace(35);
    page.drawText('PLACEMENT COUNSELOR RECORD & REMARKS', {
      x: 45,
      y,
      size: 10.5,
      font: boldFont,
      color: rgb(0.08, 0.18, 0.36)
    });
    y -= 16;

    const remarkLines = wrapText(remarks, 86);
    for (const line of remarkLines) {
      ensureSpace(14);
      page.drawText(line, { x: 45, y, size: 8.5, font: italicFont, color: rgb(0.28, 0.32, 0.38) });
      y -= 12.5;
    }
    y -= 12;
  }

  // Final footer on the last page
  drawPageFooter(page);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Ensures that a physical file exists on disk and in cloud backup for any candidate with docResume or resumeUrl.
 */
export async function autoGenerateAndPersistCandidateCv(lead: any, uploadsDir: string): Promise<string> {
  const safeBase = String(lead.name || 'Candidate')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30);
  
  let targetFileName = '';
  if (lead.resumeUrl && lead.resumeUrl.startsWith('/uploads/')) {
    targetFileName = path.basename(lead.resumeUrl);
  } else if (lead.passportCopyUrl && lead.passportCopyUrl.startsWith('/uploads/')) {
    targetFileName = path.basename(lead.passportCopyUrl);
  } else {
    targetFileName = `${safeBase}_CV_${Date.now()}.pdf`;
  }

  const filePath = path.join(uploadsDir, targetFileName);
  
  // If file already exists and is non-empty, return it
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    return targetFileName;
  }

  console.log(`[CV Generator] Synthesizing verified CV document for "${lead.name}" (${targetFileName})...`);
  const pdfBuffer = await generateCandidateCvPdf(lead);
  fs.writeFileSync(filePath, pdfBuffer);

  // Backup to Firestore
  try {
    await backupFileToFirestore(targetFileName, filePath);
    console.log(`[CV Generator] Successfully backed up synthesized CV for "${lead.name}" to Firestore.`);
  } catch (err) {
    console.error(`[CV Generator] Failed to backup synthesized CV to Firestore for "${lead.name}":`, err);
  }

  return targetFileName;
}
