/**
 * Knowledge library for the demo tenant. Each source is a short summary,
 * written for Nora, of a named public page from the NHS, the World Health
 * Organization or India's Ministry of Health; the URL is the page it
 * summarises. The summaries have not been reviewed by a clinician, so they are
 * labelled as summaries rather than as the publisher's own text.
 */
export interface KnowledgeSeed {
  sourceKey: string;
  title: string;
  publisher: string;
  url: string;
  licence: string;
  concernCodes: string[];
  version: string;
  chunks: { heading: string; text: string }[];
}

const NHS = 'Based on NHS guidance (nhs.uk)';
const WHO = 'Based on World Health Organization guidance (who.int)';
const MOHFW = 'Ministry of Health and Family Welfare, India (Tele-MANAS)';
const SUMMARY = 'Summary written for Nora from the linked public page; not reviewed by a clinician';
const version = '2.0';

const ALL_CONCERNS = ['sore_throat', 'headache', 'urinary', 'cough', 'back_pain', 'abdominal_pain', 'skin_rash', 'ear_pain', 'dizziness', 'cold_flu', 'gastro', 'fever', 'animal_bite'];

export const demoKnowledge: KnowledgeSeed[] = [
  {
    sourceKey: 'src_red_flags',
    title: 'Emergency warning signs in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-call-999/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      { heading: 'When to call 112', text: 'Call 112 immediately for chest pain or pressure, severe difficulty breathing, signs of stroke (face drooping, arm weakness, slurred speech), new confusion, or swelling of the lips, tongue or throat. Do not drive yourself to hospital.' },
      { heading: 'Meningitis warning signs', text: 'Fever with a stiff neck, sensitivity to light, or a rash that does not fade when a glass is pressed against it can be signs of meningitis. This is a medical emergency.' },
      { heading: 'Same-day care', text: 'Very high fever (39.5 °C or above), coughing up blood, new breathlessness, or severe pain should be assessed by a doctor the same day.' },
      { heading: 'When you are not sure', text: 'If you cannot rule out a warning sign, or are unsure whether your symptoms are serious, get medical advice rather than waiting.' },
      { heading: 'Uncontrolled bleeding', text: 'Bleeding that will not stop when firm pressure is applied is an emergency: call 112.' },
    ],
  },
  {
    sourceKey: 'src_sore_throat',
    title: 'Sore throat in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/sore-throat/',
    licence: SUMMARY,
    concernCodes: ['sore_throat'],
    version,
    chunks: [
      { heading: 'Common causes', text: 'Most sore throats are caused by viruses, often with a runny nose and cough, and get better within about a week without antibiotics.' },
      { heading: 'When a sore throat needs checking', text: 'A sore throat with fever, swollen tender neck glands or pus on the tonsils, and no cough, should be checked by a clinician, who can decide whether testing or antibiotics are needed.' },
      { heading: 'Self-care', text: 'Warm salt-water gargles, drinking plenty of water, cool or soft foods, rest and avoiding smoke can ease symptoms. A pharmacist can advise on over-the-counter pain relief.' },
      { heading: 'Same-day care', text: 'A sore throat with a very high temperature or shivering, signs of dehydration, or a weakened immune system (for example from diabetes or chemotherapy) should be checked by a doctor the same day.' },
      { heading: 'Warning signs', text: 'Being unable to swallow, drooling, a high-pitched sound when breathing or difficulty breathing can mean serious swelling in the throat and need emergency care. A sore throat that does not improve after a week should be checked.' },
    ],
  },
  {
    sourceKey: 'src_headache',
    title: 'Headache in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/headaches/',
    licence: SUMMARY,
    concernCodes: ['headache'],
    version,
    chunks: [
      { heading: 'Tension-type headache', text: 'Tension-type headaches feel like a tight band around the head. They are linked to stress, poor sleep, dehydration, posture and long screen time, and usually respond to rest and simple measures.' },
      { heading: 'Migraine', text: 'Migraine causes a throbbing headache, often on one side, with nausea, sensitivity to light or sound, and sometimes visual aura such as flashing lights. A headache diary helps identify triggers.' },
      { heading: 'Same-day care', text: 'A headache with vision problems, with vomiting, or one triggered or made worse by coughing, sneezing or bending should be checked by a doctor the same day.' },
      { heading: 'Dangerous headaches', text: 'A sudden, extremely painful headache, or a headache after a head injury in the last three months, or with a stiff neck, very high temperature, confusion, weakness, a seizure, loss of vision or a rash that does not fade, needs emergency assessment.' },
    ],
  },
  {
    sourceKey: 'src_urinary',
    title: 'Urinary tract infections in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/urinary-tract-infections-utis/',
    licence: SUMMARY,
    concernCodes: ['urinary'],
    version,
    chunks: [
      { heading: 'Bladder infection', text: 'Burning when passing urine and needing to go more often are typical of a bladder infection (cystitis). A clinician should assess within one to two days to decide on testing and treatment.' },
      { heading: 'Kidney infection', text: 'Fever, pain in the side or back below the ribs, nausea or vomiting with urinary symptoms can mean the infection has reached the kidneys. This needs same-day medical care.' },
      { heading: 'Higher-risk groups', text: 'People aged 65 or over, men, and people with diabetes or a weakened immune system should get a same-day appointment for urinary infection symptoms, as should anyone with blood in their urine.' },
      { heading: 'Self-care', text: 'Drink enough fluids to pass pale urine regularly and avoid holding urine in.' },
    ],
  },
  {
    sourceKey: 'src_cough',
    title: 'Acute cough in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/cough/',
    licence: SUMMARY,
    concernCodes: ['cough'],
    version,
    chunks: [
      { heading: 'Most coughs are viral', text: 'Most short-term coughs are caused by colds or flu and clear up within three to four weeks. Antibiotics do not help viral coughs.' },
      { heading: 'Self-care', text: 'Rest, plenty of fluids, and hot lemon and honey can ease a cough. Avoiding smoke helps recovery.' },
      { heading: 'When to seek care', text: 'See a doctor the same day for breathlessness, coughing up blood, chest pain, or a cough that is very bad or getting worse quickly. A cough lasting more than three weeks, or a cough when you have a weakened immune system or diabetes, should be reviewed by a doctor.' },
    ],
  },
  {
    sourceKey: 'src_back_pain',
    title: 'Low back pain in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/back-pain/',
    licence: SUMMARY,
    concernCodes: ['back_pain'],
    version,
    chunks: [
      { heading: 'Mechanical back pain', text: 'Most low back pain is caused by strain of muscles, ligaments or joints and improves within a few weeks. Staying gently active helps more than bed rest.' },
      { heading: 'Sciatica', text: 'Pain spreading down one leg, sometimes with tingling, can come from an irritated nerve root. Most cases settle with time and activity.' },
      { heading: 'Same-day care', text: 'Back pain with feeling hot, cold or shivery, or severe pain that starts suddenly or gets worse quickly, should be checked by a doctor the same day.' },
      { heading: 'Cauda equina warning signs', text: 'Numbness around the buttocks or genitals, new difficulty controlling the bladder or bowels, or weakness or numbness in both legs with back pain needs emergency assessment.' },
    ],
  },
  {
    sourceKey: 'src_abdominal',
    title: 'Abdominal pain in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/stomach-ache/',
    licence: SUMMARY,
    concernCodes: ['abdominal_pain'],
    version,
    chunks: [
      { heading: 'Gastroenteritis', text: 'Tummy cramps with diarrhoea and vomiting are commonly caused by gut infections. Oral rehydration solution and small frequent sips of fluid prevent dehydration.' },
      { heading: 'Indigestion', text: 'Burning upper abdominal discomfort related to meals, spicy food or stress is often indigestion or acidity.' },
      { heading: 'Appendicitis', text: 'Pain that starts around the navel and moves to the lower right, especially with fever or pain on moving, can be appendicitis and needs examination the same day.' },
      { heading: 'Emergency warning signs', text: 'A stomach ache that comes on suddenly or is severe, pain when you touch your tummy, vomiting with diabetes, vomiting blood or coffee-ground material, or black tarry stools need emergency care.' },
    ],
  },
  {
    sourceKey: 'src_skin_rash',
    title: 'Skin rashes in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/hives/',
    licence: SUMMARY,
    concernCodes: ['skin_rash'],
    version,
    chunks: [
      { heading: 'Irritation and allergy', text: 'An itchy red rash that appears after contact with a new soap, cream, detergent, plant, food or medicine is often contact or allergic dermatitis. Avoiding the trigger usually lets it settle within one to two weeks.' },
      { heading: 'Hives', text: 'Hives (urticaria) are raised, itchy welts that move around and usually get better within a few days. They can follow infections, foods, medicines or heat.' },
      { heading: 'Rash with fever', text: 'A rash with fever is often caused by a viral infection, but in India dengue and other infections should be considered, so a doctor should check it.' },
      { heading: 'Warning signs', text: 'Swelling of the lips, tongue or throat or difficulty breathing with a rash can be anaphylaxis and needs emergency care. Blistering or peeling skin, or sores in the mouth or eyes, needs a doctor the same day. Spots that do not fade under a pressed glass are an emergency.' },
    ],
  },
  {
    sourceKey: 'src_ear_pain',
    title: 'Earache in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/earache/',
    licence: SUMMARY,
    concernCodes: ['ear_pain'],
    version,
    chunks: [
      { heading: 'Middle ear infection', text: 'Middle ear infections often follow a cold and cause pain, muffled hearing and sometimes fever. Most improve within a few days without antibiotics.' },
      { heading: 'Outer ear infection', text: 'Infection of the ear canal causes pain, itching and discharge, often after water exposure or using cotton buds. Keeping the ear dry helps; a doctor may prescribe ear drops.' },
      { heading: 'Warning signs', text: 'Painful swelling or redness behind the ear, a stiff neck, or confusion with ear pain can mean the infection has spread and needs urgent assessment. Fluid coming from the ear, a change in hearing, or pain lasting more than two to three days should be checked.' },
    ],
  },
  {
    sourceKey: 'src_dizziness',
    title: 'Dizziness in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/dizziness/',
    licence: SUMMARY,
    concernCodes: ['dizziness'],
    version,
    chunks: [
      { heading: 'Light-headedness', text: 'Feeling faint or light-headed when standing up is often caused by a brief drop in blood pressure, dehydration, missed meals or illness. Lying down until it passes and getting up slowly helps. Avoid driving, climbing ladders or using machinery while you feel dizzy.' },
      { heading: 'Vertigo', text: 'A spinning sensation brought on by head movement usually comes from the inner ear (for example BPPV or labyrinthitis). It can come with nausea and usually settles over days to weeks.' },
      { heading: 'Warning signs', text: 'Dizziness with face drooping, arm weakness, slurred speech, chest pain, fainting, or a racing or irregular heartbeat can mean a heart or brain problem and needs urgent or emergency care.' },
    ],
  },
  {
    sourceKey: 'src_cold_flu',
    title: 'Colds and flu-like illness in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/flu/',
    licence: SUMMARY,
    concernCodes: ['cold_flu'],
    version,
    chunks: [
      { heading: 'Common cold', text: 'Colds cause a runny or blocked nose, sneezing and a mild sore throat, and usually clear within 7–10 days. Antibiotics do not help.' },
      { heading: 'Flu-like illness', text: 'Flu and similar viruses cause sudden fever, body aches, tiredness and cough. Rest and fluids help; most people recover within two weeks.' },
      { heading: 'Higher-risk groups', text: 'With flu-like symptoms, people aged 65 or over and people with diabetes, a heart, lung, kidney, liver or nerve condition, or a weakened immune system should see a doctor the same day.' },
      { heading: 'When to seek care', text: 'See a doctor if you feel short of breath, feel very unwell, the fever lasts more than three days, or you are not improving after 7 days. Sudden chest pain, severe difficulty breathing or coughing up blood are emergencies.' },
    ],
  },
  {
    sourceKey: 'src_gastro',
    title: 'Diarrhoea and vomiting in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/diarrhoea-and-vomiting/',
    licence: SUMMARY,
    concernCodes: ['gastro', 'abdominal_pain'],
    version,
    chunks: [
      { heading: 'Stomach bugs and food poisoning', text: 'Most diarrhoea and vomiting is caused by a stomach bug or food poisoning. Vomiting usually stops in one or two days and diarrhoea within five to seven days.' },
      { heading: 'Rehydration', text: 'Oral rehydration solution (ORS) replaces the water and salts lost. Take small sips often, even if you are vomiting, and eat light food when you can.' },
      { heading: 'Warning signs', text: 'Being unable to keep fluids down, signs of dehydration that continue after rehydration, bloody diarrhoea, diarrhoea for more than 7 days or vomiting for more than 2 days should be checked by a doctor. Vomiting blood, green vomit or a sudden severe tummy ache are emergencies.' },
    ],
  },
  {
    sourceKey: 'src_fever',
    title: 'Fever and dengue in adults (India)',
    publisher: WHO,
    url: 'https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue',
    licence: SUMMARY,
    concernCodes: ['fever', 'skin_rash'],
    version,
    chunks: [
      { heading: 'Viral fever', text: 'Most short fevers in adults are caused by viral infections and settle within a few days with rest and fluids.' },
      { heading: 'Fevers that need testing', text: 'In India, a fever lasting three days or more, or a fever with rash, severe headache, pain behind the eyes, or muscle and joint pains, may be due to dengue or other infections such as malaria or typhoid. A doctor can arrange blood tests.' },
      { heading: 'Severe dengue', text: 'Severe dengue often begins as the fever goes away: severe tummy pain, persistent vomiting, rapid breathing, bleeding gums or nose, blood in vomit or stool, or feeling very thirsty, weak or restless need care immediately.' },
      { heading: 'Warning signs', text: 'Fever with a stiff neck, a rash that does not fade when pressed, confusion, or difficulty breathing needs emergency care.' },
    ],
  },
  {
    sourceKey: 'src_self_care_general',
    title: 'High temperature, self-care and when to see a doctor',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/fever-in-adults/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      { heading: 'Rest and fluids', text: 'Rest, drinking enough fluids that your pee is light yellow, and light meals support recovery from most minor illnesses. A high temperature is usually 38 °C or above.' },
      { heading: 'Medicines', text: 'Ask a pharmacist or doctor before taking any new medicine, especially if you take other medicines, are pregnant, or have kidney, liver or stomach problems.' },
      { heading: 'Higher-risk groups', text: 'A fever can become serious more quickly if your immune system is weakened (for example by chemotherapy, long-term steroids or HIV) or you are 65 or over, so get medical advice the same day.' },
      { heading: 'Persistent symptoms', text: 'A high temperature that is not getting better with home treatment, symptoms that last more than two weeks, or severe pain should be reviewed by a doctor.' },
    ],
  },
  {
    sourceKey: 'src_rabies',
    title: 'Rabies and animal bites',
    publisher: WHO,
    url: 'https://www.who.int/news-room/fact-sheets/detail/rabies',
    licence: SUMMARY,
    concernCodes: ['animal_bite'],
    version,
    chunks: [
      { heading: 'How rabies spreads', text: 'Rabies spreads to people through bites or scratches from infected animals, most often dogs. Once symptoms appear it is almost always fatal, but it can be prevented with prompt care after a bite or scratch.' },
      { heading: 'First aid', text: 'Wash the wound straight away and thoroughly with soap and running water for about 15 minutes.' },
      { heading: 'Care after a bite', text: 'After a bite or scratch from a dog or another animal that could carry rabies, see a doctor as soon as possible, even if the wound looks minor. You may need rabies vaccination and wound care.' },
    ],
  },
  {
    sourceKey: 'src_snakebite',
    title: 'Snakebite',
    publisher: WHO,
    url: 'https://www.who.int/news-room/fact-sheets/detail/snakebite-envenoming',
    licence: SUMMARY,
    concernCodes: ['animal_bite'],
    version,
    chunks: [
      { heading: 'Emergency care', text: 'A snakebite can be life-threatening and needs emergency hospital care, even if the person feels well at first.' },
      { heading: 'First aid', text: 'Keep the person calm and still, keep the bitten limb still, and remove rings or tight items. Do not cut or suck the wound or apply a tight band, and get to hospital quickly.' },
    ],
  },
  {
    sourceKey: 'src_mental_health_crisis',
    title: 'Getting help in a mental health crisis (India)',
    publisher: MOHFW,
    url: 'https://telemanas.mohfw.gov.in/',
    licence: 'Contact details from the official Tele-MANAS website',
    concernCodes: [],
    version,
    chunks: [
      { heading: 'Immediate support', text: 'Tele-MANAS (14416 or 1-800-891-4416) offers free, confidential mental health support 24 hours a day in multiple Indian languages. If you are in immediate danger, call 112.' },
    ],
  },
];
