/**
 * Capabilities a tenant can enable (F24). Anything not listed here is unknown
 * and therefore disabled.
 */
export const CAPABILITIES = {
  assessment: { label: 'Symptom assessment', platformFlag: 'assessment', phase: 'P0' },
  ai_generation: { label: 'AI-written summaries', platformFlag: 'ai_generation', phase: 'P0' },
  medicines_education: { label: 'Medicine education', platformFlag: null, phase: 'P0' },
  provider_directory: { label: 'Provider directory', platformFlag: null, phase: 'P0' },
  external_handoff: { label: 'External booking handoff', platformFlag: 'provider_handoff', phase: 'P0' },
  clinician_review: { label: 'Clinician review queue', platformFlag: null, phase: 'P0' },
  analytics: { label: 'Product analytics', platformFlag: null, phase: 'P0' },
  medicines_personalized: { label: 'Personalised medicine guidance', platformFlag: null, phase: 'P2' },
  voice_input: { label: 'Voice input', platformFlag: 'voice_input', phase: 'P1' },
  report_upload: { label: 'Report upload and extraction', platformFlag: 'report_upload', phase: 'P1' },
  live_scheduling: { label: 'Live appointment scheduling', platformFlag: 'live_scheduling', phase: 'P1' },
  signed_guidance: { label: 'Clinician-signed guidance', platformFlag: null, phase: 'P1' },
  multilingual: { label: 'Additional languages', platformFlag: null, phase: 'P1' },
  notifications: { label: 'Reminders and notifications', platformFlag: 'notifications', phase: 'P1' },
  ehr_integration: { label: 'EHR / FHIR integration', platformFlag: 'ehr_integration', phase: 'P2' },
  payments: { label: 'Consultation payments', platformFlag: 'payments', phase: 'P2' },
} as const;

export type Capability = keyof typeof CAPABILITIES;

export const DEFAULT_CAPABILITIES: Capability[] = [
  'assessment',
  'ai_generation',
  'medicines_education',
  'provider_directory',
  'external_handoff',
  'clinician_review',
  'analytics',
];

export function isCapability(value: string): value is Capability {
  return Object.hasOwn(CAPABILITIES, value);
}
