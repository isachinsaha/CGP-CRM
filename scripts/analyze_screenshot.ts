import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('No GEMINI_API_KEY found in environment variables.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function analyzeImages() {
  const imagesToAnalyze = [
    'uploads/Screenshot_2026-09-09_192231_1788961989450.png',
    'uploads/WhatsApp_Image_2026-09-09_at_5_04_46_PM_1788957241699.jpeg'
  ];

  console.log('=== ANALYZING UPLOADED SCREENSHOTS VIA GEMINI ===');

  for (const imgPath of imagesToAnalyze) {
    if (!fs.existsSync(imgPath)) {
      console.log(`File not found: ${imgPath}`);
      continue;
    }

    console.log(`\nAnalyzing ${imgPath}...`);
    let success = false;
    const modelsToTry = ['gemini-3.5-flash', 'gemini-1.5-flash', 'gemini-3.8-flash', 'gemini-2.5-pro'];

    for (const modelName of modelsToTry) {
      if (success) break;
      console.log(`  -> Trying model: ${modelName}`);
      try {
        const imgBuffer = fs.readFileSync(imgPath);
        const base64Data = imgBuffer.toString('base64');

        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    data: base64Data,
                    mimeType: imgPath.endsWith('.png') ? 'image/png' : 'image/jpeg'
                  }
                },
                {
                  text: 'This is a screenshot from our CRM or from WhatsApp. Please read and transcribe everything visible in this image. Specifically, look for candidate details, coordinator names, phone numbers (like 8101088716, 7428031579, 9081078132), call statuses, and most importantly any remarks, notes, or comments entered under First Remarks, Second Remarks, Third Remarks, or Admin Remarks.'
                }
              ]
            }
          ]
        });

        console.log(`Result with ${modelName}:`);
        console.log(response.text);
        success = true;
      } catch (err) {
        console.error(`  -> Failed with model ${modelName}:`, err instanceof Error ? err.message : err);
      }
    }
    if (!success) {
      console.error(`Could not analyze ${imgPath} with any of the attempted models.`);
    }
  }
}

analyzeImages().catch(console.error);
