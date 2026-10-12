/**
 * SYNTHETIC knowledge library for the demo tenant. Written for pipeline
 * testing only; not reviewed by clinicians and not suitable for patient use.
 */
export interface KnowledgeSeed {
  sourceKey: string;
  title: string;
  publisher: string;
  url: string;
  concernCodes: string[];
  version: string;
  chunks: { heading: string; text: string }[];
}

const publisher = 'Nora Demo Clinical Content (synthetic)';

const ALL_CONCERNS = ['sore_throat', 'headache', 'urinary', 'cough', 'back_pain', 'abdominal_pain', 'skin_rash', 'ear_pain', 'dizziness', 'cold_flu', 'gastro', 'fever'];

export const demoKnowledge: KnowledgeSeed[] = [
  {
    sourceKey: 'src_red_flags',
    title: 'Emergency warning signs in adults',
    publisher,
    url: 'https://example.org/nora-demo/red-flags',
    concernCodes: ALL_CONCERNS,
    version: '1.0',
    chunks: [
      { heading: 'When to call 112', text: 'Call 112 immediately for chest pain or pressure, severe difficulty breathing, signs of stroke (face drooping, arm weakness, slurred speech), new confusion, or swelling of the lips, tongue or throat. Do not drive yourself to hospital.' },
      { heading: 'Meningitis warning signs', text: 'Fever with a stiff neck, sensitivity to light, or a rash that does not fade when a glass is pressed against it can be signs of meningitis. This is a medical emergency.' },
      { heading: 'Same-day care', text: 'Very high fever (39.5 °C or above), coughing up blood, new breathlessness, or severe pain should be assessed by a doctor the same day.' },
    ],
  },
  {
    sourceKey: 'src_sore_throat',
    title: 'Sore throat in adults',
    publisher,
    url: 'https://example.org/nora-demo/sore-throat',
    concernCodes: ['sore_throat'],
    version: '1.0',
    chunks: [
      { heading: 'Common causes', text: 'Most sore throats are caused by viruses, often with a runny nose and cough, and get better within about a week without antibiotics.' },
      { heading: 'Bacterial throat infection', text: 'Fever, swollen tender neck glands, pus on the tonsils and the absence of cough make a bacterial (streptococcal) throat infection more likely. A clinician can decide whether testing or antibiotics are needed.' },
      { heading: 'Self-care', text: 'Warm salt-water gargles, warm drinks, honey, rest and fluids can ease symptoms. A pharmacist can advise on over-the-counter pain relief.' },
      { heading: 'Warning signs', text: 'Difficulty swallowing saliva, drooling, a muffled voice or difficulty breathing can mean serious swelling in the throat and need emergency care. A sore throat lasting more than a week should be checked.' },
    ],
  },
  {
    sourceKey: 'src_headache',
    title: 'Headache in adults',
    publisher,
    url: 'https://example.org/nora-demo/headache',
    concernCodes: ['headache'],
    version: '1.0',
    chunks: [
      { heading: 'Tension-type headache', text: 'Tension-type headaches feel like a tight band around the head. They are linked to stress, poor sleep, dehydration, posture and long screen time, and usually respond to rest and simple measures.' },
      { heading: 'Migraine', text: 'Migraine causes a throbbing headache, often on one side, with nausea, sensitivity to light or sound, and sometimes visual aura such as flashing lights. A headache diary helps identify triggers.' },
      { heading: 'Dangerous headaches', text: 'A sudden headache that reaches maximum intensity within a minute ("thunderclap" or "worst ever"), or a headache with stiff neck, fever, confusion, weakness or a non-fading rash, needs emergency assessment.' },
    ],
  },
  {
    sourceKey: 'src_urinary',
    title: 'Urinary tract infections in adults',
    publisher,
    url: 'https://example.org/nora-demo/uti',
    concernCodes: ['urinary'],
    version: '1.0',
    chunks: [
      { heading: 'Bladder infection', text: 'Burning when passing urine and needing to go more often are typical of a bladder infection (cystitis). A clinician should assess within one to two days to decide on testing and treatment.' },
      { heading: 'Kidney infection', text: 'Fever, pain in the side or back below the ribs, nausea or vomiting with urinary symptoms can mean the infection has reached the kidneys. This needs same-day medical care.' },
      { heading: 'Self-care', text: 'Drink water regularly and avoid holding urine. Blood in the urine should always be checked by a doctor.' },
    ],
  },
  {
    sourceKey: 'src_cough',
    title: 'Acute cough in adults',
    publisher,
    url: 'https://example.org/nora-demo/cough',
    concernCodes: ['cough'],
    version: '1.0',
    chunks: [
      { heading: 'Most coughs are viral', text: 'Most short-term coughs are caused by viral infections and can last up to three weeks. Antibiotics do not help viral coughs.' },
      { heading: 'Self-care', text: 'Warm drinks with honey, steam inhalation and avoiding smoke can ease a cough. Rest and fluids help recovery.' },
      { heading: 'When to seek care', text: 'See a doctor the same day for breathlessness, coughing up blood, chest pain, or high fever. A cough lasting more than three weeks should be reviewed.' },
    ],
  },
  {
    sourceKey: 'src_back_pain',
    title: 'Low back pain in adults',
    publisher,
    url: 'https://example.org/nora-demo/back-pain',
    concernCodes: ['back_pain'],
    version: '1.0',
    chunks: [
      { heading: 'Mechanical back pain', text: 'Most low back pain is caused by strain of muscles, ligaments or joints and improves within a few weeks. Staying gently active helps more than bed rest.' },
      { heading: 'Sciatica', text: 'Pain spreading down one leg, sometimes with tingling, can come from an irritated nerve root. Most cases settle with time and activity.' },
      { heading: 'Cauda equina warning signs', text: 'Numbness around the buttocks or genitals, new difficulty controlling the bladder or bowels, or new leg weakness with back pain needs emergency assessment.' },
    ],
  },
  {
    sourceKey: 'src_abdominal',
    title: 'Abdominal pain in adults',
    publisher,
    url: 'https://example.org/nora-demo/abdominal-pain',
    concernCodes: ['abdominal_pain'],
    version: '1.0',
    chunks: [
      { heading: 'Gastroenteritis', text: 'Tummy cramps with diarrhoea and vomiting are commonly caused by gut infections. Oral rehydration solution and small frequent sips of fluid prevent dehydration.' },
      { heading: 'Indigestion', text: 'Burning upper abdominal discomfort related to meals, spicy food or stress is often indigestion or acidity.' },
      { heading: 'Appendicitis', text: 'Pain that starts around the navel and moves to the lower right, especially with fever or pain on moving, can be appendicitis and needs examination the same day.' },
      { heading: 'Bleeding warning signs', text: 'Vomiting blood or coffee-ground material, black tarry stools, or a hard rigid abdomen are emergencies.' },
    ],
  },
  {
    sourceKey: 'src_skin_rash',
    title: 'Skin rashes in adults',
    publisher,
    url: 'https://example.org/nora-demo/skin-rash',
    concernCodes: ['skin_rash'],
    version: '1.0',
    chunks: [
      { heading: 'Irritation and allergy', text: 'An itchy red rash that appears after contact with a new soap, cream, detergent, plant, food or medicine is often contact or allergic dermatitis. Avoiding the trigger usually lets it settle within one to two weeks.' },
      { heading: 'Hives', text: 'Hives (urticaria) are raised, itchy welts that move around and often fade within a day. They can follow infections, foods, medicines or heat.' },
      { heading: 'Rash with fever', text: 'A rash with fever is often caused by a viral infection, but in India dengue and other infections should be considered, so a doctor should check it.' },
      { heading: 'Warning signs', text: 'Swelling of the lips, tongue or throat or difficulty breathing with a rash can be anaphylaxis and needs emergency care. Blistering or peeling skin, or sores in the mouth or eyes, needs a doctor the same day. Spots that do not fade under a pressed glass are an emergency.' },
    ],
  },
  {
    sourceKey: 'src_ear_pain',
    title: 'Earache in adults',
    publisher,
    url: 'https://example.org/nora-demo/ear-pain',
    concernCodes: ['ear_pain'],
    version: '1.0',
    chunks: [
      { heading: 'Middle ear infection', text: 'Middle ear infections often follow a cold and cause pain, muffled hearing and sometimes fever. Most improve within three days without antibiotics.' },
      { heading: 'Outer ear infection', text: 'Infection of the ear canal causes pain, itching and discharge, often after water exposure or using cotton buds. Keeping the ear dry helps; a doctor may prescribe ear drops.' },
      { heading: 'Warning signs', text: 'Painful swelling or redness behind the ear, a stiff neck, or confusion with ear pain can mean the infection has spread and needs urgent assessment. Discharge from the ear or pain lasting more than three days should be checked.' },
    ],
  },
  {
    sourceKey: 'src_dizziness',
    title: 'Dizziness in adults',
    publisher,
    url: 'https://example.org/nora-demo/dizziness',
    concernCodes: ['dizziness'],
    version: '1.0',
    chunks: [
      { heading: 'Light-headedness', text: 'Feeling faint or light-headed when standing up is often caused by a brief drop in blood pressure, dehydration, missed meals or illness. Sitting down and getting up slowly helps.' },
      { heading: 'Vertigo', text: 'A spinning sensation brought on by head movement usually comes from the inner ear (for example BPPV or vestibular neuritis). It can come with nausea and usually settles over days to weeks.' },
      { heading: 'Warning signs', text: 'Dizziness with face drooping, arm weakness, slurred speech, chest pain, fainting, or a racing or irregular heartbeat can mean a heart or brain problem and needs urgent or emergency care.' },
    ],
  },
  {
    sourceKey: 'src_cold_flu',
    title: 'Colds and flu-like illness in adults',
    publisher,
    url: 'https://example.org/nora-demo/cold-flu',
    concernCodes: ['cold_flu'],
    version: '1.0',
    chunks: [
      { heading: 'Common cold', text: 'Colds cause a runny or blocked nose, sneezing and a mild sore throat, and usually clear within 7–10 days. Antibiotics do not help.' },
      { heading: 'Flu-like illness', text: 'Flu and similar viruses cause sudden fever, body aches, tiredness and cough. Rest and fluids help; most people recover within two weeks.' },
      { heading: 'When to seek care', text: 'See a doctor if you become breathless, have chest pain, the fever lasts more than three days, or you are not improving after 10 days.' },
    ],
  },
  {
    sourceKey: 'src_gastro',
    title: 'Diarrhoea and vomiting in adults',
    publisher,
    url: 'https://example.org/nora-demo/diarrhoea-vomiting',
    concernCodes: ['gastro', 'abdominal_pain'],
    version: '1.0',
    chunks: [
      { heading: 'Stomach bugs and food poisoning', text: 'Most diarrhoea and vomiting is caused by gut infections or contaminated food and settles within a few days.' },
      { heading: 'Rehydration', text: 'Oral rehydration solution (ORS) replaces the water and salts lost. Take small sips often, even if you are vomiting, and eat light food when you can.' },
      { heading: 'Warning signs', text: 'Being unable to keep fluids down, passing very little urine, feeling very thirsty or dizzy, blood in the stools, or symptoms lasting more than a week should be checked by a doctor. Vomiting blood or black stools is an emergency.' },
    ],
  },
  {
    sourceKey: 'src_fever',
    title: 'Fever in adults (India)',
    publisher,
    url: 'https://example.org/nora-demo/fever',
    concernCodes: ['fever', 'skin_rash'],
    version: '1.0',
    chunks: [
      { heading: 'Viral fever', text: 'Most short fevers in adults are caused by viral infections and settle within three days with rest and fluids.' },
      { heading: 'Fevers that need testing', text: 'In India, a fever lasting three days or more, or a fever with rash, severe body or joint aches, or pain behind the eyes, may be due to dengue, malaria or typhoid. A doctor can arrange blood tests.' },
      { heading: 'Warning signs', text: 'Fever with a stiff neck, a rash that does not fade when pressed, confusion, or difficulty breathing needs emergency care.' },
    ],
  },
  {
    sourceKey: 'src_self_care_general',
    title: 'General self-care and when to see a doctor',
    publisher,
    url: 'https://example.org/nora-demo/self-care',
    concernCodes: ALL_CONCERNS,
    version: '1.0',
    chunks: [
      { heading: 'Rest and fluids', text: 'Rest, regular fluids and light meals support recovery from most minor illnesses.' },
      { heading: 'Medicines', text: 'Ask a pharmacist or doctor before taking any new medicine, especially if you take other medicines, are pregnant, or have kidney, liver or stomach problems.' },
      { heading: 'Persistent symptoms', text: 'Symptoms that last more than two weeks, a fever lasting five days or more, or severe pain should be reviewed by a doctor.' },
    ],
  },
  {
    sourceKey: 'src_mental_health_crisis',
    title: 'Getting help in a mental health crisis (India)',
    publisher,
    url: 'https://example.org/nora-demo/crisis',
    concernCodes: [],
    version: '1.0',
    chunks: [
      { heading: 'Immediate support', text: 'Tele-MANAS (14416) offers free, confidential mental health support 24 hours a day in multiple Indian languages. If you are in immediate danger, call 112.' },
    ],
  },
];
