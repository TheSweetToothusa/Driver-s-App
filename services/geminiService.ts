
import { GoogleGenAI, Modality } from "@google/genai";
import { Delivery, ManualStop } from "../types";

// Always use named parameter for apiKey and obtain it directly from process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const STORE_ADDRESS = "18435 NE 19th Ave, North Miami Beach, FL 33179";

/**
 * Summarizes the route notes using Gemini 3 Flash.
 */
export const summarizeRoute = async (notes: string[]) => {
  const prompt = `
    I am a delivery driver for THE SWEET TOOTH. 
    Instructions:
    ${notes.map((n, i) => `Stop ${i + 1}: ${n}`).join('\n')}
    
    Provide a professional briefing. Highlight gate codes and fragile items. 
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    // Extract text output using the .text property (not a method)
    return response.text || "Review order notes manually.";
  } catch (error) {
    console.error("Summarization failed", error);
    return "Review order notes manually.";
  }
};

export interface OptimizationResult {
  text: string;
  orderedIds: string[];
  mapLinks: { id: string, url: string, title: string, eta?: string }[];
}

/**
 * Optimizes the delivery route using Google Maps grounding.
 */
export const getOptimizedRoute = async (
  deliveries: Delivery[],
  manualStops: ManualStop[],
  currentLocation: { lat: number, lng: number } | null,
  preferences: { skipTolls: boolean }
): Promise<OptimizationResult> => {
  if (deliveries.length === 0 && manualStops.length === 0) {
    return { text: "No stops to optimize.", orderedIds: [], mapLinks: [] };
  }

  const stops = [
    ...deliveries.map(d => ({ id: d.id, desc: `${d.orderNumber}: ${d.address.street}, ${d.address.city}`, type: 'delivery' })),
    ...manualStops.map(s => ({ id: s.id, desc: `${s.type}: ${s.name} ${s.address || ''}`, type: 'manual' }))
  ];

  const prompt = `
    Find the most efficient delivery route starting from ${STORE_ADDRESS}.
    User's current location: ${currentLocation ? `${currentLocation.lat}, ${currentLocation.lng}` : 'Unknown (start from store)'}.
    Preferences: ${preferences.skipTolls ? 'SKIP TOLLS' : 'ALLOW TOLLS'}.
    
    Stops to visit:
    ${stops.map((s, i) => `${i}. [ID:${s.id}] ${s.desc}`).join('\n')}
    
    CRITICAL INSTRUCTIONS:
    1. Reorder the stops for the shortest travel time considering real-time traffic conditions in Miami/South Florida.
    2. Respect the 'SKIP TOLLS' preference if specified.
    3. For EACH stop, explicitly state an estimated arrival time (ETA) based on the start time (assume starting NOW).
    4. Provide a direct Google Maps navigation link for each.
    5. Return a clear summary briefing describing the route flow and WHY this order was chosen (e.g., "Avoiding heavy traffic on I-95").
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: currentLocation 
              ? { latitude: currentLocation.lat, longitude: currentLocation.lng }
              : { latitude: 25.946, longitude: -80.155 }
          }
        }
      },
    });

    // Extract text output using the .text property
    const text = response.text || "Route calculated based on current traffic.";
    
    const orderedIds: string[] = [];
    const idRegex = /ID:([\w_]+)/g;
    let match;
    while ((match = idRegex.exec(text)) !== null) {
      if (!orderedIds.includes(match[1])) {
        orderedIds.push(match[1]);
      }
    }

    // Extract URLs from groundingChunks as required by guidelines for grounding tools
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const mapLinks = groundingChunks.map((chunk: any, index: number) => {
      const title = chunk.maps?.title || '';
      const matchingStop = stops.find(s => title.includes(s.id) || s.desc.includes(title)) || stops[index];
      const etaMatch = text.match(new RegExp(`${matchingStop?.id}.*?ETA:?\\s*(\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm))`, 'i'));
      
      return {
        id: matchingStop?.id || `stop-${index}`,
        url: chunk.maps?.uri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(matchingStop?.desc || '')}`,
        title: title || matchingStop?.desc || 'Navigation',
        eta: etaMatch ? etaMatch[1] : undefined
      };
    });

    return {
      text,
      orderedIds: orderedIds.length > 0 ? orderedIds : stops.map(s => s.id),
      mapLinks
    };
  } catch (error) {
    console.error("Route optimization failed", error);
    return { 
      text: "Standard sequencing applied. Use map links for real-time traffic.", 
      orderedIds: stops.map(s => s.id),
      mapLinks: stops.map(s => ({
        id: s.id,
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.desc)}`,
        title: s.desc
      }))
    };
  }
};

/**
 * Generates a friendly SMS message for the customer.
 */
export const generateCustomerSMS = async (customerName: string, orderNumber: string) => {
  const prompt = `
    Write a short, friendly SMS message for a customer named ${customerName} regarding their Sweet Tooth order ${orderNumber}.
    The message should say that the driver is on their way and will arrive shortly.
    Keep it under 160 characters. Use a chocolate/sweet pun if possible.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || `Hi ${customerName}, your Sweet Tooth order ${orderNumber} is on the way!`;
  } catch (error) {
    console.error("SMS generation failed", error);
    return `Hi ${customerName}, your Sweet Tooth order ${orderNumber} is on the way!`;
  }
};

/**
 * Generates audio speech from text using the text-to-speech model.
 */
export const generateSpeech = async (text: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Delivery briefing: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    // Audio bytes are returned as raw PCM data in the inlineData property
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    console.error("Speech generation failed", error);
    return null;
  }
};

/**
 * Decodes and plays raw PCM audio data.
 */
export async function playRawAudio(base64Data: string) {
  try {
    const AudioCtxClass = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AudioCtxClass) return;

    const audioCtx = new AudioCtxClass({ sampleRate: 24000 });
    
    // Manual decoding implementation following API guidelines for PCM streams
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const dataInt16 = new Int16Array(bytes.buffer);
    const numChannels = 1;
    const sampleRate = 24000;
    const frameCount = dataInt16.length / numChannels;
    const buffer = audioCtx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
      }
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
  } catch (e) {
    console.error("Audio playback failed", e);
  }
}
