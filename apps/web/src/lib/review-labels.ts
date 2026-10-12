export const REVIEW_REASON: Record<string, string> = {
  urgency_emergency: "Emergency result",
  urgency_urgent: "Urgent result",
  ai_draft_failed_verification: "AI summary failed safety checks",
  decision_model_flagged_possible_emergency: "AI flagged a possible emergency",
};

export const reasonLabel = (reason: string) => REVIEW_REASON[reason] ?? reason.replace(/_/g, " ");

export const FACT_SOURCE: Record<string, string> = {
  answer: "answered a question",
  llm: "from their words (AI-read)",
  rules: "from their words",
  profile: "from their profile",
};
